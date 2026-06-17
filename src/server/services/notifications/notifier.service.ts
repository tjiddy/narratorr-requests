import { render } from './render.js';
import type {
  NotificationChannel,
  NotificationEvent,
  NotificationPayload,
  NotifierLogger,
} from './types.js';

/**
 * Fire-and-forget dispatcher. Fans an event out to every configured channel,
 * isolates failures (one dead channel never blocks the others or the caller), and
 * NEVER throws — callers `void notify(...)` straight from the request path so a
 * flaky notifier can't break request creation.
 */
export class Notifier {
  constructor(
    private readonly channels: NotificationChannel[],
    private readonly baseUrl: string | null,
    private readonly log: NotifierLogger,
  ) {}

  get enabled(): boolean {
    return this.channels.length > 0;
  }

  async notify(event: NotificationEvent, payload: NotificationPayload): Promise<void> {
    if (this.channels.length === 0) return;
    const message = render(event, payload, this.baseUrl);
    await Promise.allSettled(
      this.channels.map(async (ch) => {
        try {
          await ch.send({ event, payload, message });
          this.log.debug({ channel: ch.name, event }, 'notification sent');
        } catch (err) {
          this.log.warn({ channel: ch.name, event, err }, 'notification failed');
        }
      }),
    );
  }
}
