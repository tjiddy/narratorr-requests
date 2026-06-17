import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
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
});

const asAdmin = { 'x-test-role': 'admin' };

describe('settings routes — auth gating', () => {
  it('401 for anonymous, 403 for non-admin, 200 for admin', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/settings/connectors' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/api/admin/settings/connectors', headers: { 'x-test-role': 'user' } }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/api/admin/settings/connectors', headers: asAdmin })).statusCode,
    ).toBe(200);
  });
});

describe('settings routes — GET/PUT', () => {
  it('GET returns the masked DTO and never the secret value', async () => {
    await connectorSettings.update({ narratorr: { url: 'https://n.example.com', apiKey: 'super-secret-key' } });
    const res = await app.inject({ method: 'GET', url: '/api/admin/settings/connectors', headers: asAdmin });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('super-secret-key');
    expect(res.json().narratorr).toEqual({ url: 'https://n.example.com', hasApiKey: true });
  });

  it('PUT persists, masks the response, and rebuilds the narratorr client live', async () => {
    expect(narratorr.configured).toBe(false);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/connectors',
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
      url: '/api/admin/settings/connectors',
      headers: asAdmin,
      payload: { bogus: true },
    });
    expect(unknown.statusCode).toBe(400);

    const badUrl = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/connectors',
      headers: asAdmin,
      payload: { narratorr: { url: 'ftp://nope', apiKey: 'k' } },
    });
    expect(badUrl.statusCode).toBe(400);
  });
});

describe('settings routes — test endpoint', () => {
  it('reports not-configured connectors without throwing (always 200)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/settings/connectors/test',
      headers: asAdmin,
      payload: { channel: 'narratorr' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: false });
  });

  it('fires a real send for a configured channel', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await connectorSettings.update({ webhook: { url: 'https://example.com/hook' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/settings/connectors/test',
      headers: asAdmin,
      payload: { channel: 'webhook' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
