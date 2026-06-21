import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildRouteApp, type RouteHarness } from '../test-support/route-harness.js';
import { insertUser } from '../test-support/db.js';
import { registerSearchRoutes } from './search.js';
import { tooManyRequests } from '../util/errors.js';
import { NarratorrError } from '../services/narratorr-client.js';

const SCRUB = 'A required service is temporarily unavailable. Please try again.';
const RAW_UPSTREAM = 'Narratorr GET /metadata/search timed out';

const sample = { asin: 'B07', title: 'Dune', authors: [], narrators: [], cover: null };

let h: RouteHarness;
beforeEach(async () => {
  h = await buildRouteApp({ register: registerSearchRoutes });
});
afterEach(async () => {
  await h.app.close();
  vi.restoreAllMocks();
});

const search = (q: string | null, cookies: Record<string, string> = {}) =>
  h.app.inject({ method: 'GET', url: q === null ? '/api/search' : `/api/search?q=${encodeURIComponent(q)}`, cookies });

// The query schema is on the querystring (search.ts:15), so Fastify validates `q` BEFORE the
// in-handler requireActiveUser() runs. Auth/authz cases therefore send a VALID q so they reach
// the gate; invalid-q cases are the 400s and their auth status is moot.
describe('GET /api/search — auth gate (valid q reaches the handler)', () => {
  it('anon → 401 UNAUTHORIZED', async () => {
    const res = await search('dune');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('pending user → 403 ACCOUNT_PENDING', async () => {
    const user = await insertUser(h.db, { role: 'user', status: 'pending' });
    const res = await search('dune', h.cookieFor(user));
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ACCOUNT_PENDING');
  });

  it('rejected user → 403 ACCOUNT_REJECTED', async () => {
    const user = await insertUser(h.db, { role: 'user', status: 'rejected' });
    const res = await search('dune', h.cookieFor(user));
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ACCOUNT_REJECTED');
  });
});

describe('GET /api/search — query validation (fires before the auth gate)', () => {
  it('omitted / empty / whitespace-only q → 400 BAD_REQUEST', async () => {
    for (const url of ['/api/search', '/api/search?q=', '/api/search?q=%20%20%20']) {
      const res = await h.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error.code, url).toBe('BAD_REQUEST');
    }
  });

  it('501-char q (.max(500)) → 400 BAD_REQUEST', async () => {
    const res = await search('x'.repeat(501));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });
});

describe('GET /api/search — handler', () => {
  it('active user, results → 200 and delegates with the authenticated user id + validated query', async () => {
    const user = await insertUser(h.db, { role: 'user', status: 'active' });
    const searchSpy = vi.spyOn(h.search, 'search').mockResolvedValue([sample]);

    const res = await search('dune', h.cookieFor(user));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [sample] });
    // Pin the delegation contract (search.ts:18): the handler must forward the AUTHENTICATED
    // user's id and the validated `q`, not some other user or a stale/raw query value —
    // a mock that returns the same data for any args would otherwise mask a wiring bug.
    expect(searchSpy).toHaveBeenCalledWith(user.id, 'dune');
  });

  it('service throws SEARCH_THROTTLED → 429', async () => {
    const user = await insertUser(h.db, { role: 'user', status: 'active' });
    vi.spyOn(h.search, 'search').mockRejectedValue(tooManyRequests('SEARCH_THROTTLED', 'Too many searches — slow down a moment.'));

    const res = await search('dune', h.cookieFor(user));
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('SEARCH_THROTTLED');
  });

  it('service throws a generic NarratorrError → 502 scrubbed, raw upstream message absent', async () => {
    const user = await insertUser(h.db, { role: 'user', status: 'active' });
    vi.spyOn(h.search, 'search').mockRejectedValue(new NarratorrError(0, 'NETWORK', RAW_UPSTREAM));

    const res = await search('dune', h.cookieFor(user));
    expect(res.statusCode).toBe(502);
    const { error } = res.json();
    expect(error.code).toBe('NARRATORR_UPSTREAM');
    expect(error.message).toBe(SCRUB);
    expect(res.body).not.toContain(RAW_UPSTREAM);
  });
});

describe('GET /api/search — narratorr unconfigured', () => {
  it('active user, valid q → 503 NOT_CONFIGURED, message preserved', async () => {
    const u = await buildRouteApp({ register: registerSearchRoutes, narratorrConfigured: false });
    try {
      const user = await insertUser(u.db, { role: 'user', status: 'active' });
      const res = await u.app.inject({ method: 'GET', url: '/api/search?q=dune', cookies: u.cookieFor(user) });
      expect(res.statusCode).toBe(503);
      const { error } = res.json();
      expect(error.code).toBe('NOT_CONFIGURED');
      expect(error.message).not.toBe(SCRUB);
    } finally {
      await u.app.close();
    }
  });
});
