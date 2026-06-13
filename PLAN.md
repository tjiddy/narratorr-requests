# Plan: `narrator-request` — an Overseerr-style request manager for Narratorr

> **Status:** Codex-reviewed 2026-06-13 — verdict *ship with changes*; the five open questions are now locked
> decisions (see "Decisions"). Topology settled: **3 separate repos**. **Cleared for AUTONOMOUS implementation —
> read this whole file, then run the "Execution workflow" at the bottom end-to-end. Todd is away; don't wait on him.**

## Context

Narratorr is a Sonarr/Radarr-for-audiobooks (Fastify + React monorepo): Audible metadata,
MAM sourcing, qBittorrent downloads, library scan/import. It deliberately has **no
multi-user request workflow** — that's this project. `narrator-request` is the Overseerr
equivalent: family/friends log in, browse/search audiobooks, request them; an admin
approves; approved requests are handed to Narratorr's existing search→download→import
pipeline; the requester gets notified when the book is available.

The epic that builds Narratorr's public API (**#1441 — Public API v1 "API Starter Pack"**)
explicitly names "an Overseerr-style request app later" as its second intended consumer
(after the `earwitness` validator). So this app is anticipated, not bolted on — but the
`/api/v1` surface it consumes is **mostly still backlog**. This project is therefore
**contract-first**: we define the `/api/v1` contract we need as vendored Zod schemas +
a local mock, build the full app against the mock, and the contract artifact drops into
Narratorr as the spec for the remaining epic stories.

**Decisions locked with the user this session:**
- **Audience:** full Overseerr — multi-user, request queue, admin approvals, quotas, notifications.
- **Auth (MVP):** Plex OIDC via `ghcr.io/blacktirion/plex-oidc-bridge` (mirrors the user's ABS setup).
- **Coupling:** standalone repo, HTTP-only client to Narratorr `/api/v1` + API key.
- **Repo topology:** **three separate repos**, NOT a monorepo. Decided on **pure code-sharing economics**
  (not API-boundary discipline): the one high-value shared asset — the `/api/v1` contract — must be
  **published anyway** for third-party consumers, so a monorepo's contract-sharing win is redundant; the
  remaining shared code (config/boot/helpers) is thin and app-divergent; and identical dependencies give
  **no** monorepo lift (each package declares its own deps regardless — you only gain one lockfile + hoisting).
  Share types/helpers via published `@narratorr/*` packages consumed at a pinned version — without coupling
  the mature 1.0 core's repo/CI/release to two 0.x experiments. My call; Codex independently reached the same conclusion (2026-06-13).
- **Sequencing:** contract-first, then build the app against a mock; file the gap endpoints as Narratorr stories.
  The local contract is a **temporary seed** that migrates to a published `@narratorr/api-contract` artifact (see Contract strategy).

Codename suggestion: **`earmark`** (to earmark = reserve/request; "ear" keeps the audio-family
pun alongside `earwitness`). Package name is trivial to change — using `narrator-request` is fine too.

## Stack (match Narratorr/earwitness exactly)

Fastify 5 + Zod (`fastify-type-provider-zod`) · Drizzle ORM + libSQL (`@libsql/client`, `dialect: 'turso'`)
· React 19 + React Router 7 + TanStack Query 5 + Tailwind 4 (`@tailwindcss/vite`) + sonner
· Vite 8 (client) / tsup (server) / tsx (dev) · Vitest · MSW (mocks) · pnpm · Node 24 · ESM.
TS 6 with `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax`
(copy `narratorr-earwitness/tsconfig.json`, incl. `@/`, `@core/`, `@shared/` path aliases).
**Guiding principle: mirror Narratorr's conventions where they fit** — typed Zod routes
(`fastify-type-provider-zod`), drizzle-kit migrations, Zod-validated env config, HMAC cookie sessions, the
error-handler plugin — and deviate only with cause. `croner` is already in Narratorr's stack. The **sole
net-new dependency** is **`openid-client`** for Plex OIDC, which Narratorr has no precedent for (its own auth
is forms/basic/api-key + LAN bypass).

## Key findings that shape the design (grounded in real code)

- **S7 (#1453, done) scoped the API key to `/api/v*` ONLY** and made SSE (`/api/events`) key-unreachable
  (needs a session-scoped stream token a server-to-server client can't mint). ⇒ This app **cannot
  subscribe to Narratorr's event stream**; it **polls** `/api/v1` reads for status. Webhook-via-notifier
  is a later optimization. (Earwitness's vendored contract still points at internal `/api/library/books`
  — soon-to-be-stale; we target `/api/v1/` from the start.)
- **S0 (#1442, done) locked the v1 conventions:** offset/limit pagination; list envelope `{ data, total }`
  (not a bare array); error envelope `{ error: { code, message } }`; ISO-8601 dates; camelCase filter/sort
  (`sortField`,`sortDirection`,`author`,`series`,`narrator`); request bodies use Zod `.strict()`;
  rate-limiting deliberately out of scope (single trusted consumer). The intended home is
  `src/shared/schemas/v1/common.ts` (not yet in the tree — issue text is the authoritative ADR).
- **S1 (#1443, PR #1456) adds opaque public IDs:** `bk_`/`au_`/`nr_`/`sr_`/`dl_`. Our contract uses these
  string IDs, never numeric rowids.
- **Canonical book lifecycle (S2a):** `wanted → searching → downloading → importing → imported | missing | failed`
  (`narratorr/src/shared/schemas/book.ts` `BOOK_STATUSES`). Download statuses in `activity.ts`. We project these into request status.
- **Acquire building blocks exist, but NOT an ASIN-only command** (corrected per Codex). `createBookBodySchema`
  has an *optional* `searchImmediately` (`book.ts:131`); create still requires `title` (`book.ts:112`), `asin`
  is optional (`book.ts:117`), and the immediate search fires only *after* full book creation (`books.ts:120`).
  ASIN dedupe is real — `findDuplicate` (`books.ts:103`) + service ASIN check (`book.service.ts:123`) — with the
  **unique ASIN index (`schema.ts:89`) as the durable idempotency backstop**. So `POST /api/v1/acquisitions`
  must be **built** (compose create + `searchImmediately` + `searchAndGrabForBook`), not merely *exposed*.
- **Precedent to mirror:** `narratorr-earwitness/src/shared/schemas/narratorr.ts` (vendored contract w/
  endpoint annotations + `PROPOSED` tags + source-file pointers) and `.../src/server/config.ts`
  (`NARRATORR_URL`+`NARRATORR_API_KEY` ⇒ `mode: 'standalone' | 'narratorr'`).

## The vendored `/api/v1` contract (the keystone artifact)

Lives at `src/shared/schemas/narratorr-v1.ts`, mirroring the earwitness convention (header comment,
per-endpoint annotation, source-file pointer, `PROPOSED` tag on what doesn't exist yet). Aligned to
S0 envelopes. This file is what we lift into Narratorr as the spec.

**Contract strategy (Codex-concurred 2026-06-13):** this local file is a **temporary seed**, not a permanent
hand-copy. Endgame — Narratorr owns the canonical `/api/v1` contract, generates OpenAPI (S9), and **publishes a
versioned `@narratorr/api-contract`** (Zod schemas + optional generated client); this app *and* earwitness then
**depend on a pinned version and run contract tests** instead of vendoring. The seed we author here is exactly
what lands in Narratorr to become that canonical source. Retire all hand-copied `narratorr*.ts` files once the
artifact exists, and fix earwitness's already-stale copy (`/api/library/books`) as part of that.

**Reads we consume (exist in epic backlog):**
| Endpoint | Returns | Epic story |
|---|---|---|
| `GET /api/v1/books?status&search&author&series&narrator&sortField&sortDirection&limit&offset` | `{ data: V1Book[], total }` | S3 #1449 |
| `GET /api/v1/books/:publicId` | `V1Book` | S3 #1449 |
| `GET /api/v1/downloads?limit&offset` (or `/activity`) | `{ data: V1Download[], total }` | S5 #1451 |

`V1Book = { id: 'bk_…', title, authors:[{name,asin?}], narrators:[{name}], coverUrl, asin, seriesName?,
seriesPosition?, status: BookStatus, createdAt }`. `V1Download = { id:'dl_…', bookId:'bk_…', clientStatus,
pipelineStage, progress, updatedAt }`. `V1Acquisition = { id:'aq_…', bookId:'bk_…'|null, asin,
status: BookStatus|'queued', progress?, updatedAt }`.

**Actions we consume (S6 is the admin path; the request-app path is NEW — file as stories):**
| Endpoint | Body / Query | Returns | Status |
|---|---|---|---|
| `GET /api/v1/metadata/search?q=` | — | `{ data: V1AudibleResult[] }` | **NEW story** — public Audible search (wraps `MetadataService.search`) |
| `POST /api/v1/acquisitions` | `{ asin }` (+ `Idempotency-Key`, idempotent on ASIN) | `{ id:'aq_…', bookId:'bk_…', status }` | **NEW story (recommended model)** — domain action, *auto-acquire* (server picks best release per quality profile), wraps internal add+`searchImmediately`+`searchAndGrabForBook` |
| `GET /api/v1/acquisitions/:id` | — | `V1Acquisition` (status projection over book+download+import) | **NEW story** — the single resource the request app polls for status (collapses books+downloads correlation) |
| `POST /api/v1/books/:publicId/search` + `/grab` | — | releases / grab result | S6 #1452 — **admin/interactive** release-picker path; the request app does NOT use this (no torrent-wrangling for end users) |

`V1AudibleResult = { asin, title, authors, narrators, coverUrl, duration?, publishedDate?, seriesName?,
seriesPosition?, language? }` (shape grounded in `discover.ts`'s suggestion row + metadata service).

A **`createNarratorrClient(config)`** module (`src/server/services/narratorr-client.ts`) wraps `fetch`
with the API key header, parses responses through these schemas, and surfaces typed errors. In
`standalone` mode it's backed by an **MSW handler set** (`src/server/mocks/narratorr-v1.ts`) returning
fixtures so the whole app runs with no Narratorr instance.

## Data this app owns (Drizzle schema — `src/db/schema.ts`)

- **`users`** — `id`(pk), `publicId`('us_…'), `plexId` unique, `plexUsername`, `email`, `thumb`,
  `role`('admin'|'user'), `requestQuota`(int, null=unlimited), `createdAt`.
- **`requests`** — `id`(pk), `publicId`('rq_…'), `userId`(fk), `asin`, snapshot `title`/`author`/`narrator`/`coverUrl`,
  `status`('pending'|'approved'|'denied'|'acquiring'|'available'|'failed'), `narratorrAcquisitionId`('aq_…' nullable), `narratorrBookId`('bk_…' nullable),
  `note`, `requestedAt`, `decidedAt`, `decidedBy`(fk nullable). Unique `(asin)` open-request guard to dedupe.
- **`app_settings`** — singleton: default quota, which roles auto-approve, notification config.

**Request lifecycle (our domain → Narratorr status):**
`pending` --admin approve--> `approved` --handoff `POST /api/v1/acquisitions`--> `acquiring`
--poller polls `GET /api/v1/acquisitions/:id`--> `available` (when acquisition `imported`).
`denied` / `failed` terminal. Quota enforced at request-create for non-auto-approve roles.

## Auth (Plex OIDC)

`src/server/plugins/auth.ts` + `src/server/services/auth.service.ts` using `openid-client` against the
bridge's discovery doc (`PLEX_OIDC_ISSUER`). Authorization-code flow → on callback, upsert `users` by
`plexId`, mint a signed session cookie (reuse Narratorr's HMAC cookie pattern). First user (or configured
Plex owner) becomes `admin`. **Standalone/dev:** `AUTH_BYPASS=1` seeds a dev admin so the app runs without
the bridge. (Confirm the bridge's discovery/claims shape against a running instance before wiring — design
against standard OIDC discovery.)

## Project structure

```
src/
  shared/schemas/         v1/common.ts (envelopes), narratorr-v1.ts (vendored contract), request.ts, user.ts
  server/
    index.ts              Fastify boot (earwitness-shaped: zod provider, cors, cookie, auth, routes)
    config.ts             Zod env → { mode, narratorr, plexOidc, port, ... }
    plugins/              auth.ts, error-handler.ts (v1 envelope)
    services/             narratorr-client.ts, request.service.ts, user.service.ts, status-poller.ts
    routes/               auth.ts, requests.ts, search.ts (proxy), admin.ts, health.ts
    mocks/                narratorr-v1.ts (MSW handlers + fixtures)
  client/                 React: SearchPage, BookCard, RequestButton, MyRequestsPage, AdminQueuePage, Login
  db/                     schema.ts, client.ts (libSQL+drizzle), migrate.ts
drizzle/                  generated migrations
```

## Build phases

1. **Scaffold** — package.json, tsconfig (copy earwitness), vite.config, tailwind, eslint, drizzle.config,
   `.env.example`, `.gitignore`, `git init`, dir tree.
2. **Contract** — `v1/common.ts` envelopes + `narratorr-v1.ts` vendored contract (keystone).
3. **Config + DB + identity boundary** — `config.ts`; `schema.ts` (users/requests/settings) + migration;
   `AUTH_BYPASS` dev admin **and the authenticated user-context shape up front** (Codex risk #1 — request
   creation must be built on the real user boundary, not retrofitted).
4. **Narratorr client + mock** — `narratorr-client.ts` typed over the contract; `mocks/narratorr-v1.ts` fixtures; standalone mode works end-to-end.
5. **Server routes** — search proxy (+ per-user search throttle/cache, Codex risk #4); create/list requests
   (+rolling-30d quota); approve/deny + acquisition handoff with idempotency & retry semantics; v1 error envelope.
6. **Plex OIDC (after spike)** — wire `openid-client` behind the claim adapter + membership allowlist (decision #2).
7. **Client** — search/browse → request → my-requests → admin approval queue (TanStack Query + Tailwind + sonner).
8. **Status poller** — croner job, batched w/ jitter+backoff, reconciling `acquiring → available` via `GET /api/v1/acquisitions/:id`.

**"Today" target:** phases 1–5 (runnable spine: search a mocked Audible → request → it persists → shows in
queue) and begin 6. Plex OIDC polish, notifications, and webhook-push are fast-follows.

## Narratorr-side contributions this spawns (separate repo, file as issues)

- **NEW story** — `GET /api/v1/metadata/search` (public Audible search). The request app's front door; not in S3–S5.
- **NEW story** — `POST /api/v1/acquisitions { asin }` (idempotent request→acquire). Wraps existing add+`searchImmediately`.
- **Bump priority** of S3 (#1449 book reads), S5 (#1451 downloads/activity), S6 (#1452 search+grab) — this app is the consumer that justifies them (S6 is currently `priority/low, stretch`).
- The vendored `narrator-request/src/shared/schemas/narratorr-v1.ts` is the lift-and-shift spec for `narratorr/src/shared/schemas/v1/`.
- **Anti-drift (Codex risk #2):** each proposed endpoint's Narratorr issue must pin **exact schemas, status
  codes, and failure modes** before we rely on the mock — otherwise the vendored contract becomes fiction.
- **Publish a canonical contract artifact (repo-topology decision, Codex-concurred):** Narratorr owns the v1
  contract, ships OpenAPI (S9), and publishes **`@narratorr/api-contract`** (+ optional generated client); both
  sidecars consume the **pinned package + contract tests**, replacing hand-vendored copies. Repos stay separate;
  the contract is the seam, proven over HTTP. Fix earwitness's stale `/api/library/books` copy under this.

## Decisions (Codex-reviewed 2026-06-13 — verdict: ship with changes)

1. **Acquire handoff — APPROVED, as a sanctioned revision of the locked "search-then-grab, NOT entity-POST"
   decision** (violates the letter, not the spirit: a request app needs "acquire this ASIN," not release-picking
   or entity CRUD). `POST /api/v1/acquisitions { asin }` is a **command** returning an **acquisition projection**;
   `GET /api/v1/acquisitions/:id` projects book+download+import into one lifecycle. Implement as a projection
   over existing state — **not a new CRUD table unless audit requires one.** **Idempotency:** ASIN-backed AND
   `Idempotency-Key` replay; same ASIN returns the existing acquisition/book; races rely on the **unique ASIN
   index (`schema.ts:89`)**, not just preflight `findDuplicate`. Release ranking stays server-side in
   `searchAndGrabForBook`. S6 search→grab stays the admin path.
2. **Plex OIDC — SPIKE before wiring auth.** Do not assume the bridge's claims. Put claim-mapping behind an
   **adapter**, require explicit **server-membership/allowlist** enforcement, and do **not** bake Plex
   email/server-membership into the user schema blindly (may be missing or bridge-specific).
3. **Status delivery — POLL for MVP.** Poll *open* acquisitions in **batches with jitter/backoff** (not
   per-request tight loops). Webhook is a later optimization (SSE is key-unreachable per S7).
4. **Threat split — abuse controls here, correctness controls in Narratorr.** User-facing abuse (quotas,
   request spam, auth) lives in this app. Narratorr still needs hard correctness: scoped API key, `.strict()`
   schemas, ASIN dedupe, acquisition concurrency bounds, safe retry. "No rate-limit in Narratorr" is
   acceptable **only because** acquisition is idempotent + bounded.
5. **Quota / auto-approve — defined now.** **Rolling 30-day** quota; count `pending`/`approved`/`acquiring`/
   `available` requests created in-window; **don't** count `denied`; **refund** `failed` unless user-caused.
   **Auto-approve admins only** for MVP; add a "trusted" role later when there's real need.

### Acquisition retry semantics (Codex risk #3 — pin in the contract)
Explicit behavior when a requested ASIN is already `imported` / `failed` / `missing`: re-request of an
`imported` book → "already available"; `failed`/`missing` → allow bounded re-acquire and surface state to the
requester. Without this, users hammer "request" and admins see contradictory state.

## Verification

- `pnpm install && pnpm typecheck && pnpm lint && pnpm build` clean.
- `pnpm test` — unit tests for: v1 contract schemas (envelope/pagination accept/reject), request lifecycle
  transitions + quota enforcement, narratorr-client parsing (incl. error envelope), status-poller reconciliation.
- `pnpm dev` in **standalone mode** (no Narratorr): MSW serves Audible search → click Request → row appears
  in My Requests as `pending` → admin approves → poller drives mock acquisition to `available`. Drive the
  browser via chrome-devtools MCP to confirm the spine end-to-end.
- Flip to **narratorr mode** (`NARRATORR_URL`+`NARRATORR_API_KEY`) once the real `/api/v1` reads land; the
  same client code hits live endpoints. (Auth: smoke the Plex OIDC flow against a running bridge separately.)

## Execution workflow (autonomous — Todd is away; run end-to-end after he kicks off)

The agreed cold-start process. Read this entire file + the project memory first, then execute without waiting on Todd.

1. **Implement the whole MVP** — phases 1–8, in order, against standalone/mock mode. Pre-authorized:
   `git init` + first commit, pnpm install, create all files, `pnpm dev/build/typecheck/lint/test`, drizzle
   migrations. Commit in logical chunks on a feature branch (repo starts with no git); **do not push** unless asked.
   - **Plex OIDC (decision #2):** structure phase 6 behind the claim adapter + `AUTH_BYPASS` dev admin so every
     flow is testable without the bridge. **Do NOT claim the live Plex flow is verified** — the bridge spike
     needs Todd's running infra. Same for narratorr mode (needs live `/api/v1` + key). Verify in **standalone mode**.
2. **Verify** (see Verification): `pnpm verify` clean, then drive the standalone app via **chrome-devtools MCP**
   to confirm the spine end-to-end (search → request → approve → poller drives mock acquisition to `available`).
3. **Full review** — run **`/review:code`** over the **complete diff** with **all 12 reviewer personas** and
   **both the Claude and Codex engines**. *Todd explicitly pre-authorized this multi-agent + cross-model review*,
   so the Workflow opt-in is satisfied. It produces a prioritized REVIEW.md.
4. **Apply every change that genuinely makes the code/implementation/architecture better — including nits.**
   Skip a finding only if it's wrong or actively worse; otherwise fix it. Re-run `pnpm verify` after.
5. Leave a concise summary: what was built, what's deferred (Plex live-spike, narratorr-mode wiring), open decisions.

**Cold-start pointers (re-open these — a fresh session won't have them in context):**
- Narratorr core (read-only reference), `C:/Users/Todd/Code/narratorr`: `src/shared/schemas/{book,activity,metadata}.ts`,
  `src/server/routes/{books,search,metadata,discover}.ts`, `src/server/plugins/auth.ts`, `src/db/client.ts`, `drizzle.config.ts`.
- Earwitness sidecar precedent to copy patterns from, `C:/Users/Todd/Code/narratorr-earwitness`: `tsconfig.json`,
  `vite.config.ts`, `src/server/{index,config}.ts`, `src/shared/schemas/narratorr.ts` (vendored-contract convention).
- Codex CLI is available for independent checks: `codex exec -s read-only --skip-git-repo-check -C <dir> -o <outfile> -` (prompt on stdin).

**Goal:** a kick-ass, reviewed, self-consistent MVP Todd can run in standalone mode immediately and wire to live narratorr + Plex when he's back.
