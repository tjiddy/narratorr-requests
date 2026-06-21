import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { appSettings } from '../../db/schema.js';
import type {
  StoredConnectors,
  ConnectorSettingsDto,
  UpdateConnectorSettingsBody,
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
    return { url: c.narratorr.url, apiKey };
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

  /** Masked view for the Settings page — secrets become has* booleans, never values. */
  async getDto(): Promise<ConnectorSettingsDto> {
    const c = await this.getStored();
    return {
      publicUrl: c.publicUrl,
      narratorr: c.narratorr ? { url: c.narratorr.url, hasApiKey: Boolean(c.narratorr.apiKey) } : null,
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
    return { url: body.url, apiKey };
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
