import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { appSettings } from '../../db/schema.js';
import { notificationEventSchema, type NotificationEvent } from '../../shared/notification-events.js';
import { quotaWindowDaysSchema } from '../../shared/schemas/connectors.js';
import type {
  StoredConnectors,
  StoredNotifier,
  ConnectorSettingsDto,
  NotifierDto,
  UpdateConnectorSettingsBody,
  TestConnectorBody,
  CreateNotifierBody,
  UpdateNotifierBody,
  NotifierTestBody,
  QuotaWindowDays,
} from '../../shared/schemas/connectors.js';
import {
  NOTIFIER_REGISTRY,
  isKnownNotifierType,
  type NotifierType,
  type NotifierTypeDef,
} from '../../shared/notifier-registry.js';
import type { NotificationsConfig, RuntimeNotifier } from './notifications/index.js';
import type { SecretCodec } from '../util/secret-codec.js';
import { publicId } from '../util/ids.js';
import { badRequest, notFound } from '../util/errors.js';

const SINGLETON_ID = 1;

const EMPTY: StoredConnectors = {
  publicUrl: null,
  narratorr: null,
  notifiers: [],
};

/** Minimal structural logger (Fastify's pino logger satisfies it). */
interface SettingsLogger {
  warn(obj: unknown, msg?: string): void;
}
const NOOP_LOGGER: SettingsLogger = { warn() {} };

/**
 * Reads/writes the connector config (narratorr connection + the notifier list) persisted
 * in `app_settings.connectors`. Secrets are encrypted at rest; this service is the single
 * place that decrypts (for runtime use) or masks (for the API). Notifier secret handling
 * is registry-driven: the generic helpers walk each type's `secretFields` (mask / reveal /
 * resolve), so a new type needs no bespoke code here. There is NO env seeding — a fresh
 * install starts empty and is configured in the Settings UI.
 */
export class ConnectorSettingsService {
  constructor(
    private readonly db: Db,
    private readonly codec: SecretCodec,
    private readonly logger: SettingsLogger = NOOP_LOGGER,
  ) {}

  async getStored(): Promise<StoredConnectors> {
    const row = await this.db.query.appSettings.findFirst({ where: eq(appSettings.id, SINGLETON_ID) });
    return this.connectorsFrom(row);
  }

  /** The connector blob off a settings row (or a fresh EMPTY when the row/blob is absent). */
  private connectorsFrom(row: { connectors: StoredConnectors | null } | undefined): StoredConnectors {
    return row?.connectors ?? { ...EMPTY };
  }

  /**
   * The app-wide default request quota, composed from the two dedicated columns
   * (`default_quota` + `default_quota_window_days`) — NOT the encrypted `connectors` JSON blob.
   * `limit: null` = unlimited; `windowDays` is the concrete rolling-window day count. Read at
   * boot to seed the request policy and again on every settings save to reconfigure it live.
   * Stays a standalone single-SELECT accessor (the boot/reconfigure callers want just the quota);
   * `getDto()` maps the same sanitizer off the row it already fetched.
   */
  async getDefaultQuota(): Promise<{ limit: number | null; windowDays: QuotaWindowDays }> {
    const row = await this.db.query.appSettings.findFirst({ where: eq(appSettings.id, SINGLETON_ID) });
    return this.sanitizeQuota(row);
  }

  /**
   * Narrow the two raw quota columns into a value that ALWAYS satisfies `defaultQuotaDtoSchema`
   * (`limit: positive-int | null`, `windowDays ∈ {1,7,30}`), so a legacy / hand-edited / corrupt
   * row can never 502 the masked Settings GET (which reuses those same constraints) nor seed the
   * boot request policy with a value the write path would reject. Both columns degrade
   * symmetrically: `windowDays` falls back to 30 on an out-of-set value, and `limit` falls back to
   * `null` (unlimited) when the stored `default_quota` is not a positive integer (`0`, negative, or
   * non-finite) — fresh-DB values (`NOT NULL DEFAULT 30` window, `0 → null` limit) pass through
   * byte-for-byte unchanged.
   */
  private sanitizeQuota(
    row: { defaultQuota: number | null; defaultQuotaWindowDays: number } | undefined,
  ): { limit: number | null; windowDays: QuotaWindowDays } {
    const window = quotaWindowDaysSchema.safeParse(row?.defaultQuotaWindowDays);
    const limit = row?.defaultQuota ?? null;
    return {
      limit: limit !== null && Number.isInteger(limit) && limit > 0 ? limit : null,
      windowDays: window.success ? window.data : 30,
    };
  }

  /**
   * Decrypt a stored secret (enc blob, or tolerate legacy plaintext) → plaintext|null.
   * A blob that fails to decrypt (the at-rest key changed — e.g. SESSION_SECRET rotated
   * with no SETTINGS_KEY) returns null AND logs a loud WARN, so a connector silently going
   * dark is diagnosable rather than indistinguishable from "never configured".
   */
  private reveal(value: string | null, field: string): string | null {
    if (!value) return null;
    if (!this.codec.isEncrypted(value)) return value; // legacy plaintext, tolerated
    const plain = this.codec.decrypt(value);
    if (plain === null) {
      this.logger.warn(
        { field },
        'connector secret could not be decrypted (settings key changed?) — treating this connector as unconfigured',
      );
    }
    return plain;
  }

  /** Narratorr client config (decrypted). null when unconfigured or the key can't be read. */
  async getNarratorrConfig(): Promise<{ url: string; apiKey: string } | null> {
    const c = await this.getStored();
    if (!c.narratorr) return null;
    const apiKey = this.reveal(c.narratorr.apiKey, 'narratorr.apiKey');
    if (!apiKey) return null;
    // The full base URL is stored directly (the user types it); NarratorrClient consumes
    // { url, apiKey } as-is.
    return { url: c.narratorr.url, apiKey };
  }

  /** Notifications config (decrypted) in the shape buildNotifier expects. */
  async getNotificationsConfig(): Promise<NotificationsConfig> {
    const c = await this.getStored();
    return { publicUrl: c.publicUrl, notifiers: c.notifiers.map((n) => this.toRuntimeNotifier(n)) };
  }

  /**
   * Build a narratorr runtime config from an UNSAVED candidate (the Settings "Test"
   * path), resolving an omitted/unchanged apiKey against the stored, decrypted secret.
   * Mirrors getNarratorrConfig() but reads the candidate's url instead of the stored one.
   * NEVER writes — the stored secret is only decrypted in-memory. Returns null when the
   * candidate is absent/blank or no usable key resolves (→ clean "not configured").
   */
  async buildCandidateNarratorrConfig(
    candidate: TestConnectorBody['narratorr'],
  ): Promise<{ url: string; apiKey: string } | null> {
    if (!candidate) return null;
    const stored = await this.getStored();
    const apiKey = this.resolveCandidateSecret(candidate.apiKey, stored.narratorr?.apiKey, 'narratorr.apiKey');
    if (!apiKey) return null;
    return { url: candidate.url, apiKey };
  }

  /**
   * Resolve a candidate secret for the read-only Test path → PLAINTEXT for runtime use:
   * `undefined` (unchanged) → the stored secret, decrypted in-memory; `''` → none; a typed
   * value → used as-is. Distinct from resolveSecret() (the persistence path, which ENCRYPTS):
   * this never touches the DB and yields plaintext a live probe can use immediately.
   */
  private resolveCandidateSecret(
    provided: string | undefined,
    storedEncrypted: string | null | undefined,
    field: string,
  ): string | null {
    if (provided === undefined) return this.reveal(storedEncrypted ?? null, field);
    if (provided === '') return null;
    return provided;
  }

  /**
   * Masked view for the Settings page — secrets become has* booleans / host hints. Reads the
   * singleton row ONCE and maps both the connector DTO and the (sanitized) default-quota DTO off
   * it — the connector blob and the quota columns live on the same row, so the most-called settings
   * read needs a single SELECT, not one per concern.
   */
  async getDto(): Promise<ConnectorSettingsDto> {
    const row = await this.db.query.appSettings.findFirst({ where: eq(appSettings.id, SINGLETON_ID) });
    const c = this.connectorsFrom(row);
    return {
      publicUrl: c.publicUrl,
      narratorr: c.narratorr
        ? {
            url: c.narratorr.url,
            hasApiKey: Boolean(c.narratorr.apiKey),
          }
        : null,
      notifiers: c.notifiers.map((n) => this.toNotifierDto(n)),
      defaultQuota: this.sanitizeQuota(row),
    };
  }

  /**
   * Persist a connector + default-quota save. The connector blob and the quota columns live on the
   * same singleton row, and a PUT body can carry both, so they're written in ONE atomic `UPDATE`
   * with conditional columns — no half-applied save where (say) the connector change is durable but
   * the quota write fails and `reconfigure()` never runs. `resolveNarratorr` (which can 400 on a
   * missing required key) runs BEFORE the write, so a rejected body never touches the row.
   *
   * Per field: publicUrl omitted → keep, null → clear, value → set; narratorr omitted → keep, null →
   * clear, object → resolve & set (the notifier list is untouched by this body). The `connectors`
   * column is written only when a connector field is present; the quota columns only when
   * `defaultQuota` is present, and `default_quota_window_days` only when `windowDays` is supplied
   * (omit-to-keep), so a partial body never clobbers an untouched column.
   */
  async update(body: UpdateConnectorSettingsBody): Promise<StoredConnectors> {
    const cur = await this.getStored();
    const next: StoredConnectors = { ...cur };

    const hasConnectorFields = body.publicUrl !== undefined || body.narratorr !== undefined;
    if (body.publicUrl !== undefined) next.publicUrl = body.publicUrl;
    if (body.narratorr !== undefined) next.narratorr = this.resolveNarratorr(body.narratorr, cur.narratorr);

    const q = body.defaultQuota;
    const [row] = await this.db
      .update(appSettings)
      .set({
        ...(hasConnectorFields && { connectors: next }),
        ...(q !== undefined && { defaultQuota: q.limit }),
        ...(q?.windowDays !== undefined && { defaultQuotaWindowDays: q.windowDays }),
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, SINGLETON_ID))
      .returning();
    // Guard a silent no-op: SettingsService.ensure() creates the singleton at boot, so a zero-row
    // match means the row vanished and `next` would be a lie.
    if (!row) throw new Error('app_settings singleton missing — settings update did not persist');
    return next;
  }

  // ---- Notifier CRUD --------------------------------------------------------

  /** Create a notifier (required secrets enforced — no stored value to fall back to). */
  async createNotifier(body: CreateNotifierBody): Promise<StoredNotifier> {
    const def = NOTIFIER_REGISTRY[body.type];
    const config = this.resolveNotifierConfig(def, this.parseConfig(def, body.config), undefined);
    const notifier: StoredNotifier = {
      id: publicId('nf'),
      name: body.name,
      type: body.type,
      events: body.events,
      config,
    };
    const cur = await this.getStored();
    await this.persist({ ...cur, notifiers: [...cur.notifiers, notifier] });
    return notifier;
  }

  /** Edit a notifier by id — secrets are omit-to-keep against the stored config (by id). */
  async updateNotifier(id: string, body: UpdateNotifierBody): Promise<StoredNotifier> {
    const cur = await this.getStored();
    const idx = cur.notifiers.findIndex((n) => n.id === id);
    if (idx === -1) throw notFound('Notifier not found.');
    const existing = cur.notifiers[idx]!;
    // Don't launder an UNKNOWN (out-of-registry) stored type into a known one: that path would
    // silently discard the old encrypted config. An unknown notifier is disabled + deletable
    // only — its type is locked. (`body.type` is always a known registry key, so any update to
    // an unknown row is necessarily a type change.) The stored row is left untouched.
    if (!isKnownNotifierType(existing.type) && existing.type !== body.type) {
      throw badRequest('NOTIFIER_TYPE_LOCKED', 'Cannot change the type of an unrecognized notifier — delete it instead.');
    }
    const def = NOTIFIER_REGISTRY[body.type];
    // If the type changed, the stored secret has a different shape → no omit-to-keep base, so a
    // required secret of the new type must be supplied. Same type → omit-to-keep against the
    // stored config (but explicitly clearing a required secret is still rejected — see resolveNotifierConfig).
    const existingConfig = existing.type === body.type ? existing.config : undefined;
    const config = this.resolveNotifierConfig(def, this.parseConfig(def, body.config), existingConfig);
    const updated: StoredNotifier = {
      id,
      name: body.name,
      type: body.type,
      events: body.events,
      config,
    };
    const notifiers = [...cur.notifiers];
    notifiers[idx] = updated;
    await this.persist({ ...cur, notifiers });
    return updated;
  }

  async deleteNotifier(id: string): Promise<void> {
    const cur = await this.getStored();
    const notifiers = cur.notifiers.filter((n) => n.id !== id);
    if (notifiers.length === cur.notifiers.length) throw notFound('Notifier not found.');
    await this.persist({ ...cur, notifiers });
  }

  /**
   * Build a runtime (plaintext) notifier config from an UNSAVED candidate (the notifier
   * "Test" path). `id` present (edit) → omit-to-keep secrets against the stored notifier;
   * absent (create) → secrets must be provided. NEVER writes.
   */
  async buildCandidateNotifier(
    body: Pick<NotifierTestBody, 'type' | 'config' | 'id'>,
  ): Promise<{ type: NotifierType; config: Record<string, unknown> }> {
    const def = NOTIFIER_REGISTRY[body.type];
    const parsed = this.parseConfig(def, body.config);
    const stored = body.id ? (await this.getStored()).notifiers.find((n) => n.id === body.id) : undefined;
    const existing = stored && stored.type === body.type ? stored.config : undefined;
    return { type: body.type, config: this.buildCandidateNotifierConfig(def, parsed, existing) };
  }

  // ---- Generic, registry-driven notifier helpers ----------------------------

  /** Reveal a stored notifier into the runtime shape (secrets decrypted; unknown type passes opaque). */
  private toRuntimeNotifier(n: StoredNotifier): RuntimeNotifier {
    if (!isKnownNotifierType(n.type)) return { ...n, config: n.config };
    return { ...n, config: this.revealNotifierConfig(NOTIFIER_REGISTRY[n.type], n.config) };
  }

  /**
   * Mask a stored notifier into its DTO — known → masked config; unknown → deletable, no config.
   * NEVER-BRICK: a single row whose config OR events fail their response schema must not 500 the
   * whole Settings GET (the admin couldn't even load the page to delete the offending row). Both
   * independently-validated fields degrade: a config that fails masking falls back to the
   * disabled/deletable UnknownNotifierDto; events that fail validation become `events: []`. Each
   * failure logs a WARN with the notifier id, mirroring the buildOne skip-with-warn at runtime.
   */
  private toNotifierDto(n: StoredNotifier): NotifierDto {
    // Events validate against the response schema on BOTH the known and unknown DTOs, so make
    // them response-safe before either branch.
    const events = this.safeEvents(n);

    if (isKnownNotifierType(n.type)) {
      const config = this.tryMaskNotifierConfig(NOTIFIER_REGISTRY[n.type], n.config);
      if (config !== null) {
        return { id: n.id, name: n.name, type: n.type, events, config };
      }
      // Masked config failed its schema → degrade to the unknown DTO (deletable, no config) so
      // the row stays visible and removable instead of bricking the response.
      this.logger.warn(
        { notifier: n.id, type: n.type },
        'notifier config could not be masked (malformed stored config) — degrading to a deletable row',
      );
    }
    return { id: n.id, name: n.name, type: n.type, events, unknown: true };
  }

  /** Response-safe events: valid keys pass through; a malformed set degrades to [] + WARN. */
  private safeEvents(n: StoredNotifier): NotificationEvent[] {
    const result = z.array(notificationEventSchema).safeParse(n.events);
    if (result.success) return result.data;
    this.logger.warn(
      { notifier: n.id, type: n.type },
      'notifier events failed the schema — emitting events: [] so the Settings GET still loads',
    );
    return [];
  }

  /** Decrypt each secret field; copy non-secrets through. */
  private revealNotifierConfig(def: NotifierTypeDef, stored: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of def.fields) {
      const sf = def.secretFields.find((s) => s.field === f.key);
      out[f.key] = sf ? this.reveal((stored[f.key] as string | null) ?? null, `${def.type}.${f.key}`) : stored[f.key];
    }
    return out;
  }

  /**
   * Drop secret values → has* booleans (+ host hint for capability URLs); copy non-secrets.
   * Returns null (rather than throwing) when the masked shape fails the type's masked schema —
   * a malformed stored config — so the caller can degrade the row instead of bricking the GET.
   */
  private tryMaskNotifierConfig(def: NotifierTypeDef, stored: Record<string, unknown>): Record<string, unknown> | null {
    const out: Record<string, unknown> = {};
    for (const f of def.fields) {
      const sf = def.secretFields.find((s) => s.field === f.key);
      if (sf) {
        out[sf.maskedField] = Boolean(stored[f.key]);
        if (sf.hintField) out[sf.hintField] = this.hostHint(stored[f.key]);
      } else {
        out[f.key] = stored[f.key];
      }
    }
    const result = def.maskedConfigSchema.safeParse(out);
    return result.success ? (result.data as Record<string, unknown>) : null;
  }

  /**
   * Host hint for a capability-URL secret — `hooks.slack.com/…`, never the full URL.
   * Decrypts to read the host (GET never throws: reveal returns null + warns on failure),
   * falling back to "configured" when the value is present but can't be parsed/decrypted.
   */
  private hostHint(value: unknown): string | null {
    if (typeof value !== 'string' || !value) return null;
    const plain = this.reveal(value, 'notifier.capabilityUrl');
    if (!plain) return 'configured';
    try {
      return `${new URL(plain).host}/…`;
    } catch {
      return 'configured';
    }
  }

  /**
   * Build the stored config: encrypt secrets, store non-secrets. Required secrets are enforced
   * AFTER resolution, symmetrically on create and update: omitting one (`undefined`) keeps the
   * existing encrypted value (so a required secret survives an unrelated edit), but explicitly
   * clearing one (`''`, which resolves to `null`) on a `sf.required` field is rejected — a
   * required secret can never be left empty-but-enabled (which would be unbuildable at runtime).
   */
  private resolveNotifierConfig(
    def: NotifierTypeDef,
    parsed: Record<string, unknown>,
    existing: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of def.fields) {
      const sf = def.secretFields.find((s) => s.field === f.key);
      if (sf) {
        const resolved = this.resolveSecret(parsed[f.key] as string | undefined, existing?.[f.key] as string | null | undefined);
        if (sf.required && !resolved) {
          throw badRequest('NOTIFIER_SECRET_REQUIRED', `${def.label} requires ${f.label}.`);
        }
        out[f.key] = resolved;
      } else {
        out[f.key] = parsed[f.key] ?? null;
      }
    }
    return out;
  }

  /** Build a runtime (plaintext) config from a candidate — secrets omit-to-keep by id. */
  private buildCandidateNotifierConfig(
    def: NotifierTypeDef,
    parsed: Record<string, unknown>,
    existing: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of def.fields) {
      const sf = def.secretFields.find((s) => s.field === f.key);
      out[f.key] = sf
        ? this.resolveCandidateSecret(parsed[f.key] as string | undefined, existing?.[f.key] as string | null | undefined, `${def.type}.${f.key}`)
        : (parsed[f.key] ?? null);
    }
    return out;
  }

  /** Validate the type-specific config against the registry schema → 400 on failure. */
  private parseConfig(def: NotifierTypeDef, raw: unknown): Record<string, unknown> {
    const result = def.configSchema.safeParse(raw);
    if (!result.success) {
      const first = result.error.issues[0];
      throw badRequest(
        'NOTIFIER_CONFIG_INVALID',
        first ? `${first.path.join('.') || 'config'}: ${first.message}` : 'Invalid notifier config.',
      );
    }
    return result.data as Record<string, unknown>;
  }

  /**
   * Resolve a secret field on update: a non-empty value is encrypted; an empty string
   * clears it; `undefined` keeps the existing (already-encrypted) value. This is what
   * lets the UI send `••••` (omit) for an unchanged secret without ever seeing it.
   * Request input is ALWAYS treated as plaintext (encrypt, never encryptIfNeeded) so a
   * literal "enc:v1:…" submitted by a client can't be stored as if it were ciphertext.
   */
  private resolveSecret(provided: string | undefined, existing: string | null | undefined): string | null {
    if (provided === undefined) return existing ?? null;
    if (provided === '') return null;
    return this.codec.encrypt(provided);
  }

  private resolveNarratorr(
    body: NonNullable<UpdateConnectorSettingsBody['narratorr']> | null,
    cur: StoredConnectors['narratorr'],
  ): StoredConnectors['narratorr'] {
    if (body === null) return null;
    const apiKey = this.resolveSecret(body.apiKey, cur?.apiKey);
    if (!apiKey) throw badRequest('NARRATORR_KEY_REQUIRED', 'Narratorr requires an API key.');
    return { url: body.url, apiKey };
  }

  /**
   * Persist the whole connector blob. Guard against a silent no-op: if the singleton row
   * is missing, the UPDATE matches zero rows and `next` would be a lie. SettingsService
   * .ensure() creates it at boot, so this should never fire — but assert it.
   */
  private async persist(next: StoredConnectors): Promise<void> {
    const [row] = await this.db
      .update(appSettings)
      .set({ connectors: next, updatedAt: new Date() })
      .where(eq(appSettings.id, SINGLETON_ID))
      .returning();
    if (!row) throw new Error('app_settings singleton missing — connector update did not persist');
  }
}
