import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { NarratorrClient, NarratorrError } from './narratorr-client.js';
import { narratorrV1Handlers, resetMockNarratorrState, MOCK_BASE_URL } from '../mocks/narratorr-v1.js';

const server = setupServer(...narratorrV1Handlers());

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetMockNarratorrState();
});
afterAll(() => server.close());

const client = new NarratorrClient({ baseUrl: MOCK_BASE_URL, apiKey: 'test-key' });

describe('NarratorrClient parsing (happy path against the mock)', () => {
  it('parses metadata search results through the contract', async () => {
    const results = await client.searchMetadata('hail mary');
    expect(results).toHaveLength(1);
    expect(results[0]?.asin).toBe('B07KCQDQR9');
    expect(results[0]?.title).toBe('Project Hail Mary');
  });

  it('is idempotent on ASIN for addBook (201 then 409→existingId resolves to the same book)', async () => {
    const a = await client.addBook('B07KCQDQR9'); // 201 created
    const b = await client.addBook('B07KCQDQR9'); // 409 + existingId → fetched
    expect(a.id).toBe(b.id);
  });

  it('surfaces an unhydratable ASIN as a terminal 422 upstream error', async () => {
    await expect(client.addBook('B000UNKNOWN')).rejects.toMatchObject({ upstreamStatus: 422 });
  });

  it('getBook reflects a pre-imported library book as imported', async () => {
    const added = await client.addBook('B075FYBP8H'); // Dune, already in library
    const fetched = await client.getBook(added.id);
    expect(fetched.status).toBe('imported');
  });
});

describe('NarratorrClient error handling', () => {
  it('maps the v1 error envelope to a NarratorrError carrying upstream status + code', async () => {
    server.use(
      http.get(`${MOCK_BASE_URL}/api/v1/metadata/search`, () =>
        HttpResponse.json({ error: { code: 'BOOM', message: 'kaboom' } }, { status: 503 }),
      ),
    );
    await expect(client.searchMetadata('x')).rejects.toMatchObject({
      statusCode: 502,
      upstreamStatus: 503,
      upstreamCode: 'BOOM',
    });
  });

  it('flags a contract mismatch when the body has the wrong shape', async () => {
    server.use(
      http.get(`${MOCK_BASE_URL}/api/v1/metadata/search`, () =>
        HttpResponse.json({ data: [{ asin: 123 }] }),
      ),
    );
    const err = await client.searchMetadata('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NarratorrError);
    expect((err as NarratorrError).upstreamCode).toBe('CONTRACT_MISMATCH');
  });

  it('surfaces a missing API key as a 401 upstream error', async () => {
    const keyless = new NarratorrClient({ baseUrl: MOCK_BASE_URL, apiKey: '' });
    await expect(keyless.searchMetadata('x')).rejects.toMatchObject({
      upstreamStatus: 401,
      upstreamCode: 'UNAUTHORIZED',
    });
  });

  it('returns 404 for an unknown book id', async () => {
    await expect(client.getBook('bk_doesnotexist')).rejects.toMatchObject({
      upstreamStatus: 404,
    });
  });
});
