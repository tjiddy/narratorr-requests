import { DEFAULT_QUOTA_LIMIT_MAX } from '@shared/schemas/connectors';

// The shared positive-int "limit field" parse-and-guard, used by BOTH the default-quota card's
// `Limit requests` mode and the per-user `Custom limit` mode. Pulled out as a pure function so the
// strict grammar is unit-tested once without a DOM (vitest node env), matching the helper pattern
// in quota-display.ts / settings-narratorr.ts.
//
// Under the mode redesign a number ONLY ever means a positive cap: blank, `0`, decimals, scientific
// (`1e3`), hex (`0x10`), negatives, and any value past the shared ceiling are ALL rejected. The mode
// control owns "no cap" / "unlimited" — this field never maps blank/0 to unlimited. `/^[1-9]\d*$/`
// admits only a plain positive-integer digit string; `Number.isSafeInteger` + the ceiling reject a
// pasted digit-string tail that would otherwise round to `Infinity`.

export const POSITIVE_LIMIT_RE = /^[1-9]\d*$/;

export type LimitParse = { ok: true; value: number } | { ok: false };

export const parsePositiveLimit = (raw: string): LimitParse => {
  const t = raw.trim();
  if (!POSITIVE_LIMIT_RE.test(t)) return { ok: false }; // blank, 0, decimals, sci, hex, negatives, junk
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n > DEFAULT_QUOTA_LIMIT_MAX) return { ok: false }; // past the shared ceiling / unsafe
  return { ok: true, value: n };
};

/** Whether the typed limit is an acceptable positive cap (drives Save alongside the dirty check). */
export const isPositiveLimitValid = (raw: string): boolean => parsePositiveLimit(raw).ok;
