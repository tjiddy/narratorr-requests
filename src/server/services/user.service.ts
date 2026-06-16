import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { users, type UserRow } from '../../db/schema.js';
import type { Role, UserDto } from '../../shared/schemas/user.js';
import type { AuthUser } from '../types.js';
import { publicId } from '../util/ids.js';

const DEV_ADMIN_PLEX_ID = 'dev-admin';

/** Profile fields we accept from a Plex claim adapter (see auth.service). */
export interface PlexProfile {
  plexId: string;
  plexUsername: string;
  email?: string | null;
  thumb?: string | null;
}

export class UserService {
  constructor(private readonly db: Db) {}

  toAuthUser(row: UserRow): AuthUser {
    return {
      id: row.id,
      publicId: row.publicId,
      plexUsername: row.plexUsername,
      role: row.role,
    };
  }

  toDto(row: UserRow): UserDto {
    return {
      publicId: row.publicId,
      plexUsername: row.plexUsername,
      email: row.email,
      thumb: row.thumb,
      role: row.role,
      requestQuota: row.requestQuota,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async getById(id: number): Promise<UserRow | undefined> {
    return this.db.query.users.findFirst({ where: eq(users.id, id) });
  }

  async getByPublicId(pid: string): Promise<UserRow | undefined> {
    return this.db.query.users.findFirst({ where: eq(users.publicId, pid) });
  }

  private async count(): Promise<number> {
    const [row] = await this.db.select({ n: sql<number>`count(*)` }).from(users);
    return row?.n ?? 0;
  }

  /**
   * Upsert a user from a Plex profile. On first creation the role is decided:
   * the configured owner username (or, failing that, the very first user to log
   * in) becomes `admin`; everyone else is `user`. On a returning user we refresh
   * the mutable profile fields but never silently change their role.
   */
  async upsertByPlex(profile: PlexProfile, opts: { ownerUsername?: string | null } = {}): Promise<UserRow> {
    const existing = await this.db.query.users.findFirst({
      where: eq(users.plexId, profile.plexId),
    });
    if (existing) {
      const [updated] = await this.db
        .update(users)
        .set({
          plexUsername: profile.plexUsername,
          email: profile.email ?? null,
          thumb: profile.thumb ?? null,
        })
        .where(eq(users.id, existing.id))
        .returning();
      return updated ?? existing;
    }

    const isOwner =
      opts.ownerUsername != null &&
      opts.ownerUsername.toLowerCase() === profile.plexUsername.toLowerCase();
    // First-user-admin bootstrap applies ONLY when no explicit owner is configured
    // (dev/standalone). With an owner set, admin is granted solely on owner match,
    // which closes the open-allowlist + first-login privilege-escalation path.
    const isFirstUser = opts.ownerUsername == null && (await this.count()) === 0;
    const role: Role = isOwner || isFirstUser ? 'admin' : 'user';

    const [created] = await this.db
      .insert(users)
      .values({
        publicId: publicId('us'),
        plexId: profile.plexId,
        plexUsername: profile.plexUsername,
        email: profile.email ?? null,
        thumb: profile.thumb ?? null,
        role,
      })
      .returning();
    if (!created) throw new Error('failed to create user');
    return created;
  }

  /**
   * Upsert the operator's admin from an Authelia OIDC profile, keyed on the Authelia
   * subject. Authelia login is the operator's own SSO — it is ALWAYS `admin` (the
   * who-gets-in gate is Authelia itself, plus the optional subject pin in the OIDC
   * service). Returning users refresh their display name/email; role is never downgraded.
   */
  async upsertAutheliaAdmin(profile: { subject: string; username: string; email?: string | null }): Promise<UserRow> {
    const existing = await this.db.query.users.findFirst({
      where: eq(users.autheliaSubject, profile.subject),
    });
    if (existing) {
      const [updated] = await this.db
        .update(users)
        .set({ plexUsername: profile.username, email: profile.email ?? existing.email })
        .where(eq(users.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    const [created] = await this.db
      .insert(users)
      .values({
        publicId: publicId('us'),
        autheliaSubject: profile.subject,
        plexUsername: profile.username,
        email: profile.email ?? null,
        thumb: null,
        role: 'admin',
      })
      .returning();
    if (!created) throw new Error('failed to create authelia admin');
    return created;
  }

  /** Idempotently ensure the AUTH_BYPASS dev admin exists; returns it. */
  async ensureDevAdmin(): Promise<UserRow> {
    const existing = await this.db.query.users.findFirst({
      where: eq(users.plexId, DEV_ADMIN_PLEX_ID),
    });
    if (existing) return existing;
    const [created] = await this.db
      .insert(users)
      .values({
        publicId: publicId('us'),
        plexId: DEV_ADMIN_PLEX_ID,
        plexUsername: 'dev-admin',
        email: null,
        thumb: null,
        role: 'admin',
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    // Lost a race — read it back.
    const row = await this.db.query.users.findFirst({ where: eq(users.plexId, DEV_ADMIN_PLEX_ID) });
    if (!row) throw new Error('failed to ensure dev admin');
    return row;
  }
}
