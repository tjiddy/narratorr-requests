import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { vi } from 'vitest';
import { createTestDb } from './db.js';
import { UserService } from '../services/user.service.js';
import { SettingsService } from '../services/settings.service.js';
import { RequestService, type RequestPolicy } from '../services/request.service.js';
import { errorHandlerPlugin } from '../plugins/error-handler.js';
import { authRateLimitOptions } from '../plugins/rate-limit.js';
import { authPlugin, SESSION_COOKIE } from '../plugins/auth.js';
import { createSessionToken } from '../util/session.js';
import type { Db } from '../../db/client.js';
import type { AppConfig } from '../config.js';
import type { AppDeps } from '../services/deps.js';
import type { INarratorrClient } from '../services/narratorr-client.js';
import type { V1Book } from '../../shared/schemas/v1/books.js';
import type { BookStatus } from '../../shared/schemas/book.js';
import type { AuthUser } from '../types.js';

const SESSION_SECRET = 'route-test-secret';

/** Header that selects a synthetic `request.user` on the role-override (header-shim) path. */
export const TEST_ROLE_HEADER = 'x-test-role';

/**
 * Synthetic users for the header-shim authz-override path — lifted from `settings.route.test.ts`
 * so authz-only route tests stop re-rolling that hook. These are NOT backed by DB rows: use them
 * for routes that only gate on `request.user`'s role/status (e.g. admin-only settings), NOT for
 * routes that load the user by id (request create looks the user up in the DB). For DB-backed
 * flows, seed a real user with `insertUser()` and authenticate via `cookieFor()`.
 */
export const TEST_ADMIN: AuthUser = { id: 1, publicId: 'us_admin', username: 'admin', role: 'admin', status: 'active' };
export const TEST_USER: AuthUser = { id: 2, publicId: 'us_user', username: 'user', role: 'user', status: 'active' };

/**
 * A successful fake Narratorr client whose `addBook()` resolves — the inverse of the
 * rejecting stub the auth-route test uses. The auto-approve (admin) create path hands off
 * to `addBook()`, so any route test that exercises it needs a client that succeeds rather
 * than 5xx'ing the handoff. `status` controls the book state the handoff observes
 * (`searching` → request lands `acquiring`; `imported` → `available`).
 */
export class FakeNarratorrClient implements INarratorrClient {
  status: BookStatus = 'searching';
  added: string[] = [];
  private seq = 0;

  async searchMetadata(): Promise<[]> {
    return [];
  }
  async addBook(asin: string): Promise<V1Book> {
    this.added.push(asin);
    this.seq += 1;
    return { id: `bk_${this.seq}`, title: 'A Book', authors: [], narrators: [], status: this.status };
  }
  async getBook(id: string): Promise<V1Book> {
    return { id, title: 'A Book', authors: [], narrators: [], status: this.status };
  }
}

/** What a built route-test app hands back: the Fastify instance plus the live wiring tests poke at. */
export interface RouteHarness {
  app: FastifyInstance;
  db: Db;
  users: UserService;
  requests: RequestService;
  /** The injected notifier dispatch spy — assert `toHaveBeenCalledTimes` / `not.toHaveBeenCalled`. */
  notify: ReturnType<typeof vi.fn>;
  /** The successful fake Narratorr client (mutate `.status`, inspect `.added`). */
  narratorr: FakeNarratorrClient;
  config: AppConfig;
  /**
   * Mint a real signed session cookie for an already-seeded user — the DB-backed auth path.
   * Seed a user with any role/status via `insertUser()`, then become them. This goes through
   * the real `authPlugin`, so it exercises the genuine session → `request.user` boundary
   * instead of a parallel fixture of it.
   */
  cookieFor(user: { id: number; publicId: string }): Record<string, string>;
  /**
   * Header-shim role override for authz-only tests — selects a synthetic `request.user`
   * (`TEST_ADMIN` / `TEST_USER`, or the `roleUsers` override) without a DB row or cookie.
   * Use for routes that gate purely on role/status; pair with `cookieFor()` for DB-backed flows.
   */
  asRole(role: 'admin' | 'user'): Record<string, string>;
  /** The synthetic users the header shim injects (the `roleUsers` override or the defaults). */
  roleUsers: { admin: AuthUser; user: AuthUser };
}

export interface BuildRouteAppOpts {
  /** Register the route(s) under test against the wired-up deps. */
  register: (app: FastifyInstance, deps: AppDeps) => void;
  config?: Partial<AppConfig>;
  /** Override the default successful fake Narratorr client. */
  narratorr?: INarratorrClient;
  /** Override the default request policy (defaultQuota 10 / windowDays 30 / admin auto-approve). */
  policy?: Partial<RequestPolicy>;
  /** Override the synthetic users the header-shim role override injects (default TEST_ADMIN / TEST_USER). */
  roleUsers?: { admin?: AuthUser; user?: AuthUser };
}

/**
 * Build a Fastify app wired the way the real server is — error-handler, cookie, rate-limit,
 * and the real `authPlugin` — with the user-facing data services constructed against a fresh
 * in-memory libSQL db. Routes are registered via `opts.register` so each route-test file (this
 * one, and the follow-up admin-route issue) shares one harness instead of re-rolling the app.
 */
export async function buildRouteApp(opts: BuildRouteAppOpts): Promise<RouteHarness> {
  const db = await createTestDb();
  await new SettingsService(db).ensure(10);
  const users = new UserService(db, {});
  const narratorr = opts.narratorr ?? new FakeNarratorrClient();
  const requests = new RequestService(db, narratorr, {
    defaultQuota: 10,
    windowDays: 30,
    autoApproveRoles: ['admin'],
    ...opts.policy,
  });
  const notify = vi.fn().mockResolvedValue(undefined);
  const config = {
    authMode: 'standard',
    sessionSecret: SESSION_SECRET,
    isProd: false,
    corsOrigin: 'http://localhost',
    localAuth: true,
    ...opts.config,
  } as unknown as AppConfig;
  const deps = {
    config,
    db,
    users,
    requests,
    notifier: { notify },
    oidc: new Map(),
  } as unknown as AppDeps;

  const roleUsers = {
    admin: opts.roleUsers?.admin ?? TEST_ADMIN,
    user: opts.roleUsers?.user ?? TEST_USER,
  };

  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie, { secret: SESSION_SECRET });
  await app.register(rateLimit, authRateLimitOptions);
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin, deps);
  // Header-shim role override (mirrors settings.route.test.ts). Runs AFTER authPlugin's
  // onRequest hook so a test that sends the header wins; tests that send a real cookie and
  // no header are untouched. Inert unless the header is present.
  app.addHook('onRequest', async (req) => {
    const role = req.headers[TEST_ROLE_HEADER];
    if (role === 'admin') req.user = roleUsers.admin;
    else if (role === 'user') req.user = roleUsers.user;
  });
  opts.register(app, deps);
  await app.ready();

  return {
    app,
    db,
    users,
    requests,
    notify,
    narratorr: narratorr as FakeNarratorrClient,
    config,
    roleUsers,
    cookieFor: (user) => ({
      [SESSION_COOKIE]: createSessionToken({ uid: user.id, pid: user.publicId }, SESSION_SECRET),
    }),
    asRole: (role) => ({ [TEST_ROLE_HEADER]: role }),
  };
}

/** Pluck the session cookie out of an `inject()` response (the real-auth-flow login path). */
export function sessionCookie(res: { cookies: Array<{ name: string; value: string }> }): Record<string, string> {
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE);
  if (!c) throw new Error('no session cookie set');
  return { [SESSION_COOKIE]: c.value };
}
