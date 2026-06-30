import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOidcProviders, parseBootstrapAdmin, parseTrustProxy } from './config.js';

// parseOidcProviders reads OIDC_<ID>_* from process.env; track + clean up what we set.
const touched: string[] = [];
function setEnv(key: string, value: string) {
  touched.push(key);
  process.env[key] = value;
}
afterEach(() => {
  for (const k of touched.splice(0)) delete process.env[k];
});

// Real on-disk secret files for the _FILE-sourcing tests.
const secretsDir = mkdtempSync(join(tmpdir(), 'nr-oidc-secrets-'));
let fileSeq = 0;
function secretFile(contents: string): string {
  const p = join(secretsDir, `secret-${fileSeq++}`);
  writeFileSync(p, contents, 'utf8');
  return p;
}
const MISSING_PATH = join(secretsDir, 'does-not-exist');
afterAll(() => rmSync(secretsDir, { recursive: true, force: true }));

describe('parseOidcProviders', () => {
  it('builds a provider config with sensible defaults', () => {
    setEnv('OIDC_PLEX_ISSUER', 'https://plex.example.com');
    setEnv('OIDC_PLEX_CLIENT_ID', 'narratorr-requests');
    setEnv('OIDC_PLEX_REDIRECT_URI', 'https://r.example.com/api/auth/oidc/plex/callback');
    const [p] = parseOidcProviders(['plex']);
    expect(p).toMatchObject({
      id: 'plex',
      label: 'Plex', // default = capitalized id
      issuer: 'https://plex.example.com',
      clientId: 'narratorr-requests',
      scope: 'openid profile email', // default scope
      clientSecret: undefined,
    });
  });

  it('honors label + claim overrides', () => {
    setEnv('OIDC_AUTHELIA_ISSUER', 'https://auth.example.com');
    setEnv('OIDC_AUTHELIA_CLIENT_ID', 'id');
    setEnv('OIDC_AUTHELIA_REDIRECT_URI', 'https://r/cb');
    setEnv('OIDC_AUTHELIA_LABEL', 'Company SSO');
    setEnv('OIDC_AUTHELIA_USERNAME_CLAIM', 'login');
    const [p] = parseOidcProviders(['authelia']);
    expect(p).toMatchObject({ label: 'Company SSO', usernameClaim: 'login' });
  });

  it('throws listing the missing required keys', () => {
    setEnv('OIDC_GOOGLE_ISSUER', 'https://accounts.google.com');
    expect(() => parseOidcProviders(['google'])).toThrow(/OIDC_GOOGLE_CLIENT_ID.*OIDC_GOOGLE_REDIRECT_URI/);
  });

  it('rejects an invalid provider id', () => {
    expect(() => parseOidcProviders(['Bad-Id'])).toThrow(/Invalid OIDC provider id/);
    expect(() => parseOidcProviders(['../x'])).toThrow(/Invalid OIDC provider id/);
  });

  it('rejects duplicate ids', () => {
    setEnv('OIDC_DUP_ISSUER', 'https://x');
    setEnv('OIDC_DUP_CLIENT_ID', 'x');
    setEnv('OIDC_DUP_REDIRECT_URI', 'https://x/cb');
    expect(() => parseOidcProviders(['dup', 'dup'])).toThrow(/Duplicate OIDC provider id/);
  });
});

describe('parseOidcProviders — CLIENT_SECRET _FILE sourcing', () => {
  // The three required keys, so the provider builds and we can assert on clientSecret.
  function setRequired(id: string) {
    const U = id.toUpperCase();
    setEnv(`OIDC_${U}_ISSUER`, 'https://idp.example.com');
    setEnv(`OIDC_${U}_CLIENT_ID`, 'cid');
    setEnv(`OIDC_${U}_REDIRECT_URI`, 'https://r.example.com/cb');
  }

  it('sources the client secret from _FILE, trimmed', () => {
    setRequired('plex');
    setEnv('OIDC_PLEX_CLIENT_SECRET_FILE', secretFile('oidc-file-secret\n'));
    const [p] = parseOidcProviders(['plex']);
    expect(p?.clientSecret).toBe('oidc-file-secret');
  });

  it('still honors the plain OIDC_<ID>_CLIENT_SECRET (trimmed) when no _FILE is set', () => {
    setRequired('plex');
    setEnv('OIDC_PLEX_CLIENT_SECRET', '  plain-oidc-secret  ');
    const [p] = parseOidcProviders(['plex']);
    expect(p?.clientSecret).toBe('plain-oidc-secret');
  });

  it('lets _FILE take precedence over the plain var', () => {
    setRequired('plex');
    setEnv('OIDC_PLEX_CLIENT_SECRET', 'plain-loser');
    setEnv('OIDC_PLEX_CLIENT_SECRET_FILE', secretFile('from-file-wins\n'));
    const [p] = parseOidcProviders(['plex']);
    expect(p?.clientSecret).toBe('from-file-wins');
  });

  it('coalesces an empty-after-trim _FILE to undefined (optional secret)', () => {
    setRequired('plex');
    setEnv('OIDC_PLEX_CLIENT_SECRET_FILE', secretFile('   \n'));
    const [p] = parseOidcProviders(['plex']);
    expect(p?.clientSecret).toBeUndefined();
  });

  it('throws (does NOT coalesce) when the _FILE is unreadable, naming the var + path, never contents', () => {
    setRequired('plex');
    setEnv('OIDC_PLEX_CLIENT_SECRET_FILE', MISSING_PATH);
    let message = '';
    try {
      parseOidcProviders(['plex']);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/OIDC_PLEX_CLIENT_SECRET_FILE/);
    expect(message).toMatch(/could not be read/);
    expect(message).toContain(MISSING_PATH);
  });
});

describe('parseBootstrapAdmin', () => {
  it('parses "<provider>:<value>" and lowercases the provider', () => {
    expect(parseBootstrapAdmin('Authelia:Todd')).toEqual({ provider: 'authelia', value: 'Todd' });
    expect(parseBootstrapAdmin('plex:sub:with:colons')).toEqual({ provider: 'plex', value: 'sub:with:colons' });
  });
  it('returns null when unset/blank', () => {
    expect(parseBootstrapAdmin(undefined)).toBeNull();
    expect(parseBootstrapAdmin('   ')).toBeNull();
  });
  it('throws on a malformed value (no colon, empty side)', () => {
    expect(() => parseBootstrapAdmin('noColon')).toThrow();
    expect(() => parseBootstrapAdmin(':value')).toThrow();
    expect(() => parseBootstrapAdmin('provider:')).toThrow();
  });
});

describe('parseTrustProxy', () => {
  it('maps off/on/number/list forms', () => {
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
  });
});
