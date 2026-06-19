import { z } from 'zod';

// =============================================================================
// Shared v1 value objects — the people + series refs that appear inside both the
// metadata-search result (`./metadata.ts`) and the book resource (`./books.ts`).
//
// Consumer note: narratorr emits DIFFERENT people shapes per context — pre-library
// search results carry `{ name, asin? }`, library books carry `{ id, name }`. narratorr
// models each strictly (it OWNS the contract and fails closed). The consumer instead
// deliberately uses ONE lenient, non-strict ref that tolerates BOTH: `{ name, asin? }`
// ignores a library ref's extra `id` and a search ref's absent `asin`. One shape to
// parse, no per-endpoint divergence, and provider drift on an unused people field never
// 502s us. Defined once here so the two resource schemas don't duplicate it.
// =============================================================================

/** Author credit: `{ name, asin? }` — lenient; tolerates a library ref's ignored `id`
 *  and a search ref's optional `asin`. */
export const authorRefSchema = z.object({ name: z.string(), asin: z.string().optional() });
export type AuthorRef = z.infer<typeof authorRefSchema>;

/** Narrator credit: `{ name }` — narrators never carry an asin. */
export const narratorRefSchema = z.object({ name: z.string() });
export type NarratorRef = z.infer<typeof narratorRefSchema>;

/** Series membership: `{ name, position? }`. `position` can be fractional (e.g. 2.5)
 *  and is nullable/absent; callers apply `.nullable().optional()` at the use site. */
export const seriesRefSchema = z.object({
  name: z.string(),
  position: z.number().nullable().optional(),
});
export type SeriesRef = z.infer<typeof seriesRefSchema>;
