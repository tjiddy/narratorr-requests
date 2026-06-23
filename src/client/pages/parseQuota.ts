// Pure parse-and-guard for the per-user request-quota input. Pulled out of
// QuotaControl.saveQuota (UserDetailPage.tsx) so the null-vs-zero-vs-junk decision
// is unit-testable without a DOM (vitest node env), matching the helper pattern in
// quota-display.ts / settings-narratorr.ts / settings-channels.ts.
//
// Behaviour-preserving extraction of the original inline logic:
//   const trimmed = quota.trim();
//   const value = trimmed === '' ? null : Number(trimmed);
//   if (value !== null && (!Number.isInteger(value) || value < 0)) return; // ignore junk
//
// The three outcomes map to the `requestQuota: z.number().int().min(0).nullable()`
// PATCH contract (src/shared/schemas/user.ts):
//   - null      → clear the quota ("use app default")
//   - number    → a finite non-negative integer cap (incl. 0)
//   - undefined → junk; caller should NOT mutate (silent no-op, as before)
//
// Numeric grammar intentionally mirrors `Number(trimmed)` for backwards
// compatibility, so any string that coerces to a finite non-negative integer is
// accepted — including `'1e2'` (→ 100), `'0x10'` (→ 16) and `'1.0'` (→ 1). The
// `Number.isInteger` guard rejects decimals (`'1.5'`), NaN (`'abc'`) and the
// non-integer `Infinity` (`Number('Infinity')`).
export function parseQuota(input: string): number | null | undefined {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) return undefined;
  return value;
}
