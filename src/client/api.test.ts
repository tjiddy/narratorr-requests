import { describe, it, expect, vi, afterEach } from 'vitest';
import { getMe, requestBookFrom, ApiError } from './api';
import type { V1AudibleResult } from '@shared/schemas/v1/metadata';

// parse<T> (api.ts:23) is a private module function — not exported — so its HTTP
// failure contract is exercised through an exported wrapper (`getMe`) that ends in
// `.then(parse<…>)`, with a stubbed `fetch`. Response.text() is single-use, so each
// stubbed call returns a FRESH Response (mockResolvedValueOnce).
function stubFetch(res: Response): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValueOnce(res);
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe('parse (via getMe wrapper)', () => {
  it('resolves undefined on an ok response with an empty body', async () => {
    stubFetch(new Response('', { status: 200 }));
    await expect(getMe()).resolves.toBeUndefined();
  });

  it('resolves the parsed object on an ok JSON response', async () => {
    stubFetch(new Response(JSON.stringify({ user: { username: 'todd' } }), { status: 200 }));
    await expect(getMe()).resolves.toEqual({ user: { username: 'todd' } });
  });

  it('rejects with ApiError carrying exact status/code/message from a full envelope', async () => {
    stubFetch(new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'nope' } }), { status: 403 }));
    const err = await getMe().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: 'FORBIDDEN', message: 'nope' });
  });

  it('falls back the code to HTTP_${status} when the envelope omits code', async () => {
    stubFetch(new Response(JSON.stringify({ error: { message: 'broke' } }), { status: 500 }));
    const err = await getMe().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 500, code: 'HTTP_500', message: 'broke' });
  });

  it('falls back both code and message for an empty error object', async () => {
    stubFetch(new Response(JSON.stringify({ error: {} }), { status: 502 }));
    const err = await getMe().catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: 'HTTP_502', message: 'Request failed (502)' });
  });

  it('falls back when the envelope is missing entirely', async () => {
    stubFetch(new Response(JSON.stringify({}), { status: 404 }));
    const err = await getMe().catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 404, code: 'HTTP_404', message: 'Request failed (404)' });
  });

  it('maps a non-JSON error body to code NON_JSON', async () => {
    stubFetch(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    const err = await getMe().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 502, code: 'NON_JSON', message: 'Unexpected non-JSON response (502)' });
  });
});

describe('requestBookFrom body builder', () => {
  const base: V1AudibleResult = {
    asin: 'B07',
    title: 'Dune',
    authors: [],
    narrators: [],
    cover: null,
  };

  async function captureBody(result: V1AudibleResult): Promise<Record<string, unknown>> {
    const mock = stubFetch(new Response(JSON.stringify({}), { status: 200 }));
    await requestBookFrom(result);
    const init = mock.mock.calls[0]![1] as RequestInit;
    return JSON.parse(init.body as string);
  }

  it('sends author:null / narrator:null for empty credit arrays', async () => {
    const body = await captureBody({ ...base, authors: [], narrators: [] });
    expect(body).toMatchObject({ asin: 'B07', title: 'Dune', author: null, narrator: null });
  });

  it('takes only the first author and first narrator', async () => {
    const body = await captureBody({
      ...base,
      authors: [{ name: 'Alice' }, { name: 'B' }],
      narrators: [{ name: 'Bob' }],
    });
    expect(body.author).toBe('Alice');
    expect(body.narrator).toBe('Bob');
  });

  it('renames `cover` to `coverUrl` (present and null)', async () => {
    expect(await captureBody({ ...base, cover: 'https://img/c.jpg' })).toMatchObject({
      coverUrl: 'https://img/c.jpg',
    });
    expect(await captureBody({ ...base, cover: null })).toMatchObject({ coverUrl: null });
  });
});
