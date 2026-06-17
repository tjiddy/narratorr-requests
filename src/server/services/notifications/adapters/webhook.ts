import type { NotificationChannel, SendContext } from '../types.js';

export interface WebhookConfig {
  url: string;
}

/**
 * Generic JSON webhook. The body carries a `content` string so the SAME URL works
 * as a Discord webhook (Discord renders `content` and ignores the extra fields),
 * while a generic consumer gets the structured event/request/requester data.
 */
export class WebhookChannel implements NotificationChannel {
  readonly name = 'webhook';
  constructor(private readonly cfg: WebhookConfig) {}

  async send({ event, payload, message }: SendContext): Promise<void> {
    const content = [message.title, message.body, message.url].filter(Boolean).join('\n');
    const res = await fetch(this.cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content,
        event,
        request: payload.request,
        requester: payload.requester,
        url: message.url,
      }),
      // Bound the call — see ntfy adapter: a hung endpoint must not leak sockets.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`webhook responded ${res.status}`);
  }
}
