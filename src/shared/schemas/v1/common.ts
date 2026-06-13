import { z } from 'zod';

// ============================================================================
// Narratorr /api/v1 shared envelopes & conventions.
//
// These mirror the conventions locked by Narratorr epic story S0 (#1442), the
// authoritative ADR for the public API:
//   - offset/limit pagination
//   - list envelope { data, total }  (NOT a bare array)
//   - error envelope { error: { code, message } }
//   - ISO-8601 date strings
//   - camelCase filter/sort params (sortField, sortDirection, author, ...)
//   - request bodies use Zod .strict()
//
// This app reuses the SAME envelopes for its own client-facing API so there is
// one shape to learn. The intended home in Narratorr is
// `src/shared/schemas/v1/common.ts` — this file is the lift-and-shift seed.
// ============================================================================

/**
 * ISO-8601 timestamp string (e.g. "2026-06-13T12:00:00.000Z"). Accepts a bare date
 * or a full datetime with optional fractional seconds and timezone — but not
 * arbitrary strings, so contract drift on date fields is caught.
 */
export const isoDateString = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/,
    'must be an ISO-8601 date or datetime',
  );

/**
 * Opaque public-ID schema for a given prefix. S1 (#1443, PR #1456) introduces
 * `bk_`/`au_`/`nr_`/`sr_`/`dl_` opaque IDs; this app adds `aq_`/`us_`/`rq_`.
 * The contract NEVER uses numeric rowids.
 */
export const prefixedId = (prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9]+$`), `must be a "${prefix}_" public id`);

// --- Pagination ---------------------------------------------------------------

/** Default page size when a list endpoint omits `limit`. */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

/** Query params accepted by every paginated list endpoint. Coerced from strings. */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** `{ data, total }` list envelope, parameterized by the item schema. */
export const listEnvelope = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ data: z.array(item), total: z.number().int().nonnegative() });

export interface ListEnvelope<T> {
  data: T[];
  total: number;
}

// --- Errors -------------------------------------------------------------------

/** `{ error: { code, message } }` — the v1 error envelope (S0). */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/** Build an error envelope value. */
export const errorBody = (code: string, message: string): ErrorEnvelope => ({
  error: { code, message },
});
