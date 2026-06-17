/**
 * Notification framework — channel-agnostic event dispatch. Mirrors Narratorr's
 * notifier in spirit (fire-and-forget fan-out to N channels) but config-driven:
 * no DB-backed settings, no encrypted-secret store, no per-event UI. Channels are
 * turned on by presence of their env config (see config.ts → buildNotifier).
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
  requester: { plexUsername: string };
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

/** Minimal structural logger — Fastify's pino logger satisfies it. */
export interface NotifierLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}
