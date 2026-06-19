import { z } from 'zod';
import { bookStatusSchema } from '../book.js';
import { isoDateString, prefixedId } from './common.js';
import { authorRefSchema, narratorRefSchema, seriesRefSchema } from './refs.js';

// =============================================================================
// VENDORED CONTRACT — Narratorr `/api/v1`, endpoints 2 & 3: the book resource.
// (See `./metadata.ts` for the integration overview + endpoint 1.)
//
// The request app owns requests/approval/quota/notifications; narratorr owns the
// library. An approved request adds the book by ASIN, then polls it until `imported`
// (= available). There is NO idempotency key: an add for an ASIN that already exists
// returns 409 with `existingId`, which the client resolves into the existing book — so
// an add is effectively idempotent by ASIN. Single resources are returned BARE (no
// `{ data }` wrapper).
// =============================================================================

// --- 2. Add the book — POST /api/v1/books { asin } → V1Book (bare, 201) -------
// The "I want this book" command: narratorr hydrates the ASIN and creates the book. The
// body is `{ asin }` only — acquisition is NOT the caller's to control; when/how the book
// is searched follows narratorr's OWN operator settings. So a freshly added book may sit
// at `wanted` until the operator's next scheduled search sweep — normal, not a failure.
// Response codes carry the semantics (no idempotency key):
//   - 201 → newly created; returns the bare V1Book.
//   - 409 → a book with this ASIN already EXISTS (lost-response retry, or a second user
//           wanting it). Body { error, existingId }; the client resolves `existingId`, so
//           the add is idempotent by ASIN — no duplicate created, nothing re-grabbed.
//   - 422 → ASIN can't be resolved (not_found / invalid_record); no book created (terminal).
//   - 429 → metadata provider rate-limited; retry after a backoff (transient).
export const v1AddBookBodySchema = z.object({ asin: z.string().min(1) }).strict();

// --- 3. Poll — GET /api/v1/books/:publicId → V1Book (bare) --------------------
// The single resource the request app polls (also the shape POST /books returns). `status`
// is narratorr's authoritative library lifecycle, copied straight from the book record;
// available = `imported`; 404 only if the publicId doesn't resolve.
//
// KNOWN GAP: a search that finds nothing leaves the book at `wanted` indefinitely (it does
// NOT flip to `failed`). The request app doesn't second-guess this with a timer — such a
// request simply stays `acquiring` (in progress) until narratorr resolves it; an admin can
// deny it manually. Timing is narratorr's, not ours. We consume only `id` + `status`;
// everything else is modeled leniently.
export const v1BookSchema = z.object({
  id: prefixedId('bk'),
  title: z.string(),
  authors: z.array(authorRefSchema),
  narrators: z.array(narratorRefSchema),
  series: seriesRefSchema.nullable().optional(),
  coverUrl: z.string().nullable().optional(),
  asin: z.string().nullable().optional(),
  status: bookStatusSchema,
  createdAt: isoDateString.optional(),
});
export type V1Book = z.infer<typeof v1BookSchema>;
