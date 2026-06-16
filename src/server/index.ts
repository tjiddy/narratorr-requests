import path from 'node:path';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { config, APP_ROOT } from './config.js';
import { runMigrations } from '../db/migrate.js';
import { createDb } from '../db/client.js';
import { UserService } from './services/user.service.js';
import { SettingsService } from './services/settings.service.js';
import { RequestService } from './services/request.service.js';
import { SearchService } from './services/search.service.js';
import { StatusPoller } from './services/status-poller.js';
import { NarratorrClient } from './services/narratorr-client.js';
import {
  OidcService,
  mapPlexClaims,
  plexAllowlistGate,
  mapAutheliaClaims,
  autheliaAdminGate,
} from './services/oidc.service.js';
import { MOCK_BASE_URL } from './mocks/constants.js';
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
  // Lazily imported so msw/graphql never lands in a production (narratorr-mode) bundle.
  if (config.mode === 'standalone') {
    const { createMockNarratorrServer } = await import('./mocks/narratorr-v1.js');
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
  const plexOidc = config.plexOidc
    ? new OidcService(
        { ...config.plexOidc, scope: 'openid profile email', label: 'Plex' },
        mapPlexClaims,
        plexAllowlistGate(config.plexOidc.allowlist),
      )
    : null;
  const autheliaOidc = config.autheliaOidc
    ? new OidcService(
        { ...config.autheliaOidc, scope: 'openid profile email', label: 'Authelia' },
        mapAutheliaClaims,
        autheliaAdminGate(config.autheliaOidc.adminSubject),
      )
    : null;

  if (config.authMode === 'bypass') await users.ensureDevAdmin();

  const deps: AppDeps = { config, db, users, settings, requests, search, plexOidc, autheliaOidc };

  const app = Fastify({ logger: { level: config.isDev ? 'info' : 'warn' } }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Serve the built SPA whenever a client build is present — the prod image, a bare
  // `pnpm start`, or the standalone container. Under `pnpm dev` there's no build here
  // and Vite serves the client instead.
  const clientDir = path.join(APP_ROOT, 'dist', 'client');
  const serveClient = existsSync(path.join(clientDir, 'index.html'));

  // Browser hardening when we serve the SPA (CSP, frame-ancestors, referrer policy).
  // Skipped under Vite dev so HMR/inline scripts aren't blocked.
  if (serveClient) {
    await app.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          imgSrc: ["'self'", 'https:', 'data:'],
          // scriptSrc stays strict 'self' — the no-flash boot script is served as an
          // external /theme-init.js (not inline) so no hash/nonce is needed.
          scriptSrc: ["'self'"],
          // Google Fonts: stylesheet from fonts.googleapis.com, font files from
          // fonts.gstatic.com (mirrors Narratorr's helmet-options.ts).
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
    });
  }

  await app.register(cors, { origin: config.corsOrigin, credentials: true });
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin, deps);

  registerRoutes(app, deps);

  if (serveClient) {
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

  // Reconcile in-flight acquisitions. Standalone polls fast (the mock advances
  // over ~9s); a live Narratorr is polled gently.
  const poller = new StatusPoller({
    requests,
    client: narratorr,
    logger: app.log,
    intervalSeconds: config.mode === 'standalone' ? 3 : 20,
  });
  poller.start();

  const shutdown = () => {
    poller.stop();
    app.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
