import type { NotificationChannel, SendContext } from '../types.js';

export interface NtfyConfig {
  /** Base URL, no trailing slash — e.g. https://ntfy.sh or a self-hosted instance. */
  url: string;
  topic: string;
  /** Optional access token for protected topics (sent as a bearer). */
  token: string | null;
  /** Optional ntfy priority: 1..5 or min/low/default/high/max. */
  priority: string | null;
}

/**
 * ntfy (https://ntfy.sh) publish: POST the message body to `<url>/<topic>`, with
 * metadata in headers. Header values are ASCII-safe (the static title + URLs); the
 * UTF-8 message text rides in the body. Action buttons (Approve/Deny) are a future
 * add via the `Actions` header once the tokened endpoints exist.
 */
export class NtfyChannel implements NotificationChannel {
  readonly name = 'ntfy';
  constructor(private readonly cfg: NtfyConfig) {}

  async send({ payload, message }: SendContext): Promise<void> {
    const headers: Record<string, string> = { Title: message.title };
    if (this.cfg.token) headers.Authorization = `Bearer ${this.cfg.token}`;
    if (this.cfg.priority) headers.Priority = this.cfg.priority;
    if (message.url) headers.Click = message.url;
    // Only request events carry a cover; user.pending has no image to attach.
    if (payload.event === 'request.created' && payload.request.coverUrl) {
      headers.Icon = payload.request.coverUrl;
    }

    const res = await fetch(`${this.cfg.url}/${this.cfg.topic}`, {
      method: 'POST',
      headers,
      body: message.body,
      // Bound the call — notify() fires per request, so a black-holing endpoint
      // must not accumulate hung sockets/promises over the app's lifetime.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`ntfy responded ${res.status}`);
  }
}
