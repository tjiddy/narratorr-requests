import type { FastifyRequest } from 'fastify';

/**
 * Shared @fastify/rate-limit registration options for the auth endpoints. Factored out
 * so the server and the route tests configure the limiter identically.
 *
 * - `global: false` — only routes that opt in via `config.rateLimit` are throttled, so the
 *   4–5s polling endpoints are never capped.
 * - `hook: 'preHandler'` — runs after body parsing/validation so the email is available.
 * - keyed on client IP + attempted email: one fat-fingered member behind a shared
 *   NAT/proxy IP can't lock out the household, while per-account guessing is still capped.
 *   (Routes with no email body — e.g. OIDC login — key on IP alone.) Behind a proxy,
 *   set TRUSTED_PROXIES so `req.ip` is the real client.
 *
 * When the cap trips, the plugin throws an error carrying `statusCode: 429`; the central
 * error handler turns that into the app's `RATE_LIMITED` envelope (see error-handler.ts),
 * so a throttle never masquerades as a 500.
 */
export const authRateLimitOptions = {
  global: false,
  hook: 'preHandler' as const,
  keyGenerator: (req: FastifyRequest): string => {
    const body = req.body as { email?: unknown } | undefined;
    const email =
      body && typeof body === 'object' && typeof body.email === 'string'
        ? body.email.trim().toLowerCase().slice(0, 64)
        : '';
    return `${req.ip}|${email}`;
  },
};
