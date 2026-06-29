// Build-time version + timestamp, baked into the server bundle.
//
// `package.json` stays a static `0.1.0` and git tags are the version of record, so the
// running image must capture its own provenance. There is NO git access inside the Docker
// build (`.dockerignore` excludes `.git/` and the builder copies only src/tsconfig/etc), so
// CI computes the branch / short SHA / build timestamp OUTSIDE the build and forwards them as
// Docker `ARG`s → env into `pnpm build`. tsup's `define` (tsup.config.ts) rewrites these
// `process.env.*` reads to baked string literals at bundle time.
//
// Under `tsx` (dev) or a plain local `pnpm build` with the vars unset, the reads fall through
// to the real (empty) env and degrade to `version: "dev"` / `builtAt: null` — never a crash.

/**
 * Compose the displayed version from the baked branch + short SHA:
 * both present → "branch@sha"; one present → that one; neither → "dev". Pure so the
 * fallback contract is asserted without juggling `process.env` / the tsup define.
 */
export function resolveAppVersion(branch: string, sha: string): string {
  return branch && sha ? `${branch}@${sha}` : sha || branch || 'dev';
}

/** A baked ISO-8601 build timestamp, or null when the build arg was absent. */
export function resolveBuiltAt(builtAt: string): string | null {
  return builtAt || null;
}

// These `process.env.*` reads are what tsup's `define` rewrites to baked literals at bundle
// time; under tsx/vitest (no define) they fall through to the unset env → "dev" / null.
const branch = process.env.APP_GIT_BRANCH ?? '';
const sha = process.env.APP_GIT_SHA ?? '';
const builtAt = process.env.APP_BUILD_TIME ?? '';

/** Branch + short SHA (e.g. "main@a1b2c3d"), or "dev" when nothing was baked in. */
export const APP_VERSION: string = resolveAppVersion(branch, sha);

/** ISO-8601 build timestamp, or null when not baked. */
export const APP_BUILT_AT: string | null = resolveBuiltAt(builtAt);
