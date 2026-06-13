# narrator-request

An [Overseerr](https://overseerr.dev/)-style request manager for
[Narratorr](https://github.com/) (Sonarr/Radarr for audiobooks). Family and friends log in
with Plex, search/browse audiobooks, and request them; an admin approves; approved requests
are handed to Narratorr's `search → download → import` pipeline; the requester is notified
when the book is available.

It is a **standalone sidecar** that talks to Narratorr only over its public `/api/v1` HTTP
surface (API key). It has no other coupling.

## Contract-first

The `/api/v1` surface this app consumes is mostly still backlog in Narratorr. So the contract
is **vendored** as Zod schemas in [`src/shared/schemas/narratorr-v1.ts`](src/shared/schemas/narratorr-v1.ts)
(annotated with source-file pointers and `PROPOSED` tags), and a local **MSW mock**
(`src/server/mocks/narratorr-v1.ts`) serves fixtures so the whole app runs with **no Narratorr
instance** ("standalone mode"). That vendored file is the spec that lands in Narratorr.

See [`PLAN.md`](PLAN.md) for the full design, decisions, and Narratorr-side contributions.

## Run it (standalone, no Narratorr, no Plex)

```bash
pnpm install
cp .env.example .env          # AUTH_BYPASS=1 is the default — seeds a dev admin
pnpm db:generate              # generate the initial migration (committed under drizzle/)
pnpm db:migrate               # create the sqlite db
pnpm dev                      # server :3000, client :5173
```

Open http://localhost:5173 — search a (mocked) Audible catalog, request a book, watch it move
`pending → approved → acquiring → available` as the status poller drives the mock acquisition.

## Modes

- **standalone** (default): MSW serves the `/api/v1` contract; no Narratorr needed.
- **narratorr**: set `NARRATORR_URL` + `NARRATORR_API_KEY` — the same client code hits the live
  endpoints once Narratorr's `/api/v1` reads land.

Auth mirrors the same idea: `AUTH_BYPASS=1` seeds a dev admin (no Plex needed); unset it and
configure `PLEX_OIDC_*` to use the real Plex OIDC bridge.

## Verify

```bash
pnpm verify   # lint + test + typecheck + build
```

## Status

MVP per `PLAN.md` phases 1–8. **Deferred** (need Todd's live infra): the Plex OIDC live spike
and narratorr-mode wiring against a real `/api/v1`. Everything is verified in **standalone mode**.
