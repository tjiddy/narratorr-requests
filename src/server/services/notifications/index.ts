import { Notifier } from './notifier.service.js';
import { NtfyChannel } from './adapters/ntfy.js';
import { EmailChannel } from './adapters/email.js';
import { WebhookChannel } from './adapters/webhook.js';
import type { NotificationChannel, NotifierLogger, NotificationsConfig } from './types.js';

export type NotificationChannelKey = 'ntfy' | 'email' | 'webhook';

/**
 * Single owner of "a config block becomes a live channel". Returns null when that
 * channel isn't configured. Used by both buildNotifier (fan-out) and the Settings
 * "Test" endpoint, so adding a channel is a one-line change here, not two in lockstep.
 */
export function buildChannel(key: NotificationChannelKey, cfg: NotificationsConfig): NotificationChannel | null {
  switch (key) {
    case 'ntfy':
      return cfg.ntfy ? new NtfyChannel(cfg.ntfy) : null;
    case 'email':
      return cfg.email ? new EmailChannel(cfg.email) : null;
    case 'webhook':
      return cfg.webhook ? new WebhookChannel(cfg.webhook) : null;
  }
}

const ALL_CHANNELS: NotificationChannelKey[] = ['ntfy', 'email', 'webhook'];

/**
 * Assemble the dispatcher from the decrypted connector config. A channel is included
 * iff its block is populated, so an unconfigured app gets a no-op Notifier — `notify()`
 * returns immediately.
 */
export function buildNotifier(cfg: NotificationsConfig, log: NotifierLogger): Notifier {
  const channels = ALL_CHANNELS.map((k) => buildChannel(k, cfg)).filter((c): c is NotificationChannel => c !== null);
  if (channels.length > 0) {
    log.info({ channels: channels.map((c) => c.name) }, 'notifications enabled');
  }
  return new Notifier(channels, cfg.publicUrl, log);
}

export { Notifier } from './notifier.service.js';
export { render } from './render.js';
export type {
  NotificationEvent,
  NotificationPayload,
  NotificationsConfig,
  NotificationChannel,
  SendContext,
} from './types.js';
