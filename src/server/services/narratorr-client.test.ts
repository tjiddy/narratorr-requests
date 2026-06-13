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

  it('is idempotent on ASIN for createAcquisition', async () => {
    const a = await client.createAcquisition('B07KCQDQR9');
    const b = await client.createAcquisition('B07KCQDQR9');
    expect(a.id).toBe(b.id);
    expect(a.bookId).toBe(b.bookId);
  });

  it('getAcquisition reflects a pre-imported library book as imported', async () => {
    const acq = await client.createAcquisition('B075FYBP8H'); // Dune, inLibrary
    const fetched = await client.getAcquisition(acq.id);
    expect(fetched.status).toBe('imported');
    expect(fetched.progress).toBe(100);
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

  it('returns 404 for an unknown acquisition id', async () => {
    await expect(client.getAcquisition('aq_doesnotexist')).rejects.toMatchObject({
      upstreamStatus: 404,
    });
  });
});
