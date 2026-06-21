import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildRouteApp, type RouteHarness } from '../test-support/route-harness.js';
import { insertUser } from '../test-support/db.js';
import { registerRequestRoutes } from './requests.js';

let h: RouteHarness;
beforeEach(async () => {
  h = await buildRouteApp({ register: registerRequestRoutes });
});
afterEach(async () => {
  await h.app.close();
  vi.restoreAllMocks();
});

const post = (cookies: Record<string, string>, payload: Record<string, unknown>) =>
  h.app.inject({ method: 'POST', url: '/api/requests', cookies, payload });

describe('POST /api/requests — create', () => {
  it('new pending request → 201 and notifies the admin exactly once', async () => {
    const user = await insertUser(h.db, { role: 'user', status: 'active', username: 'alice' });
    const res = await post(h.cookieFor(user), { asin: 'B01', title: 'A Book' });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ asin: 'B01', title: 'A Book', status: 'pending' });
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'request.created',
        request: expect.objectContaining({ asin: 'B01', title: 'A Book' }),
        requester: { username: 'alice' },
      }),
    );
  });

  it('a duplicate (user, asin) → 200 and does NOT re-notify', async () => {
    const user = await insertUser(h.db, { role: 'user', status: 'active' });
    const cookie = h.cookieFor(user);
    await post(cookie, { asin: 'B01', title: 'A Book' }); // first → pending, notifies once
    h.notify.mockClear();

    const dup = await post(cookie, { asin: 'B01', title: 'A Book' });
    expect(dup.statusCode).toBe(200);
    expect(dup.json().status).toBe('pending');
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('admin create auto-approves → 201 acquiring and does NOT notify', async () => {
    const admin = await insertUser(h.db, { role: 'admin', status: 'active' });
    const res = await post(h.cookieFor(admin), { asin: 'B01', title: 'A Book' });

    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('acquiring'); // handoff resolved via the successful fake client
    expect(h.narratorr.added).toEqual(['B01']);
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe('POST /api/requests — validation', () => {
  let cookie: Record<string, string>;
  beforeEach(async () => {
    const user = await insertUser(h.db, { role: 'user', status: 'active' });
    cookie = h.cookieFor(user);
  });

  it('missing asin or title → 400', async () => {
    expect((await post(cookie, { title: 'A Book' })).statusCode).toBe(400);
    expect((await post(cookie, { asin: 'B01' })).statusCode).toBe(400);
  });

  it('whitespace-only asin or title → 400', async () => {
    expect((await post(cookie, { asin: '   ', title: 'A Book' })).statusCode).toBe(400);
    expect((await post(cookie, { asin: 'B01', title: '   ' })).statusCode).toBe(400);
  });

  it('coverUrl: only https is accepted (SSRF guard)', async () => {
    const base = { asin: 'B01', title: 'A Book' };
    expect((await post(cookie, { ...base, coverUrl: 'http://example.com/c.jpg' })).statusCode).toBe(400);
    expect((await post(cookie, { ...base, coverUrl: 'javascript:alert(1)' })).statusCode).toBe(400);
    expect((await post(cookie, { ...base, coverUrl: 'https://example.com/c.jpg' })).statusCode).toBe(201);
  });

  it('an unknown key → 400 (.strict body)', async () => {
    expect((await post(cookie, { asin: 'B01', title: 'A Book', bogus: true })).statusCode).toBe(400);
  });

  it('quota exceeded → 429 with QUOTA_EXCEEDED in the error envelope', async () => {
    // requestQuota: 0 makes the user perpetually at-quota (resolveLimit → 0, remaining → 0).
    const capped = await insertUser(h.db, { role: 'user', status: 'active', requestQuota: 0 });
    const res = await post(h.cookieFor(capped), { asin: 'B01', title: 'A Book' });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('QUOTA_EXCEEDED');
  });
});

describe('GET /api/requests — list', () => {
  it('is scoped to the caller — user A never sees user B rows', async () => {
    const a = await insertUser(h.db, { role: 'user', status: 'active', username: 'alice' });
    const b = await insertUser(h.db, { role: 'user', status: 'active', username: 'bob' });
    await h.requests.create(a.id, bodyFor('A1'));
    await h.requests.create(a.id, bodyFor('A2'));
    await h.requests.create(b.id, bodyFor('B1'));

    const res = await h.app.inject({ method: 'GET', url: '/api/requests', cookies: h.cookieFor(a) });
    expect(res.statusCode).toBe(200);
    const { data, total } = res.json();
    expect(total).toBe(2);
    expect(data).toHaveLength(2);
    expect(data.every((r: { requester: { publicId: string } }) => r.requester.publicId === a.publicId)).toBe(true);
  });

  it('passes status/limit/offset through and applies 50/0 defaults when omitted', async () => {
    const a = await insertUser(h.db, { role: 'user', status: 'active' });
    const cookie = h.cookieFor(a);
    const listSpy = vi.spyOn(h.requests, 'list').mockResolvedValue({ data: [], total: 0 });

    await h.app.inject({ method: 'GET', url: '/api/requests?status=pending&limit=5&offset=2', cookies: cookie });
    expect(listSpy).toHaveBeenLastCalledWith({ userId: a.id, status: 'pending', limit: 5, offset: 2 });

    await h.app.inject({ method: 'GET', url: '/api/requests', cookies: cookie });
    expect(listSpy).toHaveBeenLastCalledWith({ userId: a.id, limit: 50, offset: 0 });
  });

  it('limit=0 → 400 (rejected by the query schema before the handler)', async () => {
    const a = await insertUser(h.db, { role: 'user', status: 'active' });
    const res = await h.app.inject({ method: 'GET', url: '/api/requests?limit=0', cookies: h.cookieFor(a) });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/requests/:publicId — detail', () => {
  it('owner → 200, other non-admin → 403, admin → 200', async () => {
    const owner = await insertUser(h.db, { role: 'user', status: 'active', username: 'owner' });
    const other = await insertUser(h.db, { role: 'user', status: 'active', username: 'other' });
    const admin = await insertUser(h.db, { role: 'admin', status: 'active', username: 'admin' });
    const { row } = await h.requests.create(owner.id, bodyFor('B01'));
    const url = `/api/requests/${row.publicId}`;

    expect((await h.app.inject({ method: 'GET', url, cookies: h.cookieFor(owner) })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url, cookies: h.cookieFor(other) })).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'GET', url, cookies: h.cookieFor(admin) })).statusCode).toBe(200);
  });

  it('unknown publicId → 404', async () => {
    const a = await insertUser(h.db, { role: 'user', status: 'active' });
    const res = await h.app.inject({ method: 'GET', url: '/api/requests/rq_doesnotexist', cookies: h.cookieFor(a) });
    expect(res.statusCode).toBe(404);
  });

  it('malformed rq_ param → 400', async () => {
    const a = await insertUser(h.db, { role: 'user', status: 'active' });
    const cookie = h.cookieFor(a);
    for (const bad of ['rq', 'rq_', 'us_abc']) {
      const res = await h.app.inject({ method: 'GET', url: `/api/requests/${bad}`, cookies: cookie });
      expect(res.statusCode, `param "${bad}"`).toBe(400);
    }
  });

  it('falls back to the current user when the requester row is gone (no crash)', async () => {
    const owner = await insertUser(h.db, { role: 'user', status: 'active', username: 'owner' });
    const admin = await insertUser(h.db, { role: 'admin', status: 'active', username: 'admin' });
    const { row } = await h.requests.create(owner.id, bodyFor('B01'));

    // Stub getById to drop ONLY the owner — the auth plugin still resolves the admin caller.
    // (Deleting the owner row would cascade-delete the request, so the state is only
    // reachable via the stub, per schema.ts onDelete: 'cascade'.)
    const original = h.users.getById.bind(h.users);
    vi.spyOn(h.users, 'getById').mockImplementation((id: number) =>
      id === owner.id ? Promise.resolve(undefined) : original(id),
    );

    const res = await h.app.inject({ method: 'GET', url: `/api/requests/${row.publicId}`, cookies: h.cookieFor(admin) });
    expect(res.statusCode).toBe(200);
    // Requester resolution falls back to the authenticated caller (the admin).
    expect(res.json().requester).toEqual({ publicId: admin.publicId, username: 'admin' });
  });
});

function bodyFor(asin: string) {
  return { asin, title: `Title ${asin}` };
}
