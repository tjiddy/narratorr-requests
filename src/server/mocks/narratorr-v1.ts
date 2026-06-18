import { http, HttpResponse, type RequestHandler } from 'msw';
import type { V1AudibleResult, V1Book, BookStatus } from '../../shared/schemas/narratorr-v1.js';
import { errorBody } from '../../shared/schemas/v1/common.js';
import { publicId } from '../util/ids.js';
import { MOCK_BASE_URL } from './constants.js';

// TEST FIXTURE ONLY. These handlers back the contract tests (narratorr-client.test.ts
// etc.) — there is no standalone runtime mode anymore; production always talks to a
// real narratorr configured via the Settings UI. MOCK_BASE_URL lives in ./constants so
// it's importable without pulling msw into a runtime path.
export { MOCK_BASE_URL };

// ---------------------------------------------------------------------------
// Fixtures — a small mock Audible catalog. ASINs in PRE_IMPORTED simulate a book
// Narratorr already imported, so re-requesting one exercises the "already
// available" path (POST /books returns an `imported` book, no re-grab).
// ---------------------------------------------------------------------------
const CATALOG: V1AudibleResult[] = [
  {
    asin: 'B07KCQDQR9',
    title: 'Project Hail Mary',
    authors: [{ name: 'Andy Weir' }],
    narrators: [{ name: 'Ray Porter' }],
    cover: null,
    duration: 58980,
    publishedDate: '2021-05-04',
    language: 'english',
  },
  {
    asin: 'B002V1A0WE',
    title: 'The Name of the Wind',
    authors: [{ name: 'Patrick Rothfuss' }],
    narrators: [{ name: 'Nick Podehl' }],
    cover: null,
    duration: 97860,
    publishedDate: '2009-08-04',
    series: { name: 'The Kingkiller Chronicle', position: 1 },
    language: 'english',
  },
  {
    asin: 'B0182AKKQQ',
    title: 'The Wise Man’s Fear',
    authors: [{ name: 'Patrick Rothfuss' }],
    narrators: [{ name: 'Nick Podehl' }],
    cover: null,
    duration: 152760,
    publishedDate: '2011-03-01',
    series: { name: 'The Kingkiller Chronicle', position: 2 },
    language: 'english',
  },
  {
    asin: 'B017V4IM1G',
    title: 'Mistborn: The Final Empire',
    authors: [{ name: 'Brandon Sanderson' }],
    narrators: [{ name: 'Michael Kramer' }],
    cover: null,
    duration: 88260,
    publishedDate: '2010-08-04',
    series: { name: 'Mistborn', position: 1 },
    language: 'english',
  },
  {
    asin: 'B0036I54I6',
    title: 'The Way of Kings',
    authors: [{ name: 'Brandon Sanderson' }],
    narrators: [{ name: 'Kate Reading' }, { name: 'Michael Kramer' }],
    cover: null,
    duration: 161940,
    publishedDate: '2010-08-31',
    series: { name: 'The Stormlight Archive', position: 1 },
    language: 'english',
  },
  {
    asin: 'B00OXWYU0M',
    title: 'Red Rising',
    authors: [{ name: 'Pierce Brown' }],
    narrators: [{ name: 'Tim Gerard Reynolds' }],
    cover: null,
    duration: 56040,
    publishedDate: '2014-01-28',
    series: { name: 'Red Rising Saga', position: 1 },
    language: 'english',
  },
  {
    asin: 'B075FYBP8H',
    title: 'Dune',
    authors: [{ name: 'Frank Herbert' }],
    narrators: [{ name: 'Scott Brick' }, { name: 'Euan Morton' }],
    cover: null,
    duration: 75660,
    publishedDate: '2007-11-02',
    series: { name: 'Dune', position: 1 },
    language: 'english',
  },
  {
    asin: 'B008V94T9M',
    title: 'The Lies of Locke Lamora',
    authors: [{ name: 'Scott Lynch' }],
    narrators: [{ name: 'Michael Page' }],
    cover: null,
    duration: 80820,
    publishedDate: '2012-09-04',
    series: { name: 'Gentleman Bastard', position: 1 },
    language: 'english',
  },
];

const byAsin = new Map(CATALOG.map((f) => [f.asin, f]));

// ASINs that simulate books Narratorr has already imported (status is immediately
// `imported`).
const PRE_IMPORTED = new Set<string>(['B017V4IM1G', 'B075FYBP8H']);

// ---------------------------------------------------------------------------
// In-memory book state with a time-based lifecycle. A freshly-added book advances
// searching → downloading → importing → imported over ~9s so the status poller can
// be observed driving a request to `available`.
// ---------------------------------------------------------------------------
interface BookState {
  id: string;
  asin: string;
  createdAtMs: number;
  preImported: boolean;
}

const STAGE_MS = { search: 2000, download: 4000, import: 3000 };

const bookByAsin = new Map<string, BookState>();
const bookById = new Map<string, BookState>();

/** Reset all mock state — for tests and clean restarts. */
export function resetMockNarratorrState(): void {
  bookByAsin.clear();
  bookById.clear();
}

function projectStatus(state: BookState, nowMs: number): BookStatus {
  if (state.preImported) return 'imported';
  const elapsed = nowMs - state.createdAtMs;
  if (elapsed < STAGE_MS.search) return 'searching';
  if (elapsed < STAGE_MS.search + STAGE_MS.download) return 'downloading';
  if (elapsed < STAGE_MS.search + STAGE_MS.download + STAGE_MS.import) return 'importing';
  return 'imported';
}

/**
 * Library cross-reference for a search result (narratorr #1537): a result is annotated
 * iff narratorr already has a book record for that ASIN (added in this session), with
 * the live projected status. Absent otherwise — exactly the contract the consumer codes
 * against. So: search → request → search again now shows "On the way" / "In library".
 */
function libraryFor(asin: string, nowMs: number): V1AudibleResult['library'] {
  const state = bookByAsin.get(asin);
  if (!state) return undefined;
  return { bookId: state.id, status: projectStatus(state, nowMs) };
}

function toBook(state: BookState, nowMs: number): V1Book {
  const f = byAsin.get(state.asin)!;
  return {
    id: state.id,
    title: f.title,
    authors: f.authors,
    narrators: f.narrators,
    series: f.series ?? null,
    coverUrl: f.cover,
    asin: f.asin,
    status: projectStatus(state, nowMs),
    createdAt: new Date(state.createdAtMs).toISOString(),
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
    // 1. Audible metadata search (v1.1, TO BUILD).
    http.get(`${baseUrl}/api/v1/metadata/search`, ({ request }) => {
      const unauth = requireApiKey(request);
      if (unauth) return unauth;
      const q = (new URL(request.url).searchParams.get('q') ?? '').trim().toLowerCase();
      if (!q) return HttpResponse.json(errorBody('BAD_REQUEST', 'q is required'), { status: 400 });
      const now = Date.now();
      const data: V1AudibleResult[] = CATALOG.filter((f) => {
        const hay = `${f.title} ${f.authors.map((a) => a.name).join(' ')} ${f.series?.name ?? ''}`.toLowerCase();
        return hay.includes(q);
      }).map((f) => {
        const library = libraryFor(f.asin, now);
        return library ? { ...f, library } : f;
      });
      return HttpResponse.json({ data, total: data.length });
    }),

    // 2. Add the book by ASIN (v1.1, TO BUILD). 201 new / 409 already-exists / 422 unhydratable.
    http.post(`${baseUrl}/api/v1/books`, async ({ request }) => {
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
      // Unhydratable ASIN (provider can't resolve it) → 422, no book created.
      if (!byAsin.has(asin)) {
        return HttpResponse.json(errorBody('not_found', `cannot hydrate asin ${asin}`), { status: 422 });
      }

      // Already in the library → 409 with the existing id (NOT a duplicate, no re-grab).
      const existing = bookByAsin.get(asin);
      if (existing) {
        return HttpResponse.json(
          { ...errorBody('book_exists', 'A book with this ASIN already exists.'), existingId: existing.id },
          { status: 409 },
        );
      }

      const state: BookState = {
        id: publicId('bk'),
        asin,
        createdAtMs: Date.now(),
        preImported: PRE_IMPORTED.has(asin),
      };
      bookByAsin.set(asin, state);
      bookById.set(state.id, state);
      return HttpResponse.json(toBook(state, Date.now()), { status: 201 });
    }),

    // 3. Poll the book's lifecycle (SHIPPED, #1441).
    http.get(`${baseUrl}/api/v1/books/:id`, ({ request, params }) => {
      const unauth = requireApiKey(request);
      if (unauth) return unauth;
      const state = bookById.get(String(params.id));
      if (!state) return HttpResponse.json(errorBody('NOT_FOUND', 'book not found'), { status: 404 });
      return HttpResponse.json(toBook(state, Date.now()));
    }),
  ];
}
