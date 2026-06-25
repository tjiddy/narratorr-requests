// Pure parse-and-guard for the per-user request-quota input. Pulled out of
// QuotaControl.saveQuota (UserDetailPage.tsx) so the null-vs-zero-vs-junk decision
// is unit-testable without a DOM (vitest node env), matching the helper pattern in
// quota-display.ts / settings-narratorr.ts / settings-notifiers.ts.
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
// Numeric grammar is the strict digits-only `/^\d+$/` shared with `parseLimit`
// (settings-default-quota.ts) — issue #77 aligned the two quota inputs so they reject
// the same non-canonical forms. Exponent (`'1e2'`), hex (`'0x10'`) and trailing-`.0`
// (`'1.0'`) strings — which a bare `Number()` would coerce to a finite integer — are
// rejected here, as are decimals (`'1.5'`), negatives, NaN (`'abc'`) and `'Infinity'`.
// `0` is a real cap (block-all), preserved — never folded to null; see parseLimit for
// the opposite default-quota semantics where `0` collapses to null/unlimited.
export function parseQuota(input: string): number | null | undefined {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return undefined; // decimals, exponent/hex, negatives, junk
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return undefined; // a digit string past the safe-integer range
  return value;
}
