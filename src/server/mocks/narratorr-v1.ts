import { http, HttpResponse, type RequestHandler } from 'msw';
import { setupServer } from 'msw/node';
import type {
  V1AudibleResult,
  V1Acquisition,
  V1Book,
  AcquisitionStatus,
} from '../../shared/schemas/narratorr-v1.js';
import { errorBody } from '../../shared/schemas/v1/common.js';
import { publicId } from '../util/ids.js';
import { MOCK_BASE_URL } from './constants.js';

// Base origin the standalone client points at; MSW intercepts requests to it so
// the whole app runs with no Narratorr instance. (Defined in ./constants to keep
// it importable without pulling msw.)
export { MOCK_BASE_URL };

// ---------------------------------------------------------------------------
// Fixtures — a small mock Audible catalog. ASINs in PRE_IMPORTED simulate a book
// Narratorr already imported, so re-requesting one exercises the "already
// available" retry path (PLAN: re-request of imported → already available).
// ---------------------------------------------------------------------------
const CATALOG: V1AudibleResult[] = [
  {
    asin: 'B07KCQDQR9',
    title: 'Project Hail Mary',
    authors: [{ name: 'Andy Weir' }],
    narrators: [{ name: 'Ray Porter' }],
    coverUrl: null,
    duration: 58980,
    publishedDate: '2021-05-04',
    language: 'english',
  },
  {
    asin: 'B002V1A0WE',
    title: 'The Name of the Wind',
    authors: [{ name: 'Patrick Rothfuss' }],
    narrators: [{ name: 'Nick Podehl' }],
    coverUrl: null,
    duration: 97860,
    publishedDate: '2009-08-04',
    seriesName: 'The Kingkiller Chronicle',
    seriesPosition: 1,
    language: 'english',
  },
  {
    asin: 'B0182AKKQQ',
    title: 'The Wise Man’s Fear',
    authors: [{ name: 'Patrick Rothfuss' }],
    narrators: [{ name: 'Nick Podehl' }],
    coverUrl: null,
    duration: 152760,
    publishedDate: '2011-03-01',
    seriesName: 'The Kingkiller Chronicle',
    seriesPosition: 2,
    language: 'english',
  },
  {
    asin: 'B017V4IM1G',
    title: 'Mistborn: The Final Empire',
    authors: [{ name: 'Brandon Sanderson' }],
    narrators: [{ name: 'Michael Kramer' }],
    coverUrl: null,
    duration: 88260,
    publishedDate: '2010-08-04',
    seriesName: 'Mistborn',
    seriesPosition: 1,
    language: 'english',
  },
  {
    asin: 'B0036I54I6',
    title: 'The Way of Kings',
    authors: [{ name: 'Brandon Sanderson' }],
    narrators: [{ name: 'Kate Reading' }, { name: 'Michael Kramer' }],
    coverUrl: null,
    duration: 161940,
    publishedDate: '2010-08-31',
    seriesName: 'The Stormlight Archive',
    seriesPosition: 1,
    language: 'english',
  },
  {
    asin: 'B00OXWYU0M',
    title: 'Red Rising',
    authors: [{ name: 'Pierce Brown' }],
    narrators: [{ name: 'Tim Gerard Reynolds' }],
    coverUrl: null,
    duration: 56040,
    publishedDate: '2014-01-28',
    seriesName: 'Red Rising Saga',
    seriesPosition: 1,
    language: 'english',
  },
  {
    asin: 'B075FYBP8H',
    title: 'Dune',
    authors: [{ name: 'Frank Herbert' }],
    narrators: [{ name: 'Scott Brick' }, { name: 'Euan Morton' }],
    coverUrl: null,
    duration: 75660,
    publishedDate: '2007-11-02',
    seriesName: 'Dune',
    seriesPosition: 1,
    language: 'english',
  },
  {
    asin: 'B008V94T9M',
    title: 'The Lies of Locke Lamora',
    authors: [{ name: 'Scott Lynch' }],
    narrators: [{ name: 'Michael Page' }],
    coverUrl: null,
    duration: 80820,
    publishedDate: '2012-09-04',
    seriesName: 'Gentleman Bastard',
    seriesPosition: 1,
    language: 'english',
  },
];

const byAsin = new Map(CATALOG.map((f) => [f.asin, f]));

// ASINs that simulate books Narratorr has already imported (acquisition is
// immediately `imported`).
const PRE_IMPORTED = new Set<string>(['B017V4IM1G', 'B075FYBP8H']);

// ---------------------------------------------------------------------------
// In-memory acquisition state with a time-based lifecycle. A fresh acquisition
// advances searching → downloading → importing → imported over ~9s so the
// status poller can be observed driving a request to `available`.
// ---------------------------------------------------------------------------
interface AcqState {
  id: string;
  asin: string;
  bookId: string;
  createdAtMs: number;
  preImported: boolean;
}

const STAGE_MS = { search: 2000, download: 4000, import: 3000 };

const acqByAsin = new Map<string, AcqState>();
const acqById = new Map<string, AcqState>();
const idempotencyKeyToAsin = new Map<string, string>();

/** Reset all mock state — for tests and clean restarts. */
export function resetMockNarratorrState(): void {
  acqByAsin.clear();
  acqById.clear();
  idempotencyKeyToAsin.clear();
}

function project(state: AcqState, nowMs: number): { status: AcquisitionStatus; progress: number } {
  if (state.preImported) return { status: 'imported', progress: 100 };
  const elapsed = nowMs - state.createdAtMs;
  if (elapsed < STAGE_MS.search) return { status: 'searching', progress: 0 };
  if (elapsed < STAGE_MS.search + STAGE_MS.download) {
    const p = Math.round(((elapsed - STAGE_MS.search) / STAGE_MS.download) * 100);
    return { status: 'downloading', progress: Math.min(99, Math.max(1, p)) };
  }
  if (elapsed < STAGE_MS.search + STAGE_MS.download + STAGE_MS.import) {
    return { status: 'importing', progress: 100 };
  }
  return { status: 'imported', progress: 100 };
}

function toAcquisitionDto(state: AcqState, nowMs: number): V1Acquisition {
  const { status, progress } = project(state, nowMs);
  return {
    id: state.id,
    bookId: state.bookId,
    asin: state.asin,
    status,
    progress,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

function fixtureToBook(f: V1AudibleResult, bookId: string, status: V1Book['status']): V1Book {
  return {
    id: bookId,
    title: f.title,
    authors: f.authors,
    narrators: f.narrators,
    coverUrl: f.coverUrl,
    asin: f.asin,
    seriesName: f.seriesName ?? null,
    seriesPosition: f.seriesPosition ?? null,
    status,
    createdAt: new Date(0).toISOString(),
  };
}

function requireApiKey(request: Request): Response | null {
  if (!request.headers.get('x-api-key')) {
    return HttpResponse.json(errorBody('UNAUTHORIZED', 'Missing X-Api-Key'), { status: 401 });
  }
  return null;
}

/** MSW handlers implementing the vendored `/api/v1` contract against fixtures. */
export function narratorrV1Handlers(baseUrl: string = MOCK_BASE_URL): RequestHandler[] {
  return [
    // Public Audible search (PROPOSED).
    http.get(`${baseUrl}/api/v1/metadata/search`, ({ request }) => {
      const unauth = requireApiKey(request);
      if (unauth) return unauth;
      const q = (new URL(request.url).searchParams.get('q') ?? '').trim().toLowerCase();
      if (!q) return HttpResponse.json(errorBody('BAD_REQUEST', 'q is required'), { status: 400 });
      const data: V1AudibleResult[] = CATALOG.filter((f) => {
        const hay = `${f.title} ${f.authors.map((a) => a.name).join(' ')} ${f.seriesName ?? ''}`.toLowerCase();
        return hay.includes(q);
      });
      return HttpResponse.json({ data });
    }),

    // Idempotent acquire command (PROPOSED).
    http.post(`${baseUrl}/api/v1/acquisitions`, async ({ request }) => {
      const unauth = requireApiKey(request);
      if (unauth) return unauth;
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return HttpResponse.json(errorBody('BAD_REQUEST', 'invalid JSON'), { status: 400 });
      }
      const asin = (body as { asin?: unknown }).asin;
      if (typeof asin !== 'string' || !asin) {
        return HttpResponse.json(errorBody('BAD_REQUEST', 'asin is required'), { status: 400 });
      }
      if (!byAsin.has(asin)) {
        return HttpResponse.json(errorBody('NOT_FOUND', `unknown asin ${asin}`), { status: 404 });
      }

      const idemKey = request.headers.get('idempotency-key');
      const replayAsin = idemKey ? idempotencyKeyToAsin.get(idemKey) : undefined;
      const effectiveAsin = replayAsin ?? asin;

      let state = acqByAsin.get(effectiveAsin);
      if (!state) {
        state = {
          id: publicId('aq'),
          asin: effectiveAsin,
          bookId: publicId('bk'),
          createdAtMs: Date.now(),
          preImported: PRE_IMPORTED.has(effectiveAsin),
        };
        acqByAsin.set(effectiveAsin, state);
        acqById.set(state.id, state);
      }
      if (idemKey) idempotencyKeyToAsin.set(idemKey, effectiveAsin);

      return HttpResponse.json(toAcquisitionDto(state, Date.now()), { status: 201 });
    }),

    // Acquisition projection the request app polls (PROPOSED).
    http.get(`${baseUrl}/api/v1/acquisitions/:id`, ({ request, params }) => {
      const unauth = requireApiKey(request);
      if (unauth) return unauth;
      const state = acqById.get(String(params.id));
      if (!state) {
        return HttpResponse.json(errorBody('NOT_FOUND', 'acquisition not found'), { status: 404 });
      }
      return HttpResponse.json(toAcquisitionDto(state, Date.now()));
    }),

    // Book reads (S3 #1449). Library = preImported fixtures + acquisitions that reached imported.
    http.get(`${baseUrl}/api/v1/books/:id`, ({ request, params }) => {
      const unauth = requireApiKey(request);
      if (unauth) return unauth;
      const state = acqById.get(String(params.id)) ?? [...acqById.values()].find((s) => s.bookId === String(params.id));
      if (!state) return HttpResponse.json(errorBody('NOT_FOUND', 'book not found'), { status: 404 });
      const fixture = byAsin.get(state.asin)!;
      const { status } = project(state, Date.now());
      return HttpResponse.json(fixtureToBook(fixture, state.bookId, status === 'queued' ? 'wanted' : status));
    }),
  ];
}

/** A configured msw/node server for standalone boot. */
export function createMockNarratorrServer(baseUrl: string = MOCK_BASE_URL): ReturnType<typeof setupServer> {
  return setupServer(...narratorrV1Handlers(baseUrl));
}
