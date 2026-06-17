import type { NotificationsConfig } from '../../config.js';
import { Notifier } from './notifier.service.js';
import { NtfyChannel } from './adapters/ntfy.js';
import { EmailChannel } from './adapters/email.js';
import { WebhookChannel } from './adapters/webhook.js';
import type { NotificationChannel, NotifierLogger } from './types.js';

/**
 * Assemble the dispatcher from config. A channel is included iff its block is set
 * (config.ts only populates a block when its required env vars are present), so an
 * unconfigured app gets a no-op Notifier — `notify()` returns immediately.
 */
export function buildNotifier(cfg: NotificationsConfig, log: NotifierLogger): Notifier {
  const channels: NotificationChannel[] = [];
  if (cfg.ntfy) channels.push(new NtfyChannel(cfg.ntfy));
  if (cfg.email) channels.push(new EmailChannel(cfg.email));
  if (cfg.webhook) channels.push(new WebhookChannel(cfg.webhook));
  if (channels.length > 0) {
    log.info({ channels: channels.map((c) => c.name) }, 'notifications enabled');
  }
  return new Notifier(channels, cfg.publicUrl, log);
}

export { Notifier } from './notifier.service.js';
export type { NotificationEvent, NotificationPayload } from './types.js';
