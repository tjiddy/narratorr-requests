import { describe, it, expect, afterEach } from 'vitest';
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

describe('parseOidcProviders', () => {
  it('builds a provider config with sensible defaults', () => {
    setEnv('OIDC_PLEX_ISSUER', 'https://plex.example.com');
    setEnv('OIDC_PLEX_CLIENT_ID', 'narratorr-request');
    setEnv('OIDC_PLEX_REDIRECT_URI', 'https://r.example.com/api/auth/oidc/plex/callback');
    const [p] = parseOidcProviders(['plex']);
    expect(p).toMatchObject({
      id: 'plex',
      label: 'Plex', // default = capitalized id
      issuer: 'https://plex.example.com',
      clientId: 'narratorr-request',
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
