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

## Docker

A single container runs everything (Fastify API + the built SPA), with the libSQL file on a
named volume and migrations applied on boot. The image serves the SPA whenever a client build
is present, so the container is the whole app — no separate web server.

**Smoke test (standalone, zero config):**

```bash
docker compose up --build      # http://localhost:3000
```

Out of the box this runs in **standalone + AUTH_BYPASS** mode (built-in `/api/v1` mock, seeded
dev admin) so you can confirm the image works with no Plex/Narratorr. `/api/health` reports
readiness (it pings the DB), and the container has a matching `HEALTHCHECK`.

**Real deployment:**

```bash
cp .env.docker.example .env     # fill SESSION_SECRET, PLEX_OIDC_*, NARRATORR_* …
#                                 and set NODE_ENV=production, AUTH_BYPASS=0
docker compose up -d --build
```

In production the app **refuses to start** without a `SESSION_SECRET`, refuses `AUTH_BYPASS`
entirely, and (in Plex mode) requires `PLEX_ALLOWLIST` or `PLEX_OWNER_USERNAME` — so a
misconfigured deployment fails fast rather than exposing an open admin. The build is a 3-stage
`node:24-slim` image that runs as the non-root `node` user; the DB persists in the
`narrator-request-data` volume (`/data`).

## Verify

```bash
pnpm verify   # lint + test + typecheck + build
```

## Status

MVP per `PLAN.md` phases 1–8. **Deferred** (need Todd's live infra): the Plex OIDC live spike
and narratorr-mode wiring against a real `/api/v1`. Everything is verified in **standalone mode**.
