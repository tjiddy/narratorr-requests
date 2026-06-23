import { z } from 'zod';

// =============================================================================
// The notification event-key contract — the single source of truth for "what can
// the app notify about", shared between client and server.
//
// This module owns ONLY the event-key union + their UI labels. The payload DATA
// shapes (request / requester / user) stay server-side in
// `src/server/services/notifications/types.ts`, which imports `NotificationEvent`
// from here and keeps `NotificationPayload['event']` in lockstep via a type-level
// assertion (a new payload variant without a label entry — or vice-versa — is a
// compile error). server → shared is the correct dependency direction; this module
// imports nothing from server.
//
// The client renders the per-notifier event checkboxes from `NOTIFICATION_EVENTS`;
// the shared notifier schema validates `events.min(1)` against `notificationEventSchema`.
// =============================================================================

/** Every event a notifier can subscribe to, with its human label (checkbox text). */
export const NOTIFICATION_EVENTS = [
  { key: 'request.created', label: 'New request' },
  { key: 'user.pending', label: 'New signup' },
] as const;

/** The event-key union — the discriminant of NotificationPayload (asserted in types.ts). */
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number]['key'];

/** Runtime validator for a single event key (used by the notifier schemas). */
export const notificationEventSchema = z.enum(
  NOTIFICATION_EVENTS.map((e) => e.key) as [NotificationEvent, ...NotificationEvent[]],
);
