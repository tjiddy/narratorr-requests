import type { UserDto, RequestQuota, RequestQuotaMode } from '@shared/schemas/user';
import { parsePositiveLimit, isPositiveLimitValid } from './quota-limit';

// Per-user request-quota control decision logic. Pulled out of QuotaControl (UserDetailPage.tsx)
// so the mode↔limit seeding, validation, and patch build are unit-testable without a DOM (vitest
// node env), matching the helper pattern in quota-display.ts / settings-default-quota.ts.
//
// Mode-first, not number-first: the admin picks one of four explicit modes — `inherit` (use the
// app default), `unlimited`, `limited` (a Custom positive cap), or `blocked`. Only `limited`
// carries a number; the shared positive-int field (quota-limit.ts) rejects blank/0/decimal/sci/hex.

export type RequestQuotaState = {
  mode: RequestQuotaMode;
  /** The Custom limit as typed (string-backed). Retained across mode toggles so switching away
   *  from Custom and back keeps the typed value; only consulted when mode = 'limited'. */
  limit: string;
};

/** Seed the control from the user's saved override union. `limited` → Custom mode + its cap;
 *  every other mode → that mode with a blank Custom field. */
export const initRequestQuota = (q: UserDto['requestQuota']): RequestQuotaState => ({
  mode: q.mode,
  limit: q.mode === 'limited' ? String(q.limit) : '',
});

/** `limited` requires a valid positive cap; the other three modes are always valid. */
export const isRequestQuotaValid = (s: RequestQuotaState): boolean =>
  s.mode !== 'limited' || isPositiveLimitValid(s.limit);

/**
 * Build the PATCH `requestQuota` value from the control state, or `undefined` to signal "don't
 * mutate" (a Custom mode with an invalid limit — the caller no-ops, as the old parseQuota did).
 * Non-limited modes are a bare `{ mode }`; `limited` carries the parsed positive cap.
 */
export const buildRequestQuota = (s: RequestQuotaState): RequestQuota | undefined => {
  if (s.mode === 'limited') {
    const parsed = parsePositiveLimit(s.limit);
    return parsed.ok ? { mode: 'limited', limit: parsed.value } : undefined;
  }
  return { mode: s.mode };
};

/** Dirty when the mode changed, or (in Custom mode) the effective limit changed. An invalid typed
 *  limit counts as dirty via a raw-string compare so the Save affordance shows to correct it. */
export const isRequestQuotaDirty = (s: RequestQuotaState, initial: RequestQuotaState): boolean => {
  if (s.mode !== initial.mode) return true;
  if (s.mode !== 'limited') return false; // limit irrelevant for non-Custom modes
  const cur = parsePositiveLimit(s.limit);
  const base = parsePositiveLimit(initial.limit);
  if (!cur.ok || !base.ok) return s.limit.trim() !== initial.limit.trim();
  return cur.value !== base.value;
};
