# Contributing to narratorr-request

Thanks for your interest! This is the request-manager sidecar to
[narratorr](https://github.com/tjiddy/narratorr). If something here is thin or out of date,
open an issue or PR.

## Getting started

```bash
git clone https://github.com/tjiddy/narratorr-request.git
cd narratorr-request
pnpm install
cp .env.example .env     # AUTH_BYPASS=1 by default — seeds a dev admin, loopback only
pnpm db:migrate          # create/upgrade the local libSQL db
pnpm dev                 # API on :3000, Vite on :5173 (proxies /api → server)
```

Requires **Node ≥ 24.10** and **pnpm** (pinned in `package.json` → `packageManager`).

## Branch model

- `main` — released trunk (default branch; tags/releases are cut here).
- `develop` — active development.

**Branch off `develop` and open PRs against `develop`.** `main` only advances at release
milestones — don't target it with feature PRs.

## Development workflow

1. Find or open an issue describing the change.
2. Branch off `develop`: `git checkout -b feature/<short-slug>`.
3. Make the change **with tests** for anything new or modified.
4. Run the quality gate (below).
5. Open a PR against `develop`.

## Quality gate

Everything must pass before a PR merges:

```bash
pnpm verify   # = pnpm lint && pnpm test && pnpm typecheck && pnpm build
```

(Or individually: `pnpm lint`, `pnpm test`, `pnpm typecheck`, `pnpm build`.)

## Architecture

```
src/
  server/         — Fastify app, routes, services, plugins, the narratorr client, MSW mock
    routes/       — handlers (Zod-validated via fastify-type-provider-zod)
    services/     — business logic (constructor-injected deps)
    plugins/      — auth, rate-limit, error handler
  client/         — React 19 SPA (the browser calls only our /api/*)
  shared/schemas/ — Zod schemas shared client+server
    v1/ + book.ts — the VENDORED narratorr contract (see below)
    request.ts / user.ts / connectors.ts — our own domain schemas
  db/             — Drizzle schema + migration runner; drizzle/ holds generated migrations
```

## Conventions (read before editing)

- **ESM import extensions.** Relative imports use `.js` even from `.ts` (Node ESM needs the
  runtime extension). `verbatimModuleSyntax` is on — use `import type` for type-only imports.
  Path aliases: `@shared/*`, `@/*` (client).
- **TypeScript strict is load-bearing.** `exactOptionalPropertyTypes` is on — never assign
  `: undefined`; spread conditionally (`...(x !== undefined && { x })`). `noUncheckedIndexedAccess`
  and `noUnusedLocals/Parameters` are on too. Don't reach for `any` / `as` to paper over types.
- **The vendored narratorr contract is consumer-lenient on purpose.** `src/shared/schemas/v1/*`
  + `book.ts` mirror narratorr's own layout and are **non-`.strict()`** — they assert only what we
  consume and tolerate provider drift on unused fields. **Do not add `.strict()` there.** A
  response that fails the schema becomes a `502 CONTRACT_MISMATCH`. (Our own domain schemas —
  `request.ts` / `user.ts` / `connectors.ts` — are different: those are strict about our inputs.)
- **Server-to-server only.** The narratorr API key is a backend secret — it never reaches the
  browser. The browser talks only to our `/api/*`.
- **Connector config lives in the DB, encrypted** (`SecretCodec`), set in the admin Settings
  page — not env. The env surface is deliberately just auth + secrets (`src/server/config.ts`).

## Database changes

Edit `src/db/schema.ts`, then run `pnpm db:generate` (drizzle-kit — **interactive**, needs a
TTY) and commit the whole generated `drizzle/` folder (the SQL file plus the `meta/` journal and
snapshot are co-required — committing only the SQL silently skips the migration). Migrations
apply on boot and are **forward-only**. Note: libSQL `:memory:` breaks across `db.transaction()`
— prefer atomic single statements in tests.

## Testing

Vitest, node environment; co-located `*.test.ts` next to source. All new/changed code needs
tests. The narratorr integration is exercised via the MSW fixture (`src/server/mocks/`).

Test-quality bar: assert **arguments**, not just invocation (`toHaveBeenCalledWith`); cover every
branch and error path; isolate ambient inputs (fixed clock / stubbed env / MSW — no live
`Date.now()` or network); and don't write vacuous tests (one that passes before the production
code exists is a bug, not coverage).

> **Client tests are pure-logic only** (node env, no DOM) for now — React component/interaction
> tests aren't set up yet. That's tracked in
> [#7](https://github.com/tjiddy/narratorr-request/issues/7) and is a good first contribution.
> For now, test extractable hook/transform logic, not rendering.

## Security

Found a vulnerability? **Don't open a public issue** — see [SECURITY.md](SECURITY.md) for the
private disclosure path.

## License

By contributing, you agree your contributions are licensed under the project's
[GPL-3.0 license](LICENSE).
