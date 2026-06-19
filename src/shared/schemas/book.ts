import { z } from 'zod';

// =============================================================================
// Canonical book status — the vendored subset of narratorr's `src/shared/schemas/book.ts`.
//
// This is the slice of narratorr's canonical book vocabulary the request app consumes:
// the lifecycle `status` enum, copied byte-for-byte. It lives at the schemas ROOT (not
// under `v1/`) to mirror narratorr's own layout — narratorr's v1 projections
// (`v1/metadata.ts`, `v1/books.ts`) import `bookStatusSchema` from `../book.js`, and
// keeping the same path here makes the contract a clean lift into `@narratorr/api-contract`
// later. `imported` = available; see `v1/books.ts` for the poll resource and
// `request.service.ts` (`mapBookStatus`) for the status → request-lifecycle collapse.
// =============================================================================
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
