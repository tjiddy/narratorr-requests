# narrator-request

An [Overseerr](https://overseerr.dev/)-style request manager for
[Narratorr](https://github.com/) (Sonarr/Radarr for audiobooks). Family and friends log in
with Plex, search/browse audiobooks, and request them; an admin approves; approved requests
are handed to Narratorr's `search → download → import` pipeline; the requester is notified
when the book is available.

It is a **plug-in sidecar** that talks to Narratorr only over its public `/api/v1` HTTP
surface (API key). It has no other coupling. The Narratorr connection and the notification
channels (ntfy / email / webhook) are configured in the in-app **Settings** page after first
boot — not via environment variables — and stored encrypted in the DB, so spinning it up
takes a minimal env (a session secret + auth) and the rest is point-and-click.

## Contract-first

The `/api/v1` surface this app consumes is vendored as Zod schemas in
[`src/shared/schemas/narratorr-v1.ts`](src/shared/schemas/narratorr-v1.ts) (annotated with
source-file pointers and `PROPOSED` tags); that vendored file is the spec that lands in
Narratorr. The matching **MSW handlers** (`src/server/mocks/narratorr-v1.ts`) are a **test
fixture** — they back the contract tests; there is no mock runtime mode.

See [`PLAN.md`](PLAN.md) for the full design, decisions, and Narratorr-side contributions.

## Run it (local dev)

```bash
pnpm install
cp .env.example .env          # AUTH_BYPASS=1 is the default — seeds a dev admin
pnpm db:migrate               # create/upgrade the sqlite db
pnpm dev                      # server :3000, client :5173
```

Open http://localhost:5173, then go to **Settings** and enter a Narratorr URL + API key
(use **Test** to verify) to enable search and requests. Turn on a notification channel the
same way. Until Narratorr is configured, search/requests return a "not connected yet" notice.

## Auth

- `AUTH_BYPASS=1` (dev) seeds a dev admin and skips Plex entirely — every request is the admin,
  so it's refused in production and on non-loopback binds.
- Unset it and configure `PLEX_OIDC_*` for the real Plex OIDC bridge. `AUTHELIA_OIDC_*` adds an
  optional operator admin SSO. See [`.env.example`](.env.example).

## Settings (in-app)

The admin **Settings** page configures, and stores encrypted at rest:

- **Narratorr connection** — base URL + API key (the lifeline; required for search/requests).
- **Notifications** — ntfy, email (SMTP), and a generic/Discord webhook; each with a **Test** button.
- **Public URL** — used to deep-link notifications back to the request queue.

Secrets are never returned to the browser (the form shows `•••• unchanged`). The at-rest key
comes from `SETTINGS_KEY`, or is derived from `SESSION_SECRET` when that's unset — see the
caveat in [`.env.docker.example`](.env.docker.example).

## Docker

A single container runs everything (Fastify API + the built SPA), with the libSQL file on a
named volume and migrations applied on boot.

**Smoke test (boots into the admin UI, zero config):**

```bash
docker compose up --build      # http://localhost:3000
```

Out of the box this runs in **AUTH_BYPASS** mode (seeded dev admin) so you can confirm the
image runs and serves the UI. `/api/health` reports readiness (it pings the DB and reports
`narratorrConfigured`), and the container has a matching `HEALTHCHECK`. Configure Narratorr in
Settings to actually request anything.

**Real deployment:**

```bash
cp .env.docker.example .env     # fill SESSION_SECRET (+ SETTINGS_KEY), PLEX_OIDC_* …
#                                 and set NODE_ENV=production, AUTH_BYPASS=0
docker compose up -d --build
# then open the app, sign in, and configure Narratorr + notifications in Settings
```

In production the app **refuses to start** without a `SESSION_SECRET`, refuses `AUTH_BYPASS`
entirely, and (in Plex mode) requires `PLEX_ALLOWLIST` or `PLEX_OWNER_USERNAME` — so a
misconfigured deployment fails fast rather than exposing an open admin. The build is a 3-stage
`node:24-slim` image that runs as the non-root `node` user; the DB persists in the
`narrator-request-data` volume (`/data`).

### Published images

CI (`.github/workflows/docker.yml`) builds a multi-arch (amd64/arm64) image and pushes to
**Docker Hub `narratorr/narratorr-request`** and **GHCR `ghcr.io/tjiddy/narratorr-request`**:

- **Release** — push a semver tag (`git tag v0.1.0 && git push origin v0.1.0`) → `:latest`, `:0.1.0`,
  `:0.1` + a GitHub Release.
- **Bleeding edge** — run the workflow manually (Actions → *Build & Push Docker Image* → Run) → `:edge`.

Quality gates (lint/typecheck/test/build) run first, and the pushed image is smoke-tested before
the job succeeds. Requires repo secrets **`DOCKERHUB_USERNAME`** and **`DOCKERHUB_TOKEN`**.

## Verify

```bash
pnpm verify   # lint + test + typecheck + build
```
