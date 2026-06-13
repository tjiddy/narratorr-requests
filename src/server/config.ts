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
  BIND_HOST: z.string().default('0.0.0.0').transform((v) => v || '0.0.0.0'),

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
  PLEX_OIDC_ISSUER: z.string().optional(),
  PLEX_OIDC_CLIENT_ID: z.string().optional(),
  PLEX_OIDC_CLIENT_SECRET: z.string().optional(),
  PLEX_OIDC_REDIRECT_URI: z.string().optional(),
  PLEX_ALLOWLIST: csv,
  PLEX_OWNER_USERNAME: z.string().optional(),

  // Requests.
  DEFAULT_REQUEST_QUOTA: z.string().default('10'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment config:\n${z.prettifyError(parsed.error)}`);
}
const env = parsed.data;

const isProd = env.NODE_ENV === 'production';
const isDev = !isProd;

const mode: 'standalone' | 'narratorr' =
  env.NARRATORR_URL && env.NARRATORR_API_KEY ? 'narratorr' : 'standalone';

const authMode: 'bypass' | 'plex' = env.AUTH_BYPASS ? 'bypass' : 'plex';

if (authMode === 'bypass' && isProd) {
  throw new Error('AUTH_BYPASS must not be enabled in production (NODE_ENV=production).');
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
  plexOidc = {
    issuer: env.PLEX_OIDC_ISSUER as string,
    clientId: env.PLEX_OIDC_CLIENT_ID as string,
    clientSecret: env.PLEX_OIDC_CLIENT_SECRET,
    redirectUri: env.PLEX_OIDC_REDIRECT_URI as string,
    allowlist: env.PLEX_ALLOWLIST,
    ownerUsername: env.PLEX_OWNER_USERNAME ?? null,
  };
}

// Quota: blank/0 → unlimited (null).
const quotaRaw = env.DEFAULT_REQUEST_QUOTA.trim();
const defaultRequestQuota = quotaRaw === '' || quotaRaw === '0' ? null : Number.parseInt(quotaRaw, 10);
if (defaultRequestQuota !== null && !Number.isInteger(defaultRequestQuota)) {
  throw new Error(`DEFAULT_REQUEST_QUOTA must be an integer or blank, got "${quotaRaw}".`);
}

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
