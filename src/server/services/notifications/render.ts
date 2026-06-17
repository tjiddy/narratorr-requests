import type { NotificationEvent, NotificationPayload, RenderedMessage } from './types.js';

/**
 * Build the human-facing message for an event. Centralized so every channel says
 * the same thing. `baseUrl` is the app's public origin (no trailing slash) or null;
 * when set, the message deep-links to the admin queue.
 */
export function render(
  event: NotificationEvent,
  payload: NotificationPayload,
  baseUrl: string | null,
): RenderedMessage {
  const url = baseUrl ? `${baseUrl}/admin` : null;
  const { request, requester } = payload;

  switch (event) {
    case 'request.created': {
      const by = request.author ? ` by ${request.author}` : '';
      return {
        title: 'New audiobook request',
        body: `${requester.username} requested “${request.title}”${by}.`,
        url,
      };
    }
    default: {
      // Exhaustiveness guard: a new NotificationEvent without a case here is a
      // compile error, not a silent generic message.
      const _exhaustive: never = event;
      return { title: 'Notification', body: String(_exhaustive), url };
    }
  }
}
