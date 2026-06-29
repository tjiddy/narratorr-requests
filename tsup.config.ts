import { defineConfig } from 'tsup';

// Server bundle config. The `define` block bakes build-time provenance into the bundle:
// CI passes branch / short SHA / build timestamp as env (via Docker ARGs — see Dockerfile
// and .github/workflows/docker.yml), and esbuild rewrites the matching `process.env.*` reads
// in src/server/version.ts to string literals. Unset (local `pnpm build` / `pnpm dev`) → the
// reads stay empty and version.ts degrades to "dev" / null.
export default defineConfig({
  entry: ['src/server/index.ts'],
  format: 'esm',
  outDir: 'dist/server',
  target: 'node24',
  define: {
    'process.env.APP_GIT_BRANCH': JSON.stringify(process.env.APP_GIT_BRANCH ?? ''),
    'process.env.APP_GIT_SHA': JSON.stringify(process.env.APP_GIT_SHA ?? ''),
    'process.env.APP_BUILD_TIME': JSON.stringify(process.env.APP_BUILD_TIME ?? ''),
  },
});
