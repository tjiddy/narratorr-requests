import type { RequestDto } from '@shared/schemas/request';

/**
 * The failure reason to render on a request row, or null to render nothing. Used by all
 * three request-list surfaces (My Requests, the admin queue, the admin User Detail
 * history) so the display decision lives in one pure, testable place.
 *
 * A reason is shown only for a `failed` request that actually carries one — a failed
 * request with no reason (e.g. a legacy row, or a transient that never wrote one) renders
 * cleanly with no empty reason block. `failureReason` on a non-`failed` row is ignored.
 */
export function requestFailureReason(r: Pick<RequestDto, 'status' | 'failureReason'>): string | null {
  if (r.status !== 'failed') return null;
  return r.failureReason ?? null;
}
