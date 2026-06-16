import { z } from 'zod';
import { isoDateString, prefixedId } from './v1/common.js';

// =============================================================================
// VENDORED CONTRACT — Narratorr `/api/v1`
//
// Source of truth: narratorr/NARRATORR-V1.1-REQUEST-APP-INTEGRATION.md (2026-06-15),
// which SUPERSEDED the earlier acquisitions-subsystem design. The integration is
// deliberately tiny — three calls, no acquisition entity, no lifecycle mirrored
// upstream:
//
//   1. GET  /api/v1/metadata/search?q=   → { data: V1AudibleResult[], total }       (TO BUILD, v1.1)
//   2. POST /api/v1/books  { asin }       → V1Book  (bare; 201 new / 409 exists+existingId) (TO BUILD, v1.1)
//   3. GET  /api/v1/books/:publicId       → V1Book  (bare)                            (SHIPPED, #1441)
//
// The request app owns requests/approval/quota/notifications; narratorr owns the
// library. An approved request adds the book by ASIN, then polls the book until its
// status is `imported` (= available). There is NO idempotency key: an add for an
// ASIN that already exists returns 409 with `existingId`, which the client resolves
// into the existing book — so an add is effectively idempotent by ASIN.
//
// SERVER-TO-SERVER ONLY: narratorr's key is a secret and CORS is not configured, so
// these calls run from OUR backend (NarratorrClient), never the browser. The browser
// only ever talks to this app's own `/api/*`.
//
// Single resources are returned BARE (no { data } wrapper); lists use { data, total }.
// IDs are opaque base64url strings (`bk_…`, `au_…`, `nr_…`) — treated as opaque,
// never parsed. Exact field sets lock at narratorr's build (published in OpenAPI);
// the schemas below assert only what THIS app consumes and stay lenient on
// decoration, so provider drift on an unused field never 502s a status poll.
//
// Until endpoints 1–2 ship, they live only in the MSW mock (src/server/mocks).
// =============================================================================

// Canonical book lifecycle. Source: narratorr book record `status`.
export const BOOK_STATUSES = [
  'wanted',
  'searching',
  'downloading',
  'importing',
  'imported',
  'missing',
  'failed',
] as const;
export const bookStatusSchema = z.enum(BOOK_STATUSES);
export type BookStatus = z.infer<typeof bookStatusSchema>;

// --- Shared value objects -----------------------------------------------------
// Search results carry { name, asin? } (pre-library, no publicId); library books
// carry { id, name }. Both pass this lenient (non-strict) shape.
export const authorRefSchema = z.object({ name: z.string(), asin: z.string().optional() });
export type AuthorRef = z.infer<typeof authorRefSchema>;

export const narratorRefSchema = z.object({ name: z.string() });
export type NarratorRef = z.infer<typeof narratorRefSchema>;

// =============================================================================
// 1. Search — GET /api/v1/metadata/search?q=  → { data: V1AudibleResult[], total }
// =============================================================================
// Pre-library Audible results: an `asin` (load-bearing — it's what you POST in
// step 2), NOT a publicId. No match → { data: [], total: 0 } with 200 (never 404).
// Shape verified against live narratorr 2026-06-15: `cover` (not coverUrl) and a
// nested `series: { name, position }` (position can be fractional, e.g. 2.5).
export const v1AudibleResultSchema = z.object({
  asin: z.string(),
  title: z.string(),
  authors: z.array(authorRefSchema),
  narrators: z.array(narratorRefSchema),
  cover: z.string().nullable(),
  series: z
    .object({ name: z.string(), position: z.number().nullable().optional() })
    .nullable()
    .optional(),
  publishedDate: z.string().nullable().optional(),
  duration: z.number().nullable().optional(), // seconds (not sent today; tolerated)
  language: z.string().nullable().optional(),
});
export type V1AudibleResult = z.infer<typeof v1AudibleResultSchema>;

// Non-strict: ignores `total` (we only read `.data`).
export const v1AudibleSearchSchema = z.object({ data: z.array(v1AudibleResultSchema) });

export const v1MetadataSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(500),
});

// =============================================================================
// 2. Add the book — POST /api/v1/books  { asin }  → V1Book (bare, 201)
// =============================================================================
// The "I want this book" command: narratorr hydrates the ASIN and creates the book.
// The body is `{ asin }` only — acquisition is NOT the caller's to control. When/how the
// book is searched follows narratorr's OWN operator settings (its scheduled-search cadence),
// by design: narratorr owns acquisition policy, we just request. So a freshly added book
// may sit at `wanted` until the operator's next scheduled search sweep — that's normal, not
// a failure. We never assume immediate acquisition and we never time out: a request mirrors
// the book's lifecycle and stays `acquiring` until narratorr reports `imported`/`failed`.
// NO idempotency key — the response codes carry the semantics:
//   - 201 → newly created; returns the bare V1Book.
//   - 409 → a book with this ASIN already EXISTS (a lost-response retry, or a second
//           user wanting the same ASIN). Body is { error, existingId }; the client
//           resolves it by fetching `existingId`, so the add is idempotent by ASIN.
//           No duplicate is created, nothing is re-grabbed.
//   - 422 → ASIN can't be resolved (not_found / invalid_record); no book created (terminal).
//   - 429 → metadata provider rate-limited; retry after a backoff (transient).
export const v1AddBookBodySchema = z.object({ asin: z.string().min(1) }).strict();

// =============================================================================
// 3. Poll — GET /api/v1/books/:publicId  → V1Book (bare)
// =============================================================================
// The single resource the request app polls (also the shape POST /books returns).
// `status` is narratorr's authoritative library lifecycle, copied straight from the
// book record. Available = `imported`. 404 only if the publicId doesn't resolve.
//
// KNOWN GAP: a search that finds nothing leaves the book at `wanted` indefinitely
// (it does NOT flip to `failed`). The request app does not try to second-guess this
// with a timer — such a request simply stays `acquiring` (in progress) until narratorr
// resolves it; an admin can deny it manually. Timing is narratorr's, not ours.
//
// We consume only `id` + `status`; everything else is modeled leniently.
export const v1BookSchema = z.object({
  id: prefixedId('bk'),
  title: z.string(),
  authors: z.array(authorRefSchema),
  narrators: z.array(narratorRefSchema),
  series: z
    .object({ name: z.string(), position: z.number().nullable().optional() })
    .nullable()
    .optional(),
  coverUrl: z.string().nullable().optional(),
  asin: z.string().nullable().optional(),
  status: bookStatusSchema,
  createdAt: isoDateString.optional(),
});
export type V1Book = z.infer<typeof v1BookSchema>;
