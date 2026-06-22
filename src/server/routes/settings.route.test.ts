import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';

// Hoisted so the vi.mock factory can reference them (vi.mock is hoisted above imports).
// EmailChannel builds a nodemailer transport in its constructor, so the email
// test-connector path is driven through this stub rather than a real SMTP socket.
const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { sendMail, createTransport: vi.fn((_opts?: unknown) => ({ sendMail })) };
});
vi.mock('nodemailer', () => ({ default: { createTransport } }));

import { createTestDb } from '../test-support/db.js';
import { SettingsService } from '../services/settings.service.js';
import { ConnectorSettingsService } from '../services/connector-settings.service.js';
import { SecretCodec, deriveSettingsKey } from '../util/secret-codec.js';
import { NarratorrClientHolder } from '../services/narratorr-client-holder.js';
import { Notifier } from '../services/notifications/index.js';
import { errorHandlerPlugin } from '../plugins/error-handler.js';
import { registerSettingsRoutes } from './settings.js';
import type { AppDeps } from '../services/deps.js';
import type { AuthUser } from '../types.js';

const codec = new SecretCodec(deriveSettingsKey({ sessionSecret: 'route-test' }));
const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

const ADMIN: AuthUser = { id: 1, publicId: 'us_admin', username: 'admin', role: 'admin', status: 'active' };
const USER: AuthUser = { id: 2, publicId: 'us_user', username: 'user', role: 'user', status: 'active' };

let app: FastifyInstance;
let connectorSettings: ConnectorSettingsService;
let narratorr: NarratorrClientHolder;

async function buildApp(): Promise<FastifyInstance> {
  const db = await createTestDb();
  await new SettingsService(db).ensure(10);
  connectorSettings = new ConnectorSettingsService(db, codec);
  narratorr = new NarratorrClientHolder(null);
  const deps = {
    connectorSettings,
    narratorr,
    notifier: new Notifier([], null, silentLog),
  } as unknown as AppDeps;

  const f = Fastify().withTypeProvider<ZodTypeProvider>();
  f.setValidatorCompiler(validatorCompiler);
  f.setSerializerCompiler(serializerCompiler);
  await f.register(errorHandlerPlugin);
  // Test auth: set request.user from a header (mirrors what authPlugin would attach).
  f.addHook('onRequest', async (req) => {
    const role = req.headers['x-test-role'];
    if (role === 'admin') req.user = ADMIN;
    else if (role === 'user') req.user = USER;
  });
  registerSettingsRoutes(f, deps);
  await f.ready();
  return f;
}

beforeEach(async () => {
  app = await buildApp();
});
afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const asAdmin = { 'x-test-role': 'admin' };
const asUser = { 'x-test-role': 'user' };
const CONNECTORS_URL = '/api/admin/settings/connectors';
const TEST_URL = '/api/admin/settings/connectors/test';

describe('settings routes — auth gating', () => {
  // A valid (empty) body passes schema validation so the handler runs and we
  // exercise requireAdmin itself, not the body validator.
  it('GET — 401 anonymous, 403 non-admin, 200 admin', async () => {
    expect((await app.inject({ method: 'GET', url: CONNECTORS_URL })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: CONNECTORS_URL, headers: asUser })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: CONNECTORS_URL, headers: asAdmin })).statusCode).toBe(200);
  });

  it('PUT — 401 anonymous, 403 non-admin, 200 admin', async () => {
    const put = (headers?: Record<string, string>) =>
      app.inject({ method: 'PUT', url: CONNECTORS_URL, payload: {}, ...(headers && { headers }) });
    expect((await put()).statusCode).toBe(401);
    expect((await put(asUser)).statusCode).toBe(403);
    expect((await put(asAdmin)).statusCode).toBe(200);
  });

  it('POST test — 401 anonymous, 403 non-admin, 200 admin', async () => {
    const post = (headers?: Record<string, string>) =>
      app.inject({ method: 'POST', url: TEST_URL, payload: { channel: 'narratorr' }, ...(headers && { headers }) });
    expect((await post()).statusCode).toBe(401);
    expect((await post(asUser)).statusCode).toBe(403);
    expect((await post(asAdmin)).statusCode).toBe(200);
  });
});

describe('settings routes — GET/PUT', () => {
  it('GET returns the masked DTO and never the secret value', async () => {
    await connectorSettings.update({ narratorr: { url: 'https://n.example.com', apiKey: 'super-secret-key' } });
    const res = await app.inject({ method: 'GET', url: CONNECTORS_URL, headers: asAdmin });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('super-secret-key');
    expect(res.json().narratorr).toEqual({ url: 'https://n.example.com', hasApiKey: true });
  });

  it('GET masks every channel secret — only has* booleans leak', async () => {
    await connectorSettings.update({
      narratorr: { url: 'https://n.example.com', apiKey: 'narratorr-secret' },
      ntfy: { url: 'https://ntfy.sh', topic: 'reqs', token: 'ntfy-secret' },
      email: { host: 'smtp.example.com', from: 'a@b.c', to: 'd@e.f', pass: 'email-secret' },
      webhook: { url: 'https://example.com/hook' },
    });
    const res = await app.inject({ method: 'GET', url: CONNECTORS_URL, headers: asAdmin });
    expect(res.statusCode).toBe(200);
    for (const secret of ['narratorr-secret', 'ntfy-secret', 'email-secret']) {
      expect(res.body).not.toContain(secret);
    }
    const dto = res.json();
    expect(dto.narratorr).toMatchObject({ hasApiKey: true });
    expect(dto.ntfy).toMatchObject({ hasToken: true });
    expect(dto.email).toMatchObject({ hasPassword: true });
    expect(dto.email).not.toHaveProperty('pass');
    expect(dto.ntfy).not.toHaveProperty('token');
  });

  it('PUT persists, masks the response, and rebuilds the narratorr client live', async () => {
    expect(narratorr.configured).toBe(false);
    const res = await app.inject({
      method: 'PUT',
      url: CONNECTORS_URL,
      headers: asAdmin,
      payload: { narratorr: { url: 'https://n.example.com', apiKey: 'k' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().narratorr.hasApiKey).toBe(true);
    expect(res.body).not.toContain('"k"');
    expect(narratorr.configured).toBe(true); // reconfigure() swapped the holder
  });

  it('PUT rejects unknown keys (.strict) and non-http URLs', async () => {
    const unknown = await app.inject({
      method: 'PUT',
      url: CONNECTORS_URL,
      headers: asAdmin,
      payload: { bogus: true },
    });
    expect(unknown.statusCode).toBe(400);

    const badUrl = await app.inject({
      method: 'PUT',
      url: CONNECTORS_URL,
      headers: asAdmin,
      payload: { narratorr: { url: 'ftp://nope', apiKey: 'k' } },
    });
    expect(badUrl.statusCode).toBe(400);
  });
});

describe('settings routes — test endpoint (narratorr)', () => {
  // The probe builds a concrete `new NarratorrClient(...).ping()`, which calls
  // getBook('__healthcheck__') → request() → global fetch. So we drive every branch
  // of describeNarratorrError() by stubbing fetch, not by a fake client.
  const stubFetch = (impl: () => Promise<Response>) => vi.stubGlobal('fetch', vi.fn(impl));
  const configureNarratorr = () =>
    connectorSettings.update({ narratorr: { url: 'https://n.example.com', apiKey: 'k' } });
  const postNarratorr = () =>
    app.inject({ method: 'POST', url: TEST_URL, headers: asAdmin, payload: { channel: 'narratorr' } });

  it('reports not-configured without throwing (always 200)', async () => {
    const res = await postNarratorr();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: false, message: 'Narratorr is not configured.' });
  });

  it('success — a reachable 404 healthcheck proves URL + key', async () => {
    await configureNarratorr();
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x' } }), { status: 404 })));
    const res = await postNarratorr();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true });
  });

  it('failure — network unreachable maps to "Could not reach narratorr"', async () => {
    await configureNarratorr();
    stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    const res = await postNarratorr();
    expect(res.json()).toEqual({ success: false, message: 'Could not reach narratorr — check the URL.' });
  });

  it('failure — 401 maps to the authentication-failed message', async () => {
    await configureNarratorr();
    stubFetch(() => Promise.resolve(new Response('{}', { status: 401 })));
    const res = await postNarratorr();
    expect(res.json()).toEqual({ success: false, message: 'Authentication failed — check the API key.' });
  });

  it('failure — 403 maps to the authentication-failed message', async () => {
    await configureNarratorr();
    stubFetch(() => Promise.resolve(new Response('{}', { status: 403 })));
    const res = await postNarratorr();
    expect(res.json()).toEqual({ success: false, message: 'Authentication failed — check the API key.' });
  });

  it('failure — other upstream status surfaces "narratorr responded N"', async () => {
    await configureNarratorr();
    stubFetch(() => Promise.resolve(new Response('{}', { status: 500 })));
    const res = await postNarratorr();
    expect(res.json()).toEqual({ success: false, message: 'narratorr responded 500.' });
  });
});

describe('settings routes — test endpoint (notification channels)', () => {
  const postChannel = (channel: 'ntfy' | 'email' | 'webhook') =>
    app.inject({ method: 'POST', url: TEST_URL, headers: asAdmin, payload: { channel } });

  it('reports a not-configured notification channel without throwing', async () => {
    const res = await postChannel('ntfy');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: false, message: 'ntfy is not configured.' });
  });

  it('webhook — success on a 2xx transport response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await connectorSettings.update({ webhook: { url: 'https://example.com/hook' } });
    const res = await postChannel('webhook');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true });
  });

  it('webhook — Error throw surfaces the error message (settings.ts:98)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await connectorSettings.update({ webhook: { url: 'https://example.com/hook' } });
    const res = await postChannel('webhook');
    expect(res.json()).toEqual({ success: false, message: 'webhook responded 500' });
  });

  it('ntfy — success on a 2xx transport response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await connectorSettings.update({ ntfy: { url: 'https://ntfy.sh', topic: 'reqs' } });
    const res = await postChannel('ntfy');
    expect(res.json()).toMatchObject({ success: true });
  });

  it('ntfy — a non-Error throw falls back to "Unknown error" (settings.ts:98)', async () => {
    // fetch rejecting with a non-Error value propagates that value as the throw,
    // so `err instanceof Error` is false and the route uses the generic fallback.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('not-an-error-object'));
    await connectorSettings.update({ ntfy: { url: 'https://ntfy.sh', topic: 'reqs' } });
    const res = await postChannel('ntfy');
    expect(res.json()).toEqual({ success: false, message: 'Unknown error' });
  });

  it('email — success when the SMTP transport resolves', async () => {
    sendMail.mockResolvedValue({ messageId: 'x' });
    await connectorSettings.update({ email: { host: 'smtp.example.com', from: 'a@b.c', to: 'd@e.f' } });
    const res = await postChannel('email');
    expect(res.json()).toMatchObject({ success: true });
    expect(sendMail).toHaveBeenCalledOnce();
  });

  it('email — an Error throw surfaces the error message (settings.ts:98)', async () => {
    sendMail.mockRejectedValue(new Error('SMTP connection refused'));
    await connectorSettings.update({ email: { host: 'smtp.example.com', from: 'a@b.c', to: 'd@e.f' } });
    const res = await postChannel('email');
    expect(res.json()).toEqual({ success: false, message: 'SMTP connection refused' });
  });
});
