import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { appSettings } from '../../db/schema.js';
import type {
  StoredConnectors,
  ConnectorSettingsDto,
  UpdateConnectorSettingsBody,
  TestConnectorBody,
} from '../../shared/schemas/connectors.js';
import type { NotificationsConfig } from './notifications/index.js';
import type { SecretCodec } from '../util/secret-codec.js';
import { badRequest } from '../util/errors.js';

const SINGLETON_ID = 1;

const EMPTY: StoredConnectors = {
  publicUrl: null,
  narratorr: null,
  ntfy: null,
  email: null,
  webhook: null,
};

/**
 * Compose narratorr's effective base URL from the stored discrete fields:
 * `${scheme}://${host}:${port}${urlBase}` — a valid http(s) URL with no trailing
 * slash. e.g. {host:'narratorr',port:3000,useSsl:false,urlBase:null} → http://narratorr:3000.
 */
function composeNarratorrUrl(n: { host: string; port: number; useSsl: boolean; urlBase: string | null }): string {
  return `${n.useSsl ? 'https' : 'http'}://${n.host}:${n.port}${n.urlBase ?? ''}`;
}

/** Minimal structural logger (Fastify's pino logger satisfies it). */
interface SettingsLogger {
  warn(obj: unknown, msg?: string): void;
}
const NOOP_LOGGER: SettingsLogger = { warn() {} };

/**
 * Reads/writes the connector config (narratorr connection + notification channels)
 * persisted in `app_settings.connectors`. Secrets are encrypted at rest; this service
 * is the single place that decrypts (for runtime use) or masks (for the API). There is
 * NO env seeding — a fresh install starts empty and is configured in the Settings UI.
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
    return {
      publicUrl: c.publicUrl,
      ntfy: c.ntfy
        ? { url: c.ntfy.url, topic: c.ntfy.topic, token: this.reveal(c.ntfy.token, 'ntfy.token'), priority: c.ntfy.priority }
        : null,
      email: c.email
        ? {
            host: c.email.host,
            port: c.email.port,
            secure: c.email.secure,
            user: c.email.user,
            pass: this.reveal(c.email.pass, 'email.pass'),
            from: c.email.from,
            to: c.email.to,
          }
        : null,
      webhook: c.webhook ? { url: c.webhook.url } : null,
    };
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
   * Build a notifications config from an UNSAVED candidate (the Settings "Test" path) in
   * the shape buildChannel expects. Secrets resolve omit-to-keep against the stored,
   * decrypted values; `publicUrl` resolves plain omit-to-keep (omitted → stored, explicit
   * value/null → used as given) so a test notification renders with the unsaved Public URL.
   * NEVER writes — stored secrets are only decrypted in-memory.
   */
  async buildCandidateNotificationsConfig(
    candidate: Pick<TestConnectorBody, 'publicUrl' | 'ntfy' | 'email' | 'webhook'>,
  ): Promise<NotificationsConfig> {
    const stored = await this.getStored();
    return {
      publicUrl: candidate.publicUrl !== undefined ? candidate.publicUrl : stored.publicUrl,
      ntfy: this.candidateNtfy(candidate.ntfy, stored.ntfy),
      email: this.candidateEmail(candidate.email, stored.email),
      webhook: candidate.webhook ? { url: candidate.webhook.url } : null,
    };
  }

  private candidateNtfy(
    candidate: TestConnectorBody['ntfy'],
    stored: StoredConnectors['ntfy'],
  ): NotificationsConfig['ntfy'] {
    if (!candidate) return null;
    return {
      url: candidate.url,
      topic: candidate.topic,
      token: this.resolveCandidateSecret(candidate.token, stored?.token, 'ntfy.token'),
      priority: candidate.priority ?? null,
    };
  }

  private candidateEmail(
    candidate: TestConnectorBody['email'],
    stored: StoredConnectors['email'],
  ): NotificationsConfig['email'] {
    if (!candidate) return null;
    return {
      host: candidate.host,
      port: candidate.port ?? stored?.port ?? 587,
      secure: candidate.secure ?? stored?.secure ?? false,
      user: candidate.user !== undefined ? candidate.user : (stored?.user ?? null),
      pass: this.resolveCandidateSecret(candidate.pass, stored?.pass, 'email.pass'),
      from: candidate.from,
      to: candidate.to,
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

  /** Masked view for the Settings page — secrets become has* booleans, never values. */
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
      ntfy: c.ntfy
        ? { url: c.ntfy.url, topic: c.ntfy.topic, hasToken: Boolean(c.ntfy.token), priority: c.ntfy.priority }
        : null,
      email: c.email
        ? {
            host: c.email.host,
            port: c.email.port,
            secure: c.email.secure,
            user: c.email.user,
            from: c.email.from,
            to: c.email.to,
            hasPassword: Boolean(c.email.pass),
          }
        : null,
      webhook: c.webhook ? { url: c.webhook.url } : null,
    };
  }

  async update(body: UpdateConnectorSettingsBody): Promise<StoredConnectors> {
    const cur = await this.getStored();
    const next: StoredConnectors = { ...cur };

    // Per connector: omitted (undefined) → keep; null → clear; object → resolve & set.
    if (body.publicUrl !== undefined) next.publicUrl = body.publicUrl;
    if (body.narratorr !== undefined) next.narratorr = this.resolveNarratorr(body.narratorr, cur.narratorr);
    if (body.ntfy !== undefined) next.ntfy = this.resolveNtfy(body.ntfy, cur.ntfy);
    if (body.email !== undefined) next.email = this.resolveEmail(body.email, cur.email);
    if (body.webhook !== undefined) next.webhook = body.webhook === null ? null : { url: body.webhook.url };

    // Guard against a silent no-op: if the singleton row is missing, the UPDATE matches
    // zero rows and `next` would be a lie. SettingsService.ensure() creates it at boot,
    // so this should never fire — but assert it rather than return an unpersisted value.
    const [row] = await this.db
      .update(appSettings)
      .set({ connectors: next, updatedAt: new Date() })
      .where(eq(appSettings.id, SINGLETON_ID))
      .returning();
    if (!row) throw new Error('app_settings singleton missing — connector update did not persist');
    return next;
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

  private resolveNtfy(
    body: NonNullable<UpdateConnectorSettingsBody['ntfy']> | null,
    cur: StoredConnectors['ntfy'],
  ): StoredConnectors['ntfy'] {
    if (body === null) return null;
    return {
      url: body.url,
      topic: body.topic,
      token: this.resolveSecret(body.token, cur?.token),
      priority: body.priority ?? null,
    };
  }

  private resolveEmail(
    body: NonNullable<UpdateConnectorSettingsBody['email']> | null,
    cur: StoredConnectors['email'],
  ): StoredConnectors['email'] {
    if (body === null) return null;
    return {
      host: body.host,
      port: body.port ?? cur?.port ?? 587,
      secure: body.secure ?? cur?.secure ?? false,
      // undefined = keep (matches port/secure); null = clear; value = set.
      user: body.user !== undefined ? body.user : (cur?.user ?? null),
      pass: this.resolveSecret(body.pass, cur?.pass),
      from: body.from,
      to: body.to,
    };
  }
}
