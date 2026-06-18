import type { NotificationPayload, RenderedMessage } from './types.js';

/**
 * Build the human-facing message for an event. Centralized so every channel says
 * the same thing. `baseUrl` is the app's public origin (no trailing slash) or null;
 * when set, the message deep-links to the page where the admin acts on the event.
 */
export function render(payload: NotificationPayload, baseUrl: string | null): RenderedMessage {
  switch (payload.event) {
    case 'request.created': {
      const { request, requester } = payload;
      const by = request.author ? ` by ${request.author}` : '';
      return {
        title: 'New audiobook request',
        body: `${requester.username} requested “${request.title}”${by}.`,
        // The admin acts on a request in the queue.
        url: baseUrl ? `${baseUrl}/admin` : null,
      };
    }
    case 'user.pending': {
      const { user } = payload;
      // Local signups have no IdP to name; OIDC users do.
      const via = user.authProvider === 'local' ? '' : ` via ${user.authProvider}`;
      const contact = user.email ? ` (${user.email})` : '';
      return {
        title: 'New user awaiting approval',
        body: `${user.username}${contact} signed up${via} and is waiting for your approval.`,
        // The admin approves a user on the Users page, not the request queue.
        url: baseUrl ? `${baseUrl}/users` : null,
      };
    }
    default: {
      // Exhaustiveness guard: a new event without a case here is a compile error,
      // not a silent generic message.
      const _exhaustive: never = payload;
      return { title: 'Notification', body: String(_exhaustive), url: baseUrl };
    }
  }
}
