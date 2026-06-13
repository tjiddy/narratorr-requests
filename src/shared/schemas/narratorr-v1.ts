import { z } from 'zod';
import { isoDateString, prefixedId, listEnvelope } from './v1/common.js';

// =============================================================================
// VENDORED CONTRACT — Narratorr `/api/v1`
//
// This is the keystone artifact. It mirrors the earwitness vendored-contract
// convention: a per-endpoint annotation, a source-file pointer into the
// Narratorr repo, and a `PROPOSED` tag on anything that doesn't exist yet.
//
// Status of the surface (per PLAN.md, grounded in real Narratorr code):
//   - Reads (books, downloads) EXIST in the epic backlog (S3 #1449, S5 #1451).
//   - The request-app action path is NEW and must be FILED as Narratorr stories:
//       * GET  /api/v1/metadata/search   (public Audible search)
//       * POST /api/v1/acquisitions      (idempotent request→acquire command)
//       * GET  /api/v1/acquisitions/:id  (lifecycle projection the app polls)
//
// Contract strategy (Codex-concurred 2026-06-13): this local file is a TEMPORARY
// SEED. Endgame — Narratorr owns the canonical contract, ships OpenAPI (S9), and
// publishes a versioned `@narratorr/api-contract`; this app + earwitness then
// depend on the pinned package and run contract tests instead of vendoring.
// This file is exactly what lands in `narratorr/src/shared/schemas/v1/`.
//
// Anti-drift (Codex risk #2): each PROPOSED endpoint's Narratorr issue must pin
// exact schemas, status codes, and failure modes before we rely on the mock.
// =============================================================================

// --- Enums (mirror Narratorr exactly) ----------------------------------------

// Canonical book lifecycle. Source: narratorr/src/shared/schemas/book.ts:8
// (`BOOK_STATUSES`). The request app projects these into request status.
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

// Download state is two-axis. Source: narratorr/src/shared/schemas/activity.ts.
// `clientStatus` = what the torrent client reports; `pipelineStage` = Narratorr's
// import overlay on a completed download. NOTE: there is no pipelineStage='failed'
// — pipeline failure is clientStatus='failed' + pipelineStage='idle'.
export const CLIENT_STATUSES = ['queued', 'downloading', 'paused', 'completed', 'failed'] as const;
export const clientStatusSchema = z.enum(CLIENT_STATUSES);
export type ClientStatus = z.infer<typeof clientStatusSchema>;

export const PIPELINE_STAGES = ['idle', 'checking', 'pending_review', 'importing', 'imported'] as const;
export const pipelineStageSchema = z.enum(PIPELINE_STAGES);
export type PipelineStage = z.infer<typeof pipelineStageSchema>;

// --- Shared value objects -----------------------------------------------------

export const authorRefSchema = z.object({
  name: z.string(),
  asin: z.string().optional(),
});
export type AuthorRef = z.infer<typeof authorRefSchema>;

export const narratorRefSchema = z.object({ name: z.string() });
export type NarratorRef = z.infer<typeof narratorRefSchema>;

// =============================================================================
// READS — exist in epic backlog
// =============================================================================

// GET /api/v1/books/:publicId            → V1Book              (S3 #1449)
// GET /api/v1/books?status&search&author&series&narrator&sortField&sortDirection&limit&offset
//                                        → { data: V1Book[], total }
// Source: narratorr/src/server/routes/books.ts + src/shared/schemas/book.ts.
export const v1BookSchema = z.object({
  id: prefixedId('bk'),
  title: z.string(),
  authors: z.array(authorRefSchema),
  narrators: z.array(narratorRefSchema),
  coverUrl: z.string().nullable(),
  asin: z.string().nullable(),
  seriesName: z.string().nullable().optional(),
  seriesPosition: z.number().nullable().optional(),
  status: bookStatusSchema,
  createdAt: isoDateString,
});
export type V1Book = z.infer<typeof v1BookSchema>;
export const v1BookListSchema = listEnvelope(v1BookSchema);

// camelCase list filters/sort (S0 convention). All optional.
export const v1BooksQuerySchema = z.object({
  status: bookStatusSchema.optional(),
  search: z.string().optional(),
  author: z.string().optional(),
  series: z.string().optional(),
  narrator: z.string().optional(),
  sortField: z.enum(['title', 'createdAt', 'status']).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type V1BooksQuery = z.infer<typeof v1BooksQuerySchema>;

// GET /api/v1/downloads?limit&offset     → { data: V1Download[], total }  (S5 #1451)
// Source: narratorr/src/server/routes/activity (downloads/activity), activity.ts.
export const v1DownloadSchema = z.object({
  id: prefixedId('dl'),
  bookId: prefixedId('bk'),
  clientStatus: clientStatusSchema,
  pipelineStage: pipelineStageSchema,
  progress: z.number().min(0).max(100),
  updatedAt: isoDateString,
});
export type V1Download = z.infer<typeof v1DownloadSchema>;
export const v1DownloadListSchema = listEnvelope(v1DownloadSchema);

// =============================================================================
// ACTIONS — the request-app path is NEW (file as Narratorr stories)
// =============================================================================

// GET /api/v1/metadata/search?q=         → { data: V1AudibleResult[] }
// PROPOSED — public Audible search; wraps MetadataService.search.
// Source shape: narratorr discover.ts suggestion row + metadata service.
export const v1AudibleResultSchema = z.object({
  asin: z.string(),
  title: z.string(),
  authors: z.array(authorRefSchema),
  narrators: z.array(narratorRefSchema),
  coverUrl: z.string().nullable(),
  duration: z.number().nullable().optional(), // seconds
  publishedDate: z.string().nullable().optional(),
  seriesName: z.string().nullable().optional(),
  seriesPosition: z.number().nullable().optional(),
  language: z.string().nullable().optional(),
});
export type V1AudibleResult = z.infer<typeof v1AudibleResultSchema>;
export const v1AudibleSearchSchema = z.object({ data: z.array(v1AudibleResultSchema) });

export const v1MetadataSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(500),
});

// POST /api/v1/acquisitions   body { asin }   header Idempotency-Key (optional)
//                                        → V1Acquisition
// PROPOSED (recommended model, Codex-approved revision of "search-then-grab"):
// a DOMAIN COMMAND — "auto-acquire this ASIN" — not entity CRUD and not release
// picking. Server composes the existing add + searchImmediately +
// searchAndGrabForBook (release ranking stays server-side).
//
// IDEMPOTENCY (Codex risk #1/#3): idempotent on ASIN *and* honoring an
// Idempotency-Key replay. Same ASIN returns the existing acquisition/book; races
// rely on Narratorr's unique ASIN index (schema.ts:89), not just preflight
// findDuplicate. Retry semantics on an already-`imported` book → "already
// available"; `failed`/`missing` → bounded re-acquire.
export const v1CreateAcquisitionBodySchema = z.object({ asin: z.string().min(1) }).strict();

// Acquisition status projects book lifecycle plus a synthetic 'queued' for the
// brief window before a book row exists.
export const ACQUISITION_STATUSES = [...BOOK_STATUSES, 'queued'] as const;
export const acquisitionStatusSchema = z.enum(ACQUISITION_STATUSES);
export type AcquisitionStatus = z.infer<typeof acquisitionStatusSchema>;

// GET /api/v1/acquisitions/:id           → V1Acquisition  (PROPOSED)
// The single resource the request app polls. A PROJECTION over book + download +
// import (Codex: implement as a projection, NOT a new CRUD table unless audit
// requires one). Collapses the books↔downloads correlation into one lifecycle.
export const v1AcquisitionSchema = z.object({
  id: prefixedId('aq'),
  bookId: prefixedId('bk').nullable(),
  asin: z.string(),
  status: acquisitionStatusSchema,
  progress: z.number().min(0).max(100).nullable().optional(),
  updatedAt: isoDateString,
});
export type V1Acquisition = z.infer<typeof v1AcquisitionSchema>;

// =============================================================================
// ADMIN PATH (NOT used by the request app) — documented for completeness
// =============================================================================
// POST /api/v1/books/:publicId/search  → releases    (S6 #1452)
// POST /api/v1/books/:publicId/grab    → grab result  (S6 #1452)
// The interactive release-picker path. End users never wrangle torrents, so the
// request app uses POST /api/v1/acquisitions instead. Left unmodeled here.
