import { z } from 'zod';
import { bookStatusSchema } from '../book.js';
import { authorRefSchema, narratorRefSchema, seriesRefSchema } from './refs.js';

// =============================================================================
// VENDORED CONTRACT — Narratorr `/api/v1`, endpoint 1 of 3: metadata search.
//
// Source of truth: narratorr/NARRATORR-V1.1-REQUEST-APP-INTEGRATION.md. The whole
// integration is three calls (no acquisition entity, no upstream lifecycle mirrored):
//   1. GET  /api/v1/metadata/search?q=  → { data: V1AudibleResult[], total }   (this file)
//   2. POST /api/v1/books { asin }       → V1Book                              (./books.ts)
//   3. GET  /api/v1/books/:publicId      → V1Book                              (./books.ts)
//
// SERVER-TO-SERVER ONLY: narratorr's key is a secret and CORS isn't configured, so these
// run from OUR backend (NarratorrClient), never the browser — the browser only talks to
// this app's own `/api/*`. IDs are opaque base64url (`bk_…`); the schemas assert only
// what THIS app consumes and stay lenient on decoration, so provider drift on an unused
// field never 502s a call. Conventions (envelopes/ids/dates) live in `./common.ts`.
// =============================================================================

// Pre-library Audible results: an `asin` (load-bearing — it's what you POST to add the
// book), NOT a publicId. No match → { data: [], total: 0 } with 200 (never 404). Shape
// verified against live narratorr: `cover` (not coverUrl) and a nested
// `series: { name, position }` (position can be fractional, e.g. 2.5).
export const v1AudibleResultSchema = z.object({
  asin: z.string(),
  title: z.string(),
  authors: z.array(authorRefSchema),
  narrators: z.array(narratorRefSchema),
  cover: z.string().nullable(),
  series: seriesRefSchema.nullable().optional(),
  publishedDate: z.string().nullable().optional(),
  duration: z.number().nullable().optional(), // seconds (not sent today; tolerated)
  language: z.string().nullable().optional(),
  // Library cross-reference (narratorr #1537): narratorr annotates each result with its
  // OWN library status for that ASIN, so the UI can show "In library" / "On the way"
  // instead of a redundant Request button. The raw BookStatus comes from narratorr; the
  // tri-state collapse is the consumer's (see client/components/book-card-state.ts).
  // Additive + best-effort: absent when narratorr can't annotate, `null` when the book
  // isn't owned, and `.catch(undefined)` degrades a malformed/unknown-status annotation to
  // "not owned" rather than 502-ing the whole search — this is decoration, never
  // load-bearing like the poll `status` in ./books.ts. `bookId` is an opaque `bk_…`.
  library: z
    .object({ bookId: z.string(), status: bookStatusSchema })
    .nullable()
    .optional()
    .catch(undefined),
});
export type V1AudibleResult = z.infer<typeof v1AudibleResultSchema>;

// Non-strict: ignores `total` (we only read `.data`).
export const v1AudibleSearchSchema = z.object({ data: z.array(v1AudibleResultSchema) });

// `GET /api/v1/metadata/search` query — `q` trimmed, 1..500 (the same bound narratorr enforces).
export const v1MetadataSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(500),
});
