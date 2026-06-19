import type { V1AudibleResult } from '@shared/schemas/v1/metadata';
import type { RequestStatus } from '@shared/schemas/request';
import type { BadgeVariant } from './Badge';

/**
 * What a BookCard's action area should show, resolved from two independent signals:
 *   - `requestedStatus` — THIS viewer's own request on this ASIN (if they have one).
 *   - `library` — narratorr's library status for this ASIN (issue #1537), present for
 *     any book narratorr already owns, regardless of who added it.
 *
 * Precedence (most-actionable wins):
 *   1. Library `imported` → "In library". The book is available now; requesting is
 *      pointless. This overrides even the viewer's own request row — an imported book
 *      IS that request's happy outcome, so "In library" beats a stale "Requested".
 *   2. The viewer's own request → their personal request badge (Requested / Denied / …).
 *      It's their explicit, actionable state and outranks a library row owned by others.
 *   3. Library in-flight (wanted / searching / downloading / importing) → "On the way":
 *      narratorr is already acquiring it, so don't offer a duplicate request.
 *   4. Otherwise (library failed/missing/absent AND no request of their own) → Request.
 *
 * narratorr emits the raw BookStatus only; the tri-state collapse lives here by design.
 */
export type BookCardState =
  | { kind: 'request' }
  | { kind: 'request-status'; status: RequestStatus }
  | { kind: 'library'; label: string; variant: BadgeVariant; pulse: boolean };

export function resolveBookCardState(
  library: V1AudibleResult['library'],
  requestedStatus: RequestStatus | undefined,
): BookCardState {
  if (library?.status === 'imported') {
    return { kind: 'library', label: 'In library', variant: 'success', pulse: false };
  }
  if (requestedStatus) return { kind: 'request-status', status: requestedStatus };
  if (library && library.status !== 'failed' && library.status !== 'missing') {
    // wanted | searching | downloading | importing — narratorr is acquiring it.
    return { kind: 'library', label: 'On the way', variant: 'info', pulse: true };
  }
  return { kind: 'request' };
}
