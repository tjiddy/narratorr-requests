/**
 * Notification framework — channel-agnostic event dispatch. Mirrors Narratorr's
 * notifier in spirit (fire-and-forget fan-out to N channels). The config it runs on is
 * the decrypted connector settings from ConnectorSettingsService.getNotificationsConfig()
 * (edited in the admin Settings UI, secrets stored encrypted); buildNotifier assembles a
 * channel for each populated block — see ./index.ts.
 */

/**
 * Everything the app can notify about, as a discriminated union keyed on `event`.
 * Each member carries exactly the data that event needs — the renderer and the
 * adapters narrow on `event`. Add an event by adding a member here, a `case` in
 * render(), and (only if it carries channel-specific data) a branch in the adapters
 * that read the payload directly (ntfy cover icon, webhook body).
 */
export type NotificationPayload =
  | {
      event: 'request.created';
      request: {
        publicId: string;
        title: string;
        author: string | null;
        asin: string;
        coverUrl: string | null;
      };
      requester: { username: string };
    }
  | {
      event: 'user.pending';
      user: {
        publicId: string;
        username: string;
        email: string | null;
        authProvider: string;
      };
    };

/** The set of event keys — the discriminant of NotificationPayload. */
export type NotificationEvent = NotificationPayload['event'];

/** Human-facing message, rendered once and handed to every channel. */
export interface RenderedMessage {
  title: string;
  body: string;
  /** Deep link to act on the event (admin queue / users page), or null if PUBLIC_URL is unset. */
  url: string | null;
}

/** What each channel's send() receives: the structured event + the rendered message. */
export interface SendContext {
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
