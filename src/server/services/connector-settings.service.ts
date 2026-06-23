import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { appSettings } from '../../db/schema.js';
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

/**
 * Bracket a bare IPv6 literal host so it survives `:port` interpolation — `::1` → `[::1]`.
 * Without brackets, `http://::1:3000` is rejected by `new URL()`. An IPv6 literal contains
 * `::` or ≥2 colons; the single-colon `host:port` typo (Port is its own field) and IPv4/
 * hostnames are left as-is, and already-bracketed input is idempotent.
 */
function bracketIpv6Host(host: string): string {
  if (host.startsWith('[')) return host; // already bracketed → leave as-is
  const colons = (host.match(/:/g) ?? []).length;
  return colons >= 2 ? `[${host}]` : host;
}

/**
 * Compose narratorr's effective base URL from the stored discrete fields:
 * `${scheme}://${host}:${port}${urlBase}` — a valid http(s) URL with no trailing
 * slash. e.g. {host:'narratorr',port:3000,useSsl:false,urlBase:null} → http://narratorr:3000.
 * A bare IPv6 host is bracketed (`::1` → `[::1]`) so the result stays parseable.
 */
function composeNarratorrUrl(n: { host: string; port: number; useSsl: boolean; urlBase: string | null }): string {
  return `${n.useSsl ? 'https' : 'http'}://${bracketIpv6Host(n.host)}:${n.port}${n.urlBase ?? ''}`;
}

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
    return row?.connectors ?? { ...EMPTY };
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
    // Compose the effective base URL from the discrete fields. NarratorrClient keeps
    // consuming { url, apiKey }, so the host→URL composition lives entirely here.
    return { url: composeNarratorrUrl(c.narratorr), apiKey };
  }

  /** Notifications config (decrypted) in the shape buildNotifier expects. */
  async getNotificationsConfig(): Promise<NotificationsConfig> {
    const c = await this.getStored();
    return { publicUrl: c.publicUrl, notifiers: c.notifiers.map((n) => this.toRuntimeNotifier(n)) };
  }

  /**
   * Build a narratorr runtime config from an UNSAVED candidate (the Settings "Test"
   * path), resolving an omitted/unchanged apiKey against the stored, decrypted secret.
   * Mirrors getNarratorrConfig() but reads the candidate's discrete fields instead of the
   * stored ones. NEVER writes — the stored secret is only decrypted in-memory. Returns null
   * when the candidate is absent/blank or no usable key resolves (→ clean "not configured").
   */
  async buildCandidateNarratorrConfig(
    candidate: TestConnectorBody['narratorr'],
  ): Promise<{ url: string; apiKey: string } | null> {
    if (!candidate) return null;
    const stored = await this.getStored();
    const apiKey = this.resolveCandidateSecret(candidate.apiKey, stored.narratorr?.apiKey, 'narratorr.apiKey');
    if (!apiKey) return null;
    return {
      url: composeNarratorrUrl({
        host: candidate.host,
        port: candidate.port,
        useSsl: candidate.useSsl,
        urlBase: candidate.urlBase ?? null,
      }),
      apiKey,
    };
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

  /** Masked view for the Settings page — secrets become has* booleans / host hints. */
  async getDto(): Promise<ConnectorSettingsDto> {
    const c = await this.getStored();
    return {
      publicUrl: c.publicUrl,
      narratorr: c.narratorr
        ? {
            host: c.narratorr.host,
            port: c.narratorr.port,
            useSsl: c.narratorr.useSsl,
            urlBase: c.narratorr.urlBase,
            hasApiKey: Boolean(c.narratorr.apiKey),
          }
        : null,
      notifiers: c.notifiers.map((n) => this.toNotifierDto(n)),
    };
  }

  async update(body: UpdateConnectorSettingsBody): Promise<StoredConnectors> {
    const cur = await this.getStored();
    const next: StoredConnectors = { ...cur };

    // publicUrl: omitted → keep; null → clear; value → set. narratorr: omitted → keep;
    // null → clear; object → resolve & set. The notifier list is untouched by this body.
    if (body.publicUrl !== undefined) next.publicUrl = body.publicUrl;
    if (body.narratorr !== undefined) next.narratorr = this.resolveNarratorr(body.narratorr, cur.narratorr);

    await this.persist(next);
    return next;
  }

  // ---- Notifier CRUD --------------------------------------------------------

  /** Create a notifier (required secrets enforced — no stored value to fall back to). */
  async createNotifier(body: CreateNotifierBody): Promise<StoredNotifier> {
    const def = NOTIFIER_REGISTRY[body.type];
    const config = this.resolveNotifierConfig(def, this.parseConfig(def, body.config), undefined, true);
    const notifier: StoredNotifier = {
      id: publicId('nf'),
      name: body.name,
      type: body.type,
      enabled: body.enabled,
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
    const def = NOTIFIER_REGISTRY[body.type];
    // If the type changed, the stored secret has a different shape → no omit-to-keep base,
    // so required secrets must be present (treated like a create).
    const existingConfig = existing.type === body.type ? existing.config : undefined;
    const config = this.resolveNotifierConfig(
      def,
      this.parseConfig(def, body.config),
      existingConfig,
      existingConfig === undefined,
    );
    const updated: StoredNotifier = {
      id,
      name: body.name,
      type: body.type,
      enabled: body.enabled,
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
  async buildCandidateNotifier(body: NotifierTestBody): Promise<{ type: NotifierType; config: Record<string, unknown> }> {
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

  /** Mask a stored notifier into its DTO — known → masked config; unknown → disabled+deletable. */
  private toNotifierDto(n: StoredNotifier): NotifierDto {
    if (!isKnownNotifierType(n.type)) {
      return { id: n.id, name: n.name, type: n.type, enabled: false, events: n.events, unknown: true };
    }
    return {
      id: n.id,
      name: n.name,
      type: n.type,
      enabled: n.enabled,
      events: n.events,
      config: this.maskNotifierConfig(NOTIFIER_REGISTRY[n.type], n.config),
    };
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

  /** Drop secret values → has* booleans (+ host hint for capability URLs); copy non-secrets. */
  private maskNotifierConfig(def: NotifierTypeDef, stored: Record<string, unknown>): Record<string, unknown> {
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
    return def.maskedConfigSchema.parse(out) as Record<string, unknown>;
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

  /** Build the stored config: encrypt secrets (enforce required on create); store non-secrets. */
  private resolveNotifierConfig(
    def: NotifierTypeDef,
    parsed: Record<string, unknown>,
    existing: Record<string, unknown> | undefined,
    isCreate: boolean,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of def.fields) {
      const sf = def.secretFields.find((s) => s.field === f.key);
      if (sf) {
        const resolved = this.resolveSecret(parsed[f.key] as string | undefined, existing?.[f.key] as string | null | undefined);
        if (isCreate && sf.required && !resolved) {
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
    return { host: body.host, port: body.port, useSsl: body.useSsl, urlBase: body.urlBase ?? null, apiKey };
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
