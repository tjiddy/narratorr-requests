import { describe, it, expect } from 'vitest';
import { resolveAppVersion, resolveBuiltAt, APP_VERSION, APP_BUILT_AT } from './version.js';

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

describe('module constants under an unbaked runtime (vitest has no tsup define)', () => {
  it('degrade to the dev/null fallback when build args are unset', () => {
    // CI/dev run with no APP_GIT_* / APP_BUILD_TIME env, so the constants must take the
    // fallback — the exact contract a plain local `pnpm build` / `pnpm dev` ships.
    expect(APP_VERSION).toBe('dev');
    expect(APP_BUILT_AT).toBeNull();
  });
});
