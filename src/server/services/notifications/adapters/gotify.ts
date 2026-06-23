import type { NotificationChannel, SendContext } from '../types.js';

// Recipe vendored from narratorr's src/core/notifiers/gotify.ts (develop), rewired to our
// render() output and throw-on-failure contract. The server URL is admin-configured (NOT
// secret); the app token authenticates via the X-Gotify-Key header and IS a secret.

export interface GotifyConfig {
  serverUrl: string;
  appToken: string;
}

export class GotifyChannel implements NotificationChannel {
  readonly name = 'gotify';
  constructor(private readonly cfg: GotifyConfig) {}

  async send({ message }: SendContext): Promise<void> {
    // Normalize the trailing slash so a pasted base ("https://gotify/") doesn't double it.
    const url = `${this.cfg.serverUrl.replace(/\/+$/, '')}/message`;
    const body = {
      title: message.title,
      message: message.url ? `${message.body}\n${message.url}` : message.body,
      priority: 5,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Gotify-Key': this.cfg.appToken },
      body: JSON.stringify(body),
      // Bound the call — see ntfy adapter.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Gotify responded ${res.status}`);
  }
}
