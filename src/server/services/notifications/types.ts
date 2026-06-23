/**
 * Notification framework — channel-agnostic event dispatch. Mirrors Narratorr's
 * notifier in spirit (fire-and-forget fan-out to N channels). The config it runs on is
 * the decrypted connector settings from ConnectorSettingsService.getNotificationsConfig()
 * (edited in the admin Settings UI, secrets stored encrypted); buildNotifier assembles a
 * channel per enabled notifier — see ./index.ts.
 */
import type { NotificationEvent } from '../../../shared/notification-events.js';

export type { NotificationEvent } from '../../../shared/notification-events.js';

/**
 * Everything the app can notify about, as a discriminated union keyed on `event`.
 * Each member carries exactly the data that event needs — the renderer and the
 * adapters narrow on `event`. The event-key contract (the discriminant + UI labels)
 * lives in shared (`src/shared/notification-events.ts`); this union types each variant's
 * `event` against it and a type-level assertion below keeps the two exactly in sync.
 * Add an event by adding a member here AND a `NOTIFICATION_EVENTS` entry in shared, plus
 * a `case` in render() and (only if it carries channel-specific data) an adapter branch.
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

// Keep NotificationPayload['event'] and the shared NotificationEvent union EXACTLY in
// sync, both directions: a payload variant added without a matching NOTIFICATION_EVENTS
// label entry (or a label key with no payload variant) is a compile error here. This is
// the single source of truth — no parallel hand-maintained list.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;
export type _EventsInSync = AssertTrue<Equals<NotificationPayload['event'], NotificationEvent>>;

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
 * A single decrypted notifier in the shape buildNotifier consumes. `config` is the
 * runtime (plaintext) type-specific config — secrets revealed; the adapter map validates
 * it per type. `type` stays a bare string (an unknown type is skipped at build).
 */
export interface RuntimeNotifier {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  events: NotificationEvent[];
  config: Record<string, unknown>;
}

/**
 * Decrypted notification config the dispatcher is built from. Produced by the
 * connector-settings service (reads the DB, decrypts secrets per the registry's secret
 * metadata). An empty `notifiers` list yields a no-op Notifier.
 */
export interface NotificationsConfig {
  publicUrl: string | null;
  notifiers: RuntimeNotifier[];
}

/** Minimal structural logger — Fastify's pino logger satisfies it. */
export interface NotifierLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}
