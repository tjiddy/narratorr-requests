/**
 * Notification framework — channel-agnostic event dispatch. Mirrors Narratorr's
 * notifier in spirit (fire-and-forget fan-out to N channels). The config it runs on is
 * the decrypted connector settings from ConnectorSettingsService.getNotificationsConfig()
 * (edited in the admin Settings UI, secrets stored encrypted); buildNotifier assembles a
 * channel for each populated block — see ./index.ts.
 */

/** Events the app can emit. One today; widen the union as more are added. */
export type NotificationEvent = 'request.created';

/**
 * Structured data the renderer + adapters draw from. A single shape today; promote
 * to a discriminated union keyed on event when a second event needs different data.
 */
export interface NotificationPayload {
  request: {
    publicId: string;
    title: string;
    author: string | null;
    asin: string;
    coverUrl: string | null;
  };
  requester: { username: string };
}

/** Human-facing message, rendered once and handed to every channel. */
export interface RenderedMessage {
  title: string;
  body: string;
  /** Deep link to act on the event (the admin queue), or null if PUBLIC_URL is unset. */
  url: string | null;
}

export interface SendContext {
  event: NotificationEvent;
  payload: NotificationPayload;
  message: RenderedMessage;
}

/**
 * One delivery channel (ntfy, email, webhook). `send` resolves on success and
 * REJECTS on failure — the dispatcher isolates and logs failures so one dead
 * channel never affects the others or the caller.
 */
export interface NotificationChannel {
  readonly name: string;
  send(ctx: SendContext): Promise<void>;
}

/**
 * Decrypted notification config the dispatcher is built from. Produced by the
 * connector-settings service (reads the DB, decrypts secrets); a channel block is
 * null when unconfigured. Shapes mirror the adapter configs.
 */
export interface NotificationsConfig {
  publicUrl: string | null;
  ntfy: { url: string; topic: string; token: string | null; priority: string | null } | null;
  email: {
    host: string;
    port: number;
    secure: boolean;
    user: string | null;
    pass: string | null;
    from: string;
    to: string;
  } | null;
  webhook: { url: string } | null;
}

/** Minimal structural logger — Fastify's pino logger satisfies it. */
export interface NotifierLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}
