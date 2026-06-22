import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as oidc from 'openid-client';
import { OidcService, makeOidcMapper, type OidcServiceConfig } from './oidc.service.js';

// Unlike oidc.service.test.ts — which mocks every openid-client export to a constant so the
// flow is deterministic — this suite keeps the REAL crypto generators (randomState,
// randomNonce, randomPKCECodeVerifier, calculatePKCECodeChallenge) and mocks only the two
// network/URL-touching exports: `discovery` (no live IdP) and `buildAuthorizationUrl` (echo
// the params it is handed into a URL so the test can read state/nonce/code_challenge back).
//
// Reading those three values off the URL `buildAuthUrl()` PRODUCES is what makes the
// randomness assertion service-bound: if the service ever stops calling a real generator
// (regresses state/nonce/PKCE-verifier to a constant or Math.random()), the per-value
// uniqueness/shape assertions break. Testing the generators in isolation would not.
vi.mock('openid-client', async (importOriginal) => {
  const actual = await importOriginal<typeof oidc>();
  return {
    ...actual,
    discovery: vi.fn(),
    buildAuthorizationUrl: vi.fn((_config: unknown, params: Record<string, string>): URL => {
      const u = new URL('https://idp.example/authorize');
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
      return u;
    }),
  };
});

const cfg: OidcServiceConfig = {
  issuer: 'https://idp.example/',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  redirectUri: 'https://app.example/api/auth/oidc/callback',
  scope: 'openid profile email',
  label: 'Authelia',
};

const mapper = makeOidcMapper('Authelia');
const makeService = () => new OidcService(cfg, mapper);

// A minimal opaque Configuration sentinel — buildAuthUrl never inspects it (our
// buildAuthorizationUrl mock ignores the config arg).
const CONFIG = { issuer: 'mock-config' } as unknown as oidc.Configuration;

// openid-client's randomState/randomNonce/randomPKCECodeVerifier and the S256 code_challenge
// are all base64url-encoded 32-byte values → 43 chars, no padding.
const BASE64URL = /^[A-Za-z0-9_-]+$/;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(oidc.discovery).mockResolvedValue(CONFIG);
});

describe('OidcService.buildAuthUrl randomness source (AC1)', () => {
  it('flows real crypto-strong state/nonce/code_challenge through the service on every call', async () => {
    const N = 50;
    const svc = makeService();
    const states = new Set<string>();
    const nonces = new Set<string>();
    const challenges = new Set<string>();

    for (let i = 0; i < N; i++) {
      const url = new URL(await svc.buildAuthUrl(i));
      const state = url.searchParams.get('state');
      const nonce = url.searchParams.get('nonce');
      const challenge = url.searchParams.get('code_challenge');

      // Present on every call — a swap to a constant/weak source for any of the three breaks
      // either presence or, below, uniqueness.
      expect(state).toBeTruthy();
      expect(nonce).toBeTruthy();
      expect(challenge).toBeTruthy();

      // Exactly 43 base64url chars (32 random bytes / the S256 digest). Pinned to `toBe(43)`
      // rather than a `>=` floor so a long-but-weak source (e.g. concatenated Math.random hex,
      // which also matches BASE64URL) is caught structurally, not just by the uniqueness check
      // below. The code_challenge is the S256 digest of the (never-surfaced) PKCE verifier, so
      // its uniqueness below implies the verifier itself is unique per call.
      for (const v of [state, nonce, challenge]) {
        expect(v).toMatch(BASE64URL);
        expect(v!.length).toBe(43);
      }

      // S256 only — the verifier path is exercised through this derived challenge.
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');

      states.add(state!);
      nonces.add(nonce!);
      challenges.add(challenge!);
    }

    // All-unique across N calls on ONE instance: proves every value comes from a real
    // per-call generator, not a memoized constant.
    expect(states.size).toBe(N);
    expect(nonces.size).toBe(N);
    expect(challenges.size).toBe(N);
  });
});

describe('OidcService discovery memoization happy path (AC2)', () => {
  it('reuses the cached config across calls on one instance (discovery runs exactly once)', async () => {
    const svc = makeService();
    await svc.buildAuthUrl(0);
    await svc.buildAuthUrl(1);
    // The per-instance configPromise cache means the second call reuses the resolved config.
    expect(vi.mocked(oidc.discovery)).toHaveBeenCalledTimes(1);
  });
});
