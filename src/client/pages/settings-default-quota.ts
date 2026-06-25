import { DEFAULT_QUOTA_LIMIT_MAX } from '@shared/schemas/connectors';
import type { ConnectorSettingsDto, UpdateConnectorSettingsBody, QuotaWindowDays } from '@shared/schemas/connectors';

// Default-request-quota card form state + decision logic. Pulled out of SettingsConnection as
// pure functions so the unit↔days mapping, payload build/validate, unlimited handling, the
// `= N days` hint and the dirty check are unit-tested without a DOM (vitest node env), matching
// the other client logic helpers (e.g. settings-narratorr.ts). The admin picks a friendly
// day/week/month unit; we map it to a FIXED rolling-window day count (no calendar period).

export type QuotaUnit = 'day' | 'week' | 'month';

/** Fixed friendly-unit → rolling-window-days map. The single source of truth both directions. */
export const UNIT_DAYS: Record<QuotaUnit, QuotaWindowDays> = { day: 1, week: 7, month: 30 };

/** Ordered units for the dropdown. */
export const QUOTA_UNITS: QuotaUnit[] = ['day', 'week', 'month'];

const DAYS_UNIT: Record<number, QuotaUnit> = { 1: 'day', 7: 'week', 30: 'month' };

export type DefaultQuotaState = {
  /** The limit as typed (string-backed number input). Blank = unlimited. */
  limit: string;
  unit: QuotaUnit;
};

/** Seed the form from the saved DTO. `limit: null` (unlimited) → blank; days → its unit. */
export const initDefaultQuota = (q: ConnectorSettingsDto['defaultQuota']): DefaultQuotaState => ({
  limit: q.limit === null ? '' : String(q.limit),
  unit: DAYS_UNIT[q.windowDays] ?? 'month',
});

/** The concrete rolling-window days for a unit (day=1, week=7, month=30). */
export const unitToDays = (unit: QuotaUnit): number => UNIT_DAYS[unit];

/** The `= N days` hint rendered next to the unit dropdown (e.g. month → `= 30 days`). */
export const daysLabel = (unit: QuotaUnit): string => `= ${UNIT_DAYS[unit]} days`;

/**
 * Parse the typed limit into a payload value. Blank/0 → null (unlimited), matching the old
 * DEFAULT_REQUEST_QUOTA semantics. A positive integer up to {@link DEFAULT_QUOTA_LIMIT_MAX} → that
 * number. Anything else (decimal, negative, non-numeric, past the ceiling, or a digit string so
 * long it parses past the safe-integer range) is invalid — the caller blocks the save. Guarding the
 * ceiling + `Number.isSafeInteger` here mirrors the server `.max()` cap so the client rejects the
 * same values the API would, instead of letting an out-of-range value `Number()`-round to `Infinity`
 * → `null` and silently submit "unlimited".
 */
export type LimitParse = { ok: true; value: number | null } | { ok: false };

export const parseLimit = (raw: string): LimitParse => {
  const t = raw.trim();
  if (t === '') return { ok: true, value: null };
  if (!/^\d+$/.test(t)) return { ok: false }; // decimals, negatives, junk
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n > DEFAULT_QUOTA_LIMIT_MAX) return { ok: false }; // past the shared ceiling / unsafe
  return { ok: true, value: n === 0 ? null : n };
};

/** Whether the typed limit is acceptable (drives the Save button alongside the dirty check). */
export const isLimitValid = (raw: string): boolean => parseLimit(raw).ok;

/**
 * Build the PUT payload from the form. Assumes a valid limit (the component only submits when
 * {@link isLimitValid}); an invalid limit degrades to unlimited rather than throwing. Always
 * sends `windowDays` (the unit dropdown is the source of truth).
 */
export const buildDefaultQuota = (s: DefaultQuotaState): NonNullable<UpdateConnectorSettingsBody['defaultQuota']> => {
  const parsed = parseLimit(s.limit);
  return { limit: parsed.ok ? parsed.value : null, windowDays: UNIT_DAYS[s.unit] };
};

/**
 * Dirty when the normalized limit (blank/0 both → unlimited) or the unit differs from the saved
 * baseline. An invalid current limit counts as dirty (so the user sees the Save affordance to
 * correct it) by falling back to a raw-string compare; the baseline is always valid.
 */
export const isDefaultQuotaDirty = (s: DefaultQuotaState, initial: DefaultQuotaState): boolean => {
  if (s.unit !== initial.unit) return true;
  const cur = parseLimit(s.limit);
  const base = parseLimit(initial.limit);
  if (!cur.ok || !base.ok) return s.limit.trim() !== initial.limit.trim();
  return cur.value !== base.value;
};
