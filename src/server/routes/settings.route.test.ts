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
  it('GET — 401 anonymous, 403 non-admin, 200 admin (with error codes)', async () => {
    const anon = await app.inject({ method: 'GET', url: CONNECTORS_URL });
    expect(anon.statusCode).toBe(401);
    expect(anon.json().error.code).toBe('UNAUTHORIZED');
    const nonAdmin = await app.inject({ method: 'GET', url: CONNECTORS_URL, headers: asUser });
    expect(nonAdmin.statusCode).toBe(403);
    expect(nonAdmin.json().error.code).toBe('FORBIDDEN');
    expect((await app.inject({ method: 'GET', url: CONNECTORS_URL, headers: asAdmin })).statusCode).toBe(200);
  });

  it('PUT — 401 anonymous, 403 non-admin, 200 admin (with error codes)', async () => {
    const put = (headers?: Record<string, string>) =>
      app.inject({ method: 'PUT', url: CONNECTORS_URL, payload: {}, ...(headers && { headers }) });
    const anon = await put();
    expect(anon.statusCode).toBe(401);
    expect(anon.json().error.code).toBe('UNAUTHORIZED');
    const nonAdmin = await put(asUser);
    expect(nonAdmin.statusCode).toBe(403);
    expect(nonAdmin.json().error.code).toBe('FORBIDDEN');
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
    await connectorSettings.update({ narratorr: { host: 'n.example.com', port: 443, useSsl: true, apiKey: 'super-secret-key' } });
    const res = await app.inject({ method: 'GET', url: CONNECTORS_URL, headers: asAdmin });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('super-secret-key');
    expect(res.json().narratorr).toEqual({ host: 'n.example.com', port: 443, useSsl: true, urlBase: null, hasApiKey: true });
  });

  it('GET masks every channel secret — only has* booleans leak', async () => {
    await connectorSettings.update({
      narratorr: { host: 'n.example.com', port: 443, useSsl: true, apiKey: 'narratorr-secret' },
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
      payload: { narratorr: { host: 'n.example.com', port: 443, useSsl: true, apiKey: 'k' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().narratorr.hasApiKey).toBe(true);
    expect(res.body).not.toContain('"k"');
    expect(narratorr.configured).toBe(true); // reconfigure() swapped the holder
  });

  it('PUT accepts a private/internal narratorr host (no SSRF guard on this field)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: CONNECTORS_URL,
      headers: asAdmin,
      payload: { narratorr: { host: 'narratorr', port: 3000, useSsl: false, apiKey: 'k' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().narratorr).toMatchObject({ host: 'narratorr', port: 3000, hasApiKey: true });
    expect(await connectorSettings.getNarratorrConfig()).toEqual({ url: 'http://narratorr:3000', apiKey: 'k' });
  });

  it('PUT rejects unknown TOP-LEVEL keys (only the body is .strict) and a host with a scheme', async () => {
    const unknown = await app.inject({
      method: 'PUT',
      url: CONNECTORS_URL,
      headers: asAdmin,
      payload: { bogus: true },
    });
    expect(unknown.statusCode).toBe(400);

    const badHost = await app.inject({
      method: 'PUT',
      url: CONNECTORS_URL,
      headers: asAdmin,
      payload: { narratorr: { host: 'http://nope', port: 3000, useSsl: false, apiKey: 'k' } },
    });
    expect(badHost.statusCode).toBe(400);
  });

  it('PUT tolerates unknown NESTED keys — only the top-level body is .strict, connector objects are lenient', async () => {
    // The body schema is `.strict()` at the top level only; nested connector objects use
    // Zod's default (strip-unknown). An extra key inside `narratorr` is dropped, not rejected.
    const res = await app.inject({
      method: 'PUT',
      url: CONNECTORS_URL,
      headers: asAdmin,
      payload: { narratorr: { host: 'n.example.com', port: 443, useSsl: true, apiKey: 'k', futureField: 'ignored' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().narratorr).toEqual({ host: 'n.example.com', port: 443, useSsl: true, urlBase: null, hasApiKey: true });
  });
});

describe('settings routes — secret persistence (keep/clear/replace + round-trip)', () => {
  // Discrete narratorr fields composing to https://n.example.com:443.
  const NARR = { host: 'n.example.com', port: 443, useSsl: true } as const;
  const putConnectors = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: CONNECTORS_URL, headers: asAdmin, payload });

  it('keeps narratorr.apiKey when the field is omitted on PUT', async () => {
    // The UI sends masked/omitted secrets for unchanged fields. Omitted (undefined) must
    // preserve the stored key — a regression that wiped it here would silently de-configure
    // narratorr in production while changing an unrelated field.
    await connectorSettings.update({ narratorr: { ...NARR, apiKey: 'orig' } });
    // Edit only host/port/SSL (apiKey omitted, Host non-blank) → stored key preserved.
    const res = await putConnectors({ narratorr: { host: 'changed.example.com', port: 8080, useSsl: false } });
    expect(res.statusCode).toBe(200);
    expect(await connectorSettings.getNarratorrConfig()).toEqual({
      url: 'http://changed.example.com:8080',
      apiKey: 'orig',
    });
  });

  it('clears ntfy.token when the field is an empty string on PUT', async () => {
    await connectorSettings.update({ ntfy: { url: 'https://ntfy.sh', topic: 'reqs', token: 'tok' } });
    const res = await putConnectors({ ntfy: { url: 'https://ntfy.sh', topic: 'reqs', token: '' } });
    expect(res.statusCode).toBe(200);
    expect((await connectorSettings.getNotificationsConfig()).ntfy?.token).toBeNull();
  });

  it('round-trips narratorr.apiKey — the stored secret decrypts back to the original plaintext', async () => {
    // Not just `hasApiKey: true` (truthy for ANY blob) — a garbage-but-valid-looking
    // ciphertext would pass that. Only decrypt-to-original proves the round-trip.
    const res = await putConnectors({ narratorr: { ...NARR, apiKey: 'secret123' } });
    expect(res.statusCode).toBe(200);
    expect((await connectorSettings.getNarratorrConfig())?.apiKey).toBe('secret123');
  });

  it('replaces narratorr.apiKey when a new non-empty value is provided', async () => {
    await connectorSettings.update({ narratorr: { ...NARR, apiKey: 'old' } });
    const res = await putConnectors({ narratorr: { ...NARR, apiKey: 'new' } });
    expect(res.statusCode).toBe(200);
    expect((await connectorSettings.getNarratorrConfig())?.apiKey).toBe('new');
  });

  it('clears the narratorr connection (and drops the key) when narratorr: null is sent', async () => {
    await connectorSettings.update({ narratorr: { ...NARR, apiKey: 'orig' } });
    const res = await putConnectors({ narratorr: null });
    expect(res.statusCode).toBe(200);
    expect(res.json().narratorr).toBeNull();
    expect(await connectorSettings.getNarratorrConfig()).toBeNull();
  });

  it('round-trips email.pass — a second secret field through a distinct sub-resolver', async () => {
    const res = await putConnectors({
      email: { host: 'smtp.example.com', from: 'a@b.c', to: 'd@e.f', pass: 'smtp-pwd' },
    });
    expect(res.statusCode).toBe(200);
    expect((await connectorSettings.getNotificationsConfig()).email?.pass).toBe('smtp-pwd');
  });

  it('treats a whitespace-only apiKey as a clear (trim → "") — 400 when no prior key exists', async () => {
    // Zod `.trim()` collapses '   ' to '', which resolveSecret reads as "clear". With no
    // existing key to fall back on, resolveNarratorr rejects with NARRATORR_KEY_REQUIRED.
    const res = await putConnectors({ narratorr: { ...NARR, apiKey: '   ' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('NARRATORR_KEY_REQUIRED');
  });

  it('rejects apiKey: "" on a non-null narratorr object — no clear-via-empty for the required key', async () => {
    // Unlike optional secrets (ntfy/email), '' does not clear the narratorr key; it falls
    // into the NARRATORR_KEY_REQUIRED guard. Clearing the connection is narratorr: null.
    const res = await putConnectors({ narratorr: { ...NARR, apiKey: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('NARRATORR_KEY_REQUIRED');
  });
});

describe('settings routes — test endpoint (narratorr)', () => {
  // The probe builds a concrete `new NarratorrClient(...).ping()`, which calls
  // getBook('__healthcheck__') → request() → global fetch. So we drive every branch
  // of describeNarratorrError() by stubbing fetch, not by a fake client.
  const stubFetch = (impl: () => Promise<Response>) => vi.stubGlobal('fetch', vi.fn(impl));
  const configureNarratorr = () =>
    connectorSettings.update({ narratorr: { host: 'n.example.com', port: 443, useSsl: true, apiKey: 'k' } });
  // The candidate mirrors the stored connection but omits the key (the "unchanged" case),
  // so the stored key resolves in-memory — this exercises the candidate path end-to-end.
  const postNarratorr = () =>
    app.inject({
      method: 'POST',
      url: TEST_URL,
      headers: asAdmin,
      payload: { channel: 'narratorr', narratorr: { host: 'n.example.com', port: 443, useSsl: true } },
    });

  it('reports not-configured without throwing (always 200)', async () => {
    // No stored key and the candidate omits one → nothing resolves → clean "not configured".
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
  // The candidate connector is sent in the body — Test validates the unsaved form values,
  // so each test carries the channel config it wants to probe (no stored config needed).
  const CANDIDATE = {
    ntfy: { url: 'https://ntfy.sh', topic: 'reqs' },
    email: { host: 'smtp.example.com', port: 587, secure: false, user: null, from: 'a@b.c', to: 'd@e.f' },
    webhook: { url: 'https://example.com/hook' },
  } as const;
  const postChannel = (channel: 'ntfy' | 'email' | 'webhook', candidate?: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: TEST_URL,
      headers: asAdmin,
      payload: { channel, ...(candidate ? { [channel]: candidate } : {}) },
    });

  it('reports a not-configured notification channel without throwing', async () => {
    // No candidate block for the channel → nothing to build → clean "not configured".
    const res = await postChannel('ntfy');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: false, message: 'ntfy is not configured.' });
  });

  it('webhook — success on a 2xx transport response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const res = await postChannel('webhook', CANDIDATE.webhook);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true });
  });

  it('webhook — Error throw surfaces the error message (settings.ts:98)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    const res = await postChannel('webhook', CANDIDATE.webhook);
    expect(res.json()).toEqual({ success: false, message: 'webhook responded 500' });
  });

  it('ntfy — success on a 2xx transport response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const res = await postChannel('ntfy', CANDIDATE.ntfy);
    expect(res.json()).toMatchObject({ success: true });
  });

  it('ntfy — a non-Error throw falls back to "Unknown error" (settings.ts:98)', async () => {
    // fetch rejecting with a non-Error value propagates that value as the throw,
    // so `err instanceof Error` is false and the route uses the generic fallback.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('not-an-error-object'));
    const res = await postChannel('ntfy', CANDIDATE.ntfy);
    expect(res.json()).toEqual({ success: false, message: 'Unknown error' });
  });

  it('email — success when the SMTP transport resolves', async () => {
    sendMail.mockResolvedValue({ messageId: 'x' });
    const res = await postChannel('email', CANDIDATE.email);
    expect(res.json()).toMatchObject({ success: true });
    // Assert the actual message payload the handler builds (from/to from config,
    // subject from the rendered `request.created` notification), not merely that it fired.
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'a@b.c', to: 'd@e.f', subject: 'New audiobook request' }),
    );
  });

  it('email — an Error throw surfaces the error message (settings.ts:98)', async () => {
    sendMail.mockRejectedValue(new Error('SMTP connection refused'));
    const res = await postChannel('email', CANDIDATE.email);
    expect(res.json()).toEqual({ success: false, message: 'SMTP connection refused' });
  });
});

describe('settings routes — test endpoint (candidate / unsaved values)', () => {
  const post = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: TEST_URL, headers: asAdmin, payload });
  const narratorr404 = () =>
    vi.fn((_input?: unknown, _init?: RequestInit) => Promise.resolve(new Response('{}', { status: 404 })));

  it('probes the CANDIDATE narratorr URL composed from discrete fields, not the stored one', async () => {
    await connectorSettings.update({ narratorr: { host: 'stored.example.com', port: 443, useSsl: true, apiKey: 'k' } });
    const fetchMock = narratorr404();
    vi.stubGlobal('fetch', fetchMock);

    const res = await post({
      channel: 'narratorr',
      narratorr: { host: 'candidate.example.com', port: 8080, useSsl: false, urlBase: '/lib', apiKey: 'k' },
    });
    expect(res.json()).toMatchObject({ success: true });
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('http://candidate.example.com:8080/lib/api/v1/books/');
    expect(calledUrl).not.toContain('stored.example.com');
  });

  it('unchanged secret (apiKey omitted) falls back to the STORED, decrypted key', async () => {
    await connectorSettings.update({ narratorr: { host: 'n.example.com', port: 443, useSsl: true, apiKey: 'stored-key' } });
    const fetchMock = narratorr404();
    vi.stubGlobal('fetch', fetchMock);

    // apiKey omitted → the "unchanged" case; other fields present.
    const res = await post({ channel: 'narratorr', narratorr: { host: 'n.example.com', port: 443, useSsl: true } });
    expect(res.json()).toMatchObject({ success: true });
    const sentKey = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(sentKey['X-Api-Key']).toBe('stored-key');
  });

  it('freshly-typed secret is used over the stored one', async () => {
    await connectorSettings.update({ narratorr: { host: 'n.example.com', port: 443, useSsl: true, apiKey: 'stored-key' } });
    const fetchMock = narratorr404();
    vi.stubGlobal('fetch', fetchMock);

    const res = await post({ channel: 'narratorr', narratorr: { host: 'n.example.com', port: 443, useSsl: true, apiKey: 'typed-key' } });
    expect(res.json()).toMatchObject({ success: true });
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers['X-Api-Key']).toBe('typed-key');
  });

  it('ntfy candidate with an omitted token reuses the STORED token in the Authorization header (F1)', async () => {
    await connectorSettings.update({ ntfy: { url: 'https://ntfy.sh', topic: 'reqs', token: 'stored-token' } });
    const fetchMock = vi.fn((_input?: unknown, _init?: RequestInit) => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    // token omitted → the "unchanged" case; the stored token must reach the probe.
    const res = await post({ channel: 'ntfy', ntfy: { url: 'https://ntfy.sh', topic: 'reqs' } });
    expect(res.json()).toMatchObject({ success: true });
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer stored-token');
  });

  it('ntfy candidate with a freshly-typed token uses that token, not the stored one (F1)', async () => {
    await connectorSettings.update({ ntfy: { url: 'https://ntfy.sh', topic: 'reqs', token: 'stored-token' } });
    const fetchMock = vi.fn((_input?: unknown, _init?: RequestInit) => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    const res = await post({ channel: 'ntfy', ntfy: { url: 'https://ntfy.sh', topic: 'reqs', token: 'typed-token' } });
    expect(res.json()).toMatchObject({ success: true });
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer typed-token');
  });

  it('email candidate with an omitted password reuses the STORED password in the SMTP auth (F2)', async () => {
    sendMail.mockResolvedValue({ messageId: 'x' });
    // Stored credentials include a user so nodemailer auth is built (auth needs user + pass).
    await connectorSettings.update({
      email: { host: 'smtp.example.com', user: 'smtp-user', pass: 'stored-pwd', from: 'a@b.c', to: 'd@e.f' },
    });

    // pass omitted → the "unchanged" case; the stored, decrypted password must reach the transport.
    const res = await post({
      channel: 'email',
      email: { host: 'smtp.example.com', port: 587, secure: false, user: 'smtp-user', from: 'a@b.c', to: 'd@e.f' },
    });
    expect(res.json()).toMatchObject({ success: true });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'smtp-user', pass: 'stored-pwd' } }),
    );
  });

  it('email candidate with a freshly-typed password uses that password, not the stored one (F2)', async () => {
    sendMail.mockResolvedValue({ messageId: 'x' });
    await connectorSettings.update({
      email: { host: 'smtp.example.com', user: 'smtp-user', pass: 'stored-pwd', from: 'a@b.c', to: 'd@e.f' },
    });

    const res = await post({
      channel: 'email',
      email: { host: 'smtp.example.com', port: 587, secure: false, user: 'smtp-user', pass: 'typed-pwd', from: 'a@b.c', to: 'd@e.f' },
    });
    expect(res.json()).toMatchObject({ success: true });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'smtp-user', pass: 'typed-pwd' } }),
    );
  });

  it('narratorr with an omitted key and NO stored key fails cleanly (not configured), no crash', async () => {
    // No stored narratorr at all; candidate omits the key → nothing to resolve.
    const res = await post({ channel: 'narratorr', narratorr: { host: 'n.example.com', port: 443, useSsl: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: false, message: 'Narratorr is not configured.' });
  });

  it('renders the test notification with the UNSAVED candidate publicUrl', async () => {
    await connectorSettings.update({ publicUrl: 'https://stored.example.com', webhook: { url: 'https://x/hook' } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await post({ channel: 'webhook', webhook: { url: 'https://x/hook' }, publicUrl: 'https://candidate.example.com' });
    expect(res.json()).toMatchObject({ success: true });
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.url).toBe('https://candidate.example.com/admin');
    expect(body.url).not.toContain('stored.example.com');
  });

  it('omitted publicUrl in the test payload falls back to the stored publicUrl', async () => {
    await connectorSettings.update({ publicUrl: 'https://stored.example.com', webhook: { url: 'https://x/hook' } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    // publicUrl omitted entirely from the candidate.
    const res = await post({ channel: 'webhook', webhook: { url: 'https://x/hook' } });
    expect(res.json()).toMatchObject({ success: true });
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.url).toBe('https://stored.example.com/admin');
  });

  it('tests an unsaved ntfy candidate with no stored config — success on a 2xx transport', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const res = await post({ channel: 'ntfy', ntfy: { url: 'https://ntfy.sh', topic: 'reqs' }, publicUrl: null });
    expect(res.json()).toMatchObject({ success: true });
  });

  it('tests an unsaved email candidate with no stored config — success when the transport resolves', async () => {
    sendMail.mockResolvedValue({ messageId: 'x' });
    const res = await post({
      channel: 'email',
      email: { host: 'smtp.example.com', port: 587, secure: false, user: null, from: 'a@b.c', to: 'd@e.f' },
      publicUrl: null,
    });
    expect(res.json()).toMatchObject({ success: true });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'a@b.c', to: 'd@e.f' }));
  });

  it('performs NO DB write and never calls update() — on both success and failure', async () => {
    await connectorSettings.update({ narratorr: { host: 'stored.example.com', port: 443, useSsl: true, apiKey: 'stored-key' } });
    const before = await connectorSettings.getStored();
    const updateSpy = vi.spyOn(connectorSettings, 'update');

    vi.stubGlobal('fetch', narratorr404());
    await post({ channel: 'narratorr', narratorr: { host: 'candidate.example.com', port: 8080, useSsl: false, apiKey: 'typed' } });

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))));
    await post({ channel: 'narratorr', narratorr: { host: 'candidate.example.com', port: 8080, useSsl: false, apiKey: 'typed' } });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(await connectorSettings.getStored()).toEqual(before);
  });

  it('does not leak any decrypted secret in the response — only { success, message }', async () => {
    await connectorSettings.update({ narratorr: { host: 'n.example.com', port: 443, useSsl: true, apiKey: 'top-secret-key' } });
    vi.stubGlobal('fetch', narratorr404());
    const res = await post({ channel: 'narratorr', narratorr: { host: 'n.example.com', port: 443, useSsl: true } });
    expect(Object.keys(res.json()).sort()).toEqual(['message', 'success']);
    expect(res.body).not.toContain('top-secret-key');
  });

  it('rejects an unknown TOP-LEVEL key (body stays .strict) but tolerates unknown NESTED keys', async () => {
    const unknownTop = await post({ channel: 'narratorr', bogus: true });
    expect(unknownTop.statusCode).toBe(400);

    vi.stubGlobal('fetch', narratorr404());
    const lenientNested = await post({
      channel: 'narratorr',
      narratorr: { host: 'n.example.com', port: 443, useSsl: true, apiKey: 'k', futureField: 'ignored' },
    });
    expect(lenientNested.statusCode).toBe(200);
    expect(lenientNested.json()).toMatchObject({ success: true });
  });
});
