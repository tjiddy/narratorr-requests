import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppDeps } from '../services/deps.js';
import { meDtoSchema } from '../../shared/schemas/user.js';
import { requireUser, setSessionCookie, clearSessionCookie } from '../plugins/auth.js';
import { badRequest } from '../util/errors.js';

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const a = app.withTypeProvider<ZodTypeProvider>();
  const postLoginRedirect = deps.config.isProd ? '/' : deps.config.corsOrigin;

  // Current user + rolling quota usage.
  a.get('/api/me', { schema: { response: { 200: meDtoSchema } } }, async (request) => {
    const user = requireUser(request);
    const row = await deps.users.getById(user.id);
    if (!row) throw badRequest('NO_USER', 'session user no longer exists');
    const quota = await deps.requests.quotaUsage(row.id, deps.requests.resolveLimit(row));
    return { ...deps.users.toDto(row), quota };
  });

  // Begin login. In bypass mode there's nothing to do — the dev admin is always
  // authenticated — so bounce home. Otherwise redirect to the Plex bridge.
  a.get('/api/auth/login', async (_request, reply) => {
    if (deps.config.authMode === 'bypass') return reply.redirect(postLoginRedirect);
    if (!deps.plexOidc) throw badRequest('NO_OIDC', 'Plex OIDC is not configured');
    const url = await deps.plexOidc.buildAuthUrl();
    return reply.redirect(url);
  });

  // OAuth callback — exchange code, upsert the user, mint a session cookie.
  a.get('/api/auth/callback', async (request, reply) => {
    const oidc = deps.plexOidc;
    const oidcCfg = deps.config.plexOidc;
    if (!oidc || !oidcCfg) throw badRequest('NO_OIDC', 'Plex OIDC is not configured');
    // Reconstruct the callback URL from the CONFIGURED redirect URI plus only the
    // incoming query (code/state) — never from the attacker-controllable Host header.
    const callbackUrl = new URL(oidcCfg.redirectUri);
    callbackUrl.search = new URL(request.url, callbackUrl.origin).search;
    const profile = await oidc.handleCallback(callbackUrl.toString());
    const user = await deps.users.upsertByPlex(profile, { ownerUsername: oidc.ownerUsername });
    setSessionCookie(reply, deps.config, user);
    return reply.redirect(postLoginRedirect);
  });

  // Logout — clear the session cookie.
  a.post('/api/auth/logout', { schema: { response: { 200: z.object({ ok: z.literal(true) }) } } }, async (_request, reply) => {
    clearSessionCookie(reply, deps.config);
    return reply.send({ ok: true as const });
  });
}
