import { z } from 'zod';
import { Notifier } from './notifier.service.js';
import { NtfyChannel } from './adapters/ntfy.js';
import { EmailChannel } from './adapters/email.js';
import { WebhookChannel } from './adapters/webhook.js';
import { NOTIFIER_TYPES, type NotifierType } from '../../../shared/notifier-registry.js';
import type { NotificationEvent } from '../../../shared/notification-events.js';
import type {
  NotificationChannel,
  NotifierLogger,
  NotificationsConfig,
  RuntimeNotifier,
  SendContext,
} from './types.js';

// =============================================================================
// Adapter map — the single owner of "a runtime (decrypted) config becomes a live
// channel", keyed by notifier type. Replaces the old hardcoded buildChannel switch +
// ALL_CHANNELS list: adding a future type is a new registry entry + a new adapter here,
// no edits to the dispatch wiring. Each builder validates the runtime config with a
// per-type schema (the runtime-plaintext shape) and throws on a bad/undecryptable
// config — buildNotifier catches that and skips the notifier (degrades gracefully).
// =============================================================================

const ntfyRuntimeSchema = z.object({
  url: z.string(),
  topic: z.string(),
  token: z.string().nullable(),
  priority: z.string().nullable(),
});
const emailRuntimeSchema = z.object({
  host: z.string(),
  port: z.number(),
  secure: z.boolean(),
  user: z.string().nullable(),
  pass: z.string().nullable(),
  from: z.string(),
  to: z.string(),
});
const webhookRuntimeSchema = z.object({ url: z.string().min(1) });

type AdapterBuilder = (config: Record<string, unknown>) => NotificationChannel;

const ADAPTERS: Record<NotifierType, AdapterBuilder> = {
  ntfy: (c) => new NtfyChannel(ntfyRuntimeSchema.parse(c)),
  email: (c) => new EmailChannel(emailRuntimeSchema.parse(c)),
  webhook: (c) => new WebhookChannel(webhookRuntimeSchema.parse(c)),
};

/**
 * Build a live channel for a known notifier type from its runtime (decrypted) config.
 * Returns null for an unknown type. Used by the Settings notifier "Test" endpoint; the
 * dispatcher (buildNotifier) uses the same adapter map. Throws if the config fails the
 * type's runtime schema (e.g. a required secret that wouldn't decrypt).
 */
export function buildNotifierChannel(type: string, config: Record<string, unknown>): NotificationChannel | null {
  const builder = ADAPTERS[type as NotifierType];
  return builder ? builder(config) : null;
}

/**
 * A channel wrapper that delivers ONLY events in the notifier's `events` set — the
 * per-notifier event routing. The dispatcher fans every event to every channel; this
 * filter drops the ones a given notifier didn't subscribe to.
 */
class EventFilteredChannel implements NotificationChannel {
  constructor(
    private readonly inner: NotificationChannel,
    private readonly events: ReadonlySet<NotificationEvent>,
    readonly name: string,
  ) {}

  async send(ctx: SendContext): Promise<void> {
    if (this.events.has(ctx.payload.event)) await this.inner.send(ctx);
  }
}

function buildOne(nf: RuntimeNotifier, log: NotifierLogger): NotificationChannel | null {
  if (!nf.enabled) return null;
  let inner: NotificationChannel | null;
  try {
    inner = buildNotifierChannel(nf.type, nf.config);
  } catch (err) {
    // A bad/undecryptable runtime config must not brick the whole dispatcher — skip it.
    log.warn({ notifier: nf.id, type: nf.type, err }, 'notifier could not be built — skipping');
    return null;
  }
  if (!inner) {
    // Unknown type (not in the registry) — defensively skipped at build.
    log.warn({ notifier: nf.id, type: nf.type }, 'unknown notifier type — skipping');
    return null;
  }
  return new EventFilteredChannel(inner, new Set(nf.events), `${nf.type}:${nf.name}`);
}

/**
 * Assemble the dispatcher from the decrypted notifier list. Each enabled notifier of a
 * known type becomes an event-filtered channel; disabled / unknown / unbuildable ones
 * are skipped. An empty result yields a no-op Notifier — `notify()` returns immediately.
 */
export function buildNotifier(cfg: NotificationsConfig, log: NotifierLogger): Notifier {
  const channels = cfg.notifiers
    .map((nf) => buildOne(nf, log))
    .filter((c): c is NotificationChannel => c !== null);
  if (channels.length > 0) {
    log.info({ channels: channels.map((c) => c.name) }, 'notifications enabled');
  }
  return new Notifier(channels, cfg.publicUrl, log);
}

export { NOTIFIER_TYPES };
export { Notifier } from './notifier.service.js';
export { render } from './render.js';
export type {
  NotificationEvent,
  NotificationPayload,
  NotificationsConfig,
  RuntimeNotifier,
  NotificationChannel,
  SendContext,
} from './types.js';
