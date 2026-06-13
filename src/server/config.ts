import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

// Load .env for native dev (no-op if absent / already in env). Production passes
// real env vars (docker-compose), so a missing file is fine.
try {
  process.loadEnvFile('.env');
} catch {
  // no .env — rely on process.env
}

// Anchor relative paths (the sqlite file) to the repo root — two levels up from
// this module (src/server in dev, dist/server after bundling) — NOT process.cwd().
export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const resolveFromRoot = (p: string) => (path.isAbsolute(p) ? p : path.resolve(APP_ROOT, p));

// empty/absent → default, otherwise coerce STRICTLY (Number("60abc") = NaN, which
// z.number() rejects — unlike parseInt which would yield 60).
const intFromString = (def: string) =>
  z
    .string()
    .default(def)
    .transform((v) => Number(v.trim() === '' ? def : v.trim()))
    .pipe(z.number().int());

const boolFromString = z
  .string()
  .default('')
  .transform((v) => ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()));

// Comma/semicolon separated → trimmed non-empty list.
const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  PORT: intFromString('3000').pipe(z.number().int().min(1).max(65535)),
  NODE_ENV: z.string().default(''),
  CORS_ORIGIN: z.string().default('http://localhost:5173').transform((v) => v || 'http://localhost:5173'),
  // Default to loopback: with AUTH_BYPASS on, binding to 0.0.0.0 would expose an
  // unauthenticated admin. Real LAN/Docker deployments set BIND_HOST=0.0.0.0
  // explicitly (and run with auth on, not bypass).
  BIND_HOST: z.string().default('127.0.0.1').transform((v) => v || '127.0.0.1'),

  DATABASE_PATH: z
    .string()
    .default('./narrator-request.db')
    .transform((v) => resolveFromRoot(v || './narrator-request.db')),

  SESSION_SECRET: z.string().optional(),

  // Narratorr coupling — presence of both flips mode to "narratorr".
  NARRATORR_URL: z.string().optional(),
  NARRATORR_API_KEY: z.string().optional(),

  // Auth.
  AUTH_BYPASS: boolFromString,
  // Escape hatch to allow AUTH_BYPASS while bound to a non-loopback host.
  ALLOW_INSECURE_AUTH_BYPASS: boolFromString,
  PLEX_OIDC_ISSUER: z.string().optional(),
  PLEX_OIDC_CLIENT_ID: z.string().optional(),
  PLEX_OIDC_CLIENT_SECRET: z.string().optional(),
  PLEX_OIDC_REDIRECT_URI: z.string().optional(),
  PLEX_ALLOWLIST: csv,
  PLEX_OWNER_USERNAME: z.string().optional(),

  // Requests. Validated here (fail-fast, like PORT): a non-negative integer, with
  // blank/0 meaning unlimited (null). Rejects junk like "10abc" and negatives.
  DEFAULT_REQUEST_QUOTA: z
    .string()
    .default('10')
    .transform((v) => v.trim())
    .refine((v) => v === '' || /^\d+$/.test(v), 'must be a non-negative integer or blank')
    .transform((v) => (v === '' || v === '0' ? null : Number(v))),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment config:\n${z.prettifyError(parsed.error)}`);
}
const env = parsed.data;

const isProd = env.NODE_ENV === 'production';
const isDev = !isProd;

// Narratorr mode needs BOTH url + key. Half-configured is almost always a mistake
// that would silently run against the mock — fail fast instead.
if (Boolean(env.NARRATORR_URL) !== Boolean(env.NARRATORR_API_KEY)) {
  throw new Error(
    'Set BOTH NARRATORR_URL and NARRATORR_API_KEY for narratorr mode, or NEITHER for standalone.',
  );
}
const mode: 'standalone' | 'narratorr' =
  env.NARRATORR_URL && env.NARRATORR_API_KEY ? 'narratorr' : 'standalone';

const authMode: 'bypass' | 'plex' = env.AUTH_BYPASS ? 'bypass' : 'plex';

if (authMode === 'bypass' && isProd) {
  throw new Error('AUTH_BYPASS must not be enabled in production (NODE_ENV=production).');
}
// AUTH_BYPASS makes every request the dev admin — refuse to expose that on a
// non-loopback interface unless explicitly acknowledged.
const isLoopbackBind = ['127.0.0.1', 'localhost', '::1'].includes(env.BIND_HOST);
if (authMode === 'bypass' && !isLoopbackBind && !env.ALLOW_INSECURE_AUTH_BYPASS) {
  throw new Error(
    `AUTH_BYPASS exposes an unauthenticated admin; refusing to bind to non-loopback host "${env.BIND_HOST}". ` +
      'Bind to 127.0.0.1, or set ALLOW_INSECURE_AUTH_BYPASS=1 if you truly intend this (e.g. an isolated LAN).',
  );
}

// Session secret: required in prod; dev auto-generates an ephemeral one (sessions
// drop on restart, which is fine locally).
let sessionSecret = env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProd) throw new Error('SESSION_SECRET is required in production.');
  sessionSecret = randomBytes(32).toString('hex');
}

// Plex OIDC config is only assembled (and required) when not bypassing auth.
let plexOidc: {
  issuer: string;
  clientId: string;
  clientSecret: string | undefined;
  redirectUri: string;
  allowlist: string[];
  ownerUsername: string | null;
} | null = null;

if (authMode === 'plex') {
  const missing = (
    [
      ['PLEX_OIDC_ISSUER', env.PLEX_OIDC_ISSUER],
      ['PLEX_OIDC_CLIENT_ID', env.PLEX_OIDC_CLIENT_ID],
      ['PLEX_OIDC_REDIRECT_URI', env.PLEX_OIDC_REDIRECT_URI],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `Plex OIDC is enabled (AUTH_BYPASS off) but missing: ${missing.join(', ')}. ` +
        `Set them or enable AUTH_BYPASS=1 for standalone dev.`,
    );
  }
  // An empty allowlist would let ANY Plex account sign in, and the first becomes
  // admin. Tolerable in dev; refuse it in production.
  if (isProd && env.PLEX_ALLOWLIST.length === 0 && !env.PLEX_OWNER_USERNAME) {
    throw new Error(
      'In production Plex mode set PLEX_ALLOWLIST or PLEX_OWNER_USERNAME — an empty allowlist ' +
        'lets any Plex account sign in and the first one become admin.',
    );
  }
  plexOidc = {
    issuer: env.PLEX_OIDC_ISSUER as string,
    clientId: env.PLEX_OIDC_CLIENT_ID as string,
    clientSecret: env.PLEX_OIDC_CLIENT_SECRET,
    redirectUri: env.PLEX_OIDC_REDIRECT_URI as string,
    allowlist: env.PLEX_ALLOWLIST,
    ownerUsername: env.PLEX_OWNER_USERNAME ?? null,
  };
}

// Parsed + validated in the env schema (blank/0 → unlimited).
const defaultRequestQuota = env.DEFAULT_REQUEST_QUOTA;

export const config = {
  port: env.PORT,
  bindHost: env.BIND_HOST,
  isDev,
  isProd,
  corsOrigin: env.CORS_ORIGIN,
  databasePath: env.DATABASE_PATH,
  sessionSecret,
  mode,
  narratorr:
    mode === 'narratorr'
      ? { url: env.NARRATORR_URL as string, apiKey: env.NARRATORR_API_KEY as string }
      : null,
  authMode,
  plexOidc,
  defaultRequestQuota,
  /** Rolling quota window in days (PLAN decision #5). */
  quotaWindowDays: 30,
};

export type AppConfig = typeof config;
