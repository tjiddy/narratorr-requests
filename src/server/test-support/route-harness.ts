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

const SESSION_SECRET = 'route-test-secret';

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
   * Mint a real signed session cookie for an already-seeded user — the role-override path
   * for authz assertions. Seed a user with any role/status via `insertUser()`, then become
   * them. This goes through the real `authPlugin` (no header shim), so it exercises the
   * genuine session → `request.user` boundary instead of a parallel fixture of it.
   */
  cookieFor(user: { id: number; publicId: string }): Record<string, string>;
}

export interface BuildRouteAppOpts {
  /** Register the route(s) under test against the wired-up deps. */
  register: (app: FastifyInstance, deps: AppDeps) => void;
  config?: Partial<AppConfig>;
  /** Override the default successful fake Narratorr client. */
  narratorr?: INarratorrClient;
  /** Override the default request policy (defaultQuota 10 / windowDays 30 / admin auto-approve). */
  policy?: Partial<RequestPolicy>;
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

  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie, { secret: SESSION_SECRET });
  await app.register(rateLimit, authRateLimitOptions);
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin, deps);
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
    cookieFor: (user) => ({
      [SESSION_COOKIE]: createSessionToken({ uid: user.id, pid: user.publicId }, SESSION_SECRET),
    }),
  };
}

/** Pluck the session cookie out of an `inject()` response (the real-auth-flow login path). */
export function sessionCookie(res: { cookies: Array<{ name: string; value: string }> }): Record<string, string> {
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE);
  if (!c) throw new Error('no session cookie set');
  return { [SESSION_COOKIE]: c.value };
}
