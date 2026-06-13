import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { config, APP_ROOT } from './config.js';
import { runMigrations } from '../db/migrate.js';
import { createDb } from '../db/client.js';
import { UserService } from './services/user.service.js';
import { SettingsService } from './services/settings.service.js';
import { RequestService } from './services/request.service.js';
import { SearchService } from './services/search.service.js';
import { NarratorrClient } from './services/narratorr-client.js';
import { PlexOidcService } from './services/plex-oidc.service.js';
import { createMockNarratorrServer, MOCK_BASE_URL } from './mocks/narratorr-v1.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { authPlugin } from './plugins/auth.js';
import { registerRoutes } from './routes/index.js';
import { errorBody } from '../shared/schemas/v1/common.js';
import type { AppDeps } from './services/deps.js';
import type { Role } from '../shared/schemas/user.js';
import './types.js';

async function main(): Promise<void> {
  await runMigrations(config.databasePath);
  const db = createDb(config.databasePath);

  // Standalone mode: intercept the client's HTTP calls with the MSW contract mock.
  if (config.mode === 'standalone') {
    createMockNarratorrServer().listen({ onUnhandledRequest: 'bypass' });
  }

  const narratorr = new NarratorrClient(
    config.narratorr
      ? { baseUrl: config.narratorr.url, apiKey: config.narratorr.apiKey }
      : { baseUrl: MOCK_BASE_URL, apiKey: 'standalone-mock' },
  );

  const users = new UserService(db);
  const settings = new SettingsService(db);
  const settingsRow = await settings.ensure(config.defaultRequestQuota);
  const requests = new RequestService(db, narratorr, {
    defaultQuota: settingsRow.defaultQuota,
    windowDays: config.quotaWindowDays,
    autoApproveRoles: settingsRow.autoApproveRoles as Role[],
  });
  const search = new SearchService(narratorr);
  const plexOidc = config.plexOidc ? new PlexOidcService(config.plexOidc) : null;

  if (config.authMode === 'bypass') await users.ensureDevAdmin();

  const deps: AppDeps = { config, users, settings, requests, search, plexOidc };

  const app = Fastify({ logger: { level: config.isDev ? 'info' : 'warn' } }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: config.corsOrigin, credentials: true });
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin, deps);

  registerRoutes(app, deps);

  // In production the server also serves the built SPA. In dev, Vite does.
  if (config.isProd) {
    const clientDir = path.join(APP_ROOT, 'dist', 'client');
    await app.register(fastifyStatic, { root: clientDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send(errorBody('NOT_FOUND', `Route ${request.method} ${request.url} not found`));
    });
  } else {
    app.setNotFoundHandler((request, reply) =>
      reply.status(404).send(errorBody('NOT_FOUND', `Route ${request.method} ${request.url} not found`)),
    );
  }

  await app.listen({ port: config.port, host: config.bindHost });
  app.log.info(
    `narrator-request on :${config.port} (mode=${config.mode}, auth=${config.authMode})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
