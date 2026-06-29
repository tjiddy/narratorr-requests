import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolveAppVersion, resolveBuiltAt } from './version.js';

// F1 — directly assert the build-provenance contract: the baked composition AND the
// local/dev fallback. Deleting the "dev"/null fallback or changing the branch@sha shape
// now fails here (the route test alone only checked "some string" / "string-or-null").

describe('resolveAppVersion (baked composition + fallback)', () => {
  it('composes "branch@sha" when both are baked', () => {
    expect(resolveAppVersion('main', 'a1b2c3d')).toBe('main@a1b2c3d');
  });

  it('uses the sha alone when only the sha is baked', () => {
    expect(resolveAppVersion('', 'a1b2c3d')).toBe('a1b2c3d');
  });

  it('uses the branch alone when only the branch is baked', () => {
    expect(resolveAppVersion('main', '')).toBe('main');
  });

  it('degrades to "dev" when neither arg is baked (local build / dev)', () => {
    expect(resolveAppVersion('', '')).toBe('dev');
  });
});

describe('resolveBuiltAt (timestamp + fallback)', () => {
  it('passes a baked ISO-8601 timestamp through unchanged', () => {
    expect(resolveBuiltAt('2026-06-29T00:00:00.000Z')).toBe('2026-06-29T00:00:00.000Z');
  });

  it('degrades to null when the build arg is absent', () => {
    expect(resolveBuiltAt('')).toBeNull();
  });
});

// The module constants are computed once at module-eval from process.env (the reads tsup's
// define rewrites at build time). To assert the wiring deterministically we must CONTROL that
// env input — stub the keys, reset the module registry, then dynamically re-import so the
// module body re-evaluates against the stubbed env (host APP_GIT_* values can't leak in).
describe('module constants (env-controlled re-import)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('degrade to the dev/null fallback when build args are unset', async () => {
    vi.stubEnv('APP_GIT_BRANCH', '');
    vi.stubEnv('APP_GIT_SHA', '');
    vi.stubEnv('APP_BUILD_TIME', '');
    vi.resetModules();
    const mod = await import('./version.js');
    expect(mod.APP_VERSION).toBe('dev');
    expect(mod.APP_BUILT_AT).toBeNull();
  });

  it('flow the baked branch@sha and timestamp through when build args are set', async () => {
    vi.stubEnv('APP_GIT_BRANCH', 'main');
    vi.stubEnv('APP_GIT_SHA', 'a1b2c3d');
    vi.stubEnv('APP_BUILD_TIME', '2026-06-29T00:00:00.000Z');
    vi.resetModules();
    const mod = await import('./version.js');
    expect(mod.APP_VERSION).toBe('main@a1b2c3d');
    expect(mod.APP_BUILT_AT).toBe('2026-06-29T00:00:00.000Z');
  });
});
