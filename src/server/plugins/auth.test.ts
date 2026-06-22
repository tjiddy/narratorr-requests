import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildRouteApp } from '../test-support/route-harness.js';
import { insertUser, deleteUser } from '../test-support/db.js';
import { requireActiveUser, SESSION_COOKIE } from './auth.js';
import { registerAuthRoutes } from '../routes/auth.js';
import { SESSION_TTL_MS } from '../util/session.js';

// A minimal route gated by the authorization boundary so the plugin's negative arms
// (rejected / pending-admin / unauthenticated) are exercised through the real onRequest
// hook → request.user → requireActiveUser path, not a fixture of it.
const gated = (app: FastifyInstance) => {
  app.get('/test/active', async (req) => {
    requireActiveUser(req);
    return { ok: true };
  });
};

let toClose: FastifyInstance | undefined;
afterEach(async () => {
  await toClose?.close();
  toClose = undefined;
  vi.restoreAllMocks();
});

async function build(opts: Parameters<typeof buildRouteApp>[0]) {
  const h = await buildRouteApp(opts);
  toClose = h.app;
  return h;
}

describe('auth plugin — route gate negatives', () => {
  it('a rejected user on a gated route → 403 ACCOUNT_REJECTED', async () => {
    const h = await build({ register: gated });
    const user = await insertUser(h.db, { status: 'rejected' });
    const res = await h.app.inject({ method: 'GET', url: '/test/active', cookies: h.cookieFor(user) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ACCOUNT_REJECTED');
  });

  it('a pending-status row with role admin passes the gate (admin short-circuit)', async () => {
    const h = await build({ register: gated });
    const admin = await insertUser(h.db, { role: 'admin', status: 'pending' });
    const res = await h.app.inject({ method: 'GET', url: '/test/active', cookies: h.cookieFor(admin) });
    expect(res.statusCode).toBe(200);
  });

  it('no cookie → 401', async () => {
    const h = await build({ register: gated });
    const res = await h.app.inject({ method: 'GET', url: '/test/active' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('a garbage/undecodable cookie → 401', async () => {
    const h = await build({ register: gated });
    const res = await h.app.inject({
      method: 'GET',
      url: '/test/active',
      cookies: { [SESSION_COOKIE]: 'not-a-valid-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('a valid cookie whose backing user row was deleted → 401', async () => {
    const h = await build({ register: gated });
    const user = await insertUser(h.db, { status: 'active' });
    const cookie = h.cookieFor(user);
    // Sanity: the same cookie authenticates while the row exists.
    expect((await h.app.inject({ method: 'GET', url: '/test/active', cookies: cookie })).statusCode).toBe(200);

    // Delete the real row (no spy) so the session lookup genuinely misses → no
    // request.user → 401. Exercises the actual DB session-lookup boundary.
    await deleteUser(h.db, user.id);
    const res = await h.app.inject({ method: 'GET', url: '/test/active', cookies: cookie });
    expect(res.statusCode).toBe(401);
  });
});

describe('auth plugin — AUTH_BYPASS mode', () => {
  it('attaches the dev admin to unauthenticated requests and caches it across requests', async () => {
    const h = await build({ config: { authMode: 'bypass' }, register: registerAuthRoutes });
    const spy = vi.spyOn(h.users, 'ensureDevAdmin');

    const r1 = await h.app.inject({ method: 'GET', url: '/api/me' });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ username: 'dev-admin', role: 'admin', status: 'active' });

    const r2 = await h.app.inject({ method: 'GET', url: '/api/me' });
    expect(r2.statusCode).toBe(200);

    // The bypass user is memoized in the plugin, so ensureDevAdmin runs once total.
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('auth plugin — session cookie security flags', () => {
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);

  function sessionSetCookie(res: LightMyRequestResponse): string {
    const raw = res.headers['set-cookie'] ?? [];
    const lines = Array.isArray(raw) ? raw : [raw];
    return lines.find((l) => l.startsWith(`${SESSION_COOKIE}=`)) ?? '';
  }

  const signup = (app: FastifyInstance) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/local/signup',
      payload: { email: 'owner@example.com', password: 'password123' },
    });

  it('a login Set-Cookie carries HttpOnly, SameSite=Lax, Max-Age; Secure absent when not prod', async () => {
    const h = await build({ config: { isProd: false }, register: registerAuthRoutes });
    const res = await signup(h.app);
    expect(res.statusCode).toBe(200);

    const line = sessionSetCookie(res);
    expect(line).toContain('HttpOnly');
    expect(line).toMatch(/SameSite=Lax/i);
    expect(line).toContain(`Max-Age=${maxAgeSeconds}`);
    expect(line).not.toMatch(/;\s*Secure/i);
  });

  it('Secure is set on the login cookie when isProd', async () => {
    const h = await build({ config: { isProd: true }, register: registerAuthRoutes });
    const res = await signup(h.app);
    expect(res.statusCode).toBe(200);

    const line = sessionSetCookie(res);
    expect(line).toMatch(/;\s*Secure/i);
    expect(line).toContain('HttpOnly');
  });
});
