import type { RequestStatus } from '@shared/schemas/request';
import type { BadgeVariant } from './Badge';

// User-facing labels for the request lifecycle. The internal enum stays
// pending/approved/acquiring/available/denied/failed (no DB migration); these are
// only what we show. "Requested" reads better than "pending" from the requester's
// POV, and "Processing" covers narratorr's search→download→import span (which is
// why `acquiring` shows a live pulse dot in StatusBadge).
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'Requested',
  approved: 'Approved',
  acquiring: 'Processing',
  available: 'Available',
  denied: 'Denied',
  failed: 'Failed',
};

export const REQUEST_STATUS_VARIANT: Record<RequestStatus, BadgeVariant> = {
  pending: 'warning',
  approved: 'info',
  acquiring: 'info',
  available: 'success',
  denied: 'muted',
  failed: 'danger',
};
