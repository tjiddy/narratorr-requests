import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { USER_ROLES, USER_STATUSES } from '../shared/schemas/user.js';
import { REQUEST_STATUSES, ACTIVE_REQUEST_STATUSES } from '../shared/schemas/request.js';
import type { StoredConnectors } from '../shared/schemas/connectors.js';

// ============ USERS ============
// Identity is owned here, keyed on a generic (authProvider, authSubject) pair —
// pluggable across local auth and any OIDC provider. User uniqueness is the pair;
// there is NO account linking, so a user has exactly one identity (1:1). The
// dev-admin (AUTH_BYPASS) is a real row (provider 'local', subject 'dev-admin') so
// request creation always runs against a genuine user boundary, never a retrofit.
export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    publicId: text('public_id').notNull().unique(), // us_...
    // Generic external identity. `authProvider` is the method ('local', 'plex',
    // 'authelia', or a configured OIDC provider id); `authSubject` is that
    // provider's stable subject (for local: the lowercased username). The pair is
    // unique — see the index below.
    authProvider: text('auth_provider').notNull(),
    authSubject: text('auth_subject').notNull(),
    // Display name (provider-agnostic). For local auth this is the original-case
    // username; for OIDC it's the mapped username claim.
    username: text('username').notNull(),
    // scrypt hash for local-auth users; null for OIDC identities (which never
    // authenticate via the password path).
    passwordHash: text('password_hash'),
    email: text('email'),
    thumb: text('thumb'),
    role: text('role', { enum: USER_ROLES }).notNull().default('user'),
    // Approval state (orthogonal to role). New users land 'pending'; an admin
    // approves (→ 'active') or rejects (→ 'rejected') in the Users page.
    status: text('status', { enum: USER_STATUSES }).notNull().default('pending'),
    // Per-user override of the app default. null = use the app default.
    requestQuota: integer('request_quota'),
    // Per-user auto-approve: this user's requests skip the pending queue. Orthogonal
    // to quota — an auto-approved user's requests still count against their limit.
    autoApprove: integer('auto_approve', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex('idx_users_provider_subject').on(table.authProvider, table.authSubject),
    index('idx_users_username').on(table.username),
  ],
);

// ============ REQUESTS ============
export const requests = sqliteTable(
  'requests',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    publicId: text('public_id').notNull().unique(), // rq_...
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    asin: text('asin').notNull(),
    // Snapshot of the catalog entry at request time — keeps the queue renderable
    // even if upstream metadata changes.
    title: text('title').notNull(),
    author: text('author'),
    narrator: text('narrator'),
    coverUrl: text('cover_url'),
    status: text('status', { enum: REQUEST_STATUSES }).notNull().default('pending'),
    // Handoff linkage into Narratorr: the library book we added + poll
    // (nullable until approved + handed off).
    narratorrBookId: text('narratorr_book_id'), // bk_...
    note: text('note'),
    // Quota accounting: a `failed` request is normally refunded, EXCEPT when the
    // failure was the user's fault (PLAN decision #5). Defaults false.
    userCausedFailure: integer('user_caused_failure', { mode: 'boolean' }).notNull().default(false),
    failureReason: text('failure_reason'),
    requestedAt: integer('requested_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    decidedAt: integer('decided_at', { mode: 'timestamp' }),
    decidedBy: integer('decided_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('idx_requests_user_id').on(table.userId),
    index('idx_requests_status').on(table.status),
    index('idx_requests_asin').on(table.asin),
    // Dedupe guard: at most ONE active request per (user, asin). We scope to the
    // user (not globally) because this is multi-user — two people may both want a
    // book; global dedupe is handled downstream by Narratorr's idempotent
    // ASIN-keyed acquisition. Deviates from PLAN's literal "unique(asin)" with
    // cause: a global guard would wrongly block a second requester. Re-requesting
    // after denied/failed/available is allowed (those aren't "active").
    uniqueIndex('idx_requests_user_asin_active')
      .on(table.userId, table.asin)
      .where(sql`status IN ('${sql.raw(ACTIVE_REQUEST_STATUSES.join("','"))}')`),
  ],
);

// ============ APP SETTINGS ============
// Singleton (id = 1). Seeded from config on first boot.
export const appSettings = sqliteTable('app_settings', {
  id: integer('id').primaryKey(),
  // null = unlimited. Overrides config.defaultRequestQuota once set in-app.
  defaultQuota: integer('default_quota'),
  // Which roles are auto-approved on request create. MVP: ['admin'].
  autoApproveRoles: text('auto_approve_roles', { mode: 'json' })
    .notNull()
    .$type<string[]>()
    .default(sql`'["admin"]'`),
  // Legacy placeholder, never written — superseded by `connectors` below. Kept so the
  // migration diff stays a clean ADD COLUMN (dropping it makes drizzle-kit prompt).
  notifyConfig: text('notify_config', { mode: 'json' }).$type<Record<string, unknown>>(),
  // Connector config (narratorr connection + notification channels) edited on the
  // admin Settings page. Secret fields are stored ENCRYPTED (see SecretCodec). null
  // until the admin configures it in the UI (no env seeding).
  connectors: text('connectors', { mode: 'json' }).$type<StoredConnectors>(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type RequestRow = typeof requests.$inferSelect;
export type NewRequestRow = typeof requests.$inferInsert;
export type AppSettingsRow = typeof appSettings.$inferSelect;
