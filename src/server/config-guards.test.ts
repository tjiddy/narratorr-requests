import { describe, it, expect, afterEach, vi } from 'vitest';

// config.ts validates + applies its security guardrails at module *parse* time and throws
// synchronously on a bad env. To exercise the boot-time refusals without crashing the suite,
// each case stubs the env, resets the module cache, and re-imports a fresh copy. Restore the
// env after every test (vitest does NOT auto-unstub unless configured to).
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadConfig(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  return import('./config.js');
}

describe('config — AUTH_BYPASS guardrails (CLAUDE.md security invariant)', () => {
  it('refuses AUTH_BYPASS in production', async () => {
    await expect(loadConfig({ AUTH_BYPASS: '1', NODE_ENV: 'production' })).rejects.toThrow(
      /AUTH_BYPASS must not be enabled in production/,
    );
  });

  it('refuses AUTH_BYPASS bound to a non-loopback host', async () => {
    await expect(loadConfig({ AUTH_BYPASS: '1', NODE_ENV: 'test', BIND_HOST: '0.0.0.0' })).rejects.toThrow(
      /non-loopback host/,
    );
  });

  it('allows a non-loopback AUTH_BYPASS bind with the explicit escape hatch', async () => {
    const mod = await loadConfig({
      AUTH_BYPASS: '1',
      NODE_ENV: 'test',
      BIND_HOST: '0.0.0.0',
      ALLOW_INSECURE_AUTH_BYPASS: '1',
    });
    expect(mod.config.authMode).toBe('bypass');
  });

  it('allows AUTH_BYPASS on a loopback bind', async () => {
    const mod = await loadConfig({ AUTH_BYPASS: '1', NODE_ENV: 'test', BIND_HOST: '127.0.0.1' });
    expect(mod.config.authMode).toBe('bypass');
  });
});

describe('config — SESSION_SECRET', () => {
  it('requires SESSION_SECRET in production', async () => {
    // AUTH_BYPASS is guarded before SESSION_SECRET and may be set ambiently (.env ships
    // AUTH_BYPASS=1 as the dev default), so neutralize it to isolate the guard under test.
    await expect(
      loadConfig({ NODE_ENV: 'production', SESSION_SECRET: '', AUTH_BYPASS: '' }),
    ).rejects.toThrow(/SESSION_SECRET is required in production/);
  });

  it('auto-generates an ephemeral SESSION_SECRET in dev', async () => {
    const mod = await loadConfig({ NODE_ENV: 'test', SESSION_SECRET: '' });
    expect(typeof mod.config.sessionSecret).toBe('string');
    expect(mod.config.sessionSecret.length).toBeGreaterThan(0);
  });

  it('boots a fully specified prod env without throwing (guards an over-eager future regression)', async () => {
    // The positive counterpart to the rejection cases: a legitimate prod boot must not throw.
    // AUTH_BYPASS / OIDC_PROVIDERS are explicitly neutralized (not omitted) — .env ships
    // AUTH_BYPASS=1 and loadConfig() only stubs supplied keys, so an ambient bypass would trip
    // the prod guard before this assertion is reached (mirrors the AUTH_BYPASS:'' pattern above).
    const mod = await loadConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-prod-session-secret',
      LOCAL_AUTH: '1',
      AUTH_BYPASS: '',
      OIDC_PROVIDERS: '',
    });
    expect(mod.config.isProd).toBe(true);
  });
});

describe('config — auth method requirement (standard mode)', () => {
  it('throws when no auth method is configured (local off, no OIDC)', async () => {
    await expect(
      loadConfig({ NODE_ENV: 'test', AUTH_BYPASS: '', LOCAL_AUTH: '0', OIDC_PROVIDERS: '' }),
    ).rejects.toThrow(/No authentication method is configured/);
  });

  it('resolves once a local method is enabled', async () => {
    const mod = await loadConfig({ NODE_ENV: 'test', AUTH_BYPASS: '', LOCAL_AUTH: '1', OIDC_PROVIDERS: '' });
    expect(mod.config.localAuth).toBe(true);
  });
});

describe('config — env coercion', () => {
  it('rejects a non-numeric PORT', async () => {
    await expect(loadConfig({ PORT: '60abc' })).rejects.toThrow(/Invalid environment config/);
  });

  it('rejects a negative DEFAULT_REQUEST_QUOTA', async () => {
    await expect(loadConfig({ DEFAULT_REQUEST_QUOTA: '-1' })).rejects.toThrow(/Invalid environment config/);
  });

  it('maps blank and zero DEFAULT_REQUEST_QUOTA to null (unlimited); a positive value passes through', async () => {
    expect((await loadConfig({ DEFAULT_REQUEST_QUOTA: '' })).config.defaultRequestQuota).toBeNull();
    vi.unstubAllEnvs();
    expect((await loadConfig({ DEFAULT_REQUEST_QUOTA: '0' })).config.defaultRequestQuota).toBeNull();
    vi.unstubAllEnvs();
    expect((await loadConfig({ DEFAULT_REQUEST_QUOTA: '5' })).config.defaultRequestQuota).toBe(5);
  });

  it('defaults LOCAL_AUTH to true when unset and disables it for falsey strings', async () => {
    // AUTH_BYPASS sidesteps the standard-mode no-auth-method throw so localAuth is the only var under test.
    expect((await loadConfig({ AUTH_BYPASS: '1', NODE_ENV: 'test' })).config.localAuth).toBe(true);
    vi.unstubAllEnvs();
    expect((await loadConfig({ AUTH_BYPASS: '1', NODE_ENV: 'test', LOCAL_AUTH: '0' })).config.localAuth).toBe(false);
    vi.unstubAllEnvs();
    expect((await loadConfig({ AUTH_BYPASS: '1', NODE_ENV: 'test', LOCAL_AUTH: 'false' })).config.localAuth).toBe(
      false,
    );
  });
});
