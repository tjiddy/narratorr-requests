# REVIEW.md — narrator-request MVP (build/mvp branch)

**Scope:** entire `build/mvp` branch (the full MVP, all 8 phases).
**Engines:** cross-model. **Codex CLI: all 12 deep-pack perspectives completed.**
The **Claude-engine** Workflow could not complete — run 1 hit a server-side rate
limit (12-wide burst), run 2 thrashed on `StructuredOutput` schema-retries on the
first batch — so the cross-model review proceeded on the **12 Codex perspectives**
(security, architect, chief-architect, ops, chief-programmer, devils-advocate,
testability, simplifier, user-advocate, api-designer, critic, requirements-analyst).
Raw per-perspective reviews are in `.reviews/REVIEW-codex-*.md`.

Findings are deduplicated, priority-normalized, and tagged **APPLIED** (fixed in
this pass) or **DEFERRED** (with rationale). Consensus = how many of the 12
perspectives independently raised it.

---

## Summary

No P0s. The architecture is sound (every reviewer praised the contract-first
boundary, the `Idempotency-Key = request.publicId` command pattern, the partial
unique index, and server-side auth on every route). The substantive findings
cluster in three areas: **concurrency correctness** (TOCTOU races), **deploy/security
posture** (insecure dev defaults, missing prod headers), and **config/UX paper-cuts**
(the dev-port split-brain I introduced during verification was the single
most-flagged issue). Most are fixed in this pass; two genuine-but-low-severity
races are deferred with rationale.

---

## P1 — Significant

### 1. Admin decisions are not atomic (check-then-update) — APPLIED
**Consensus 4/12** (architect, chief-architect, chief-programmer, testability)
`decide()` read the row, checked `status !== 'pending'`, then `UPDATE … WHERE id = ?`.
Two admins (or a double-submit) could both pass the check; one could deny while the
other approves and hands off to Narratorr.
**Fix applied:** the transition is now a conditional `UPDATE … WHERE id = ? AND
status = 'pending' RETURNING *`; zero rows → reload and throw `NOT_PENDING`. Handoff
is tied only to the row the winning update returned. (`request.service.ts`)

### 2. Approved requests can strand if the process dies mid-handoff — APPLIED
**Consensus 1/12** (critic)
Handoff ran inline after approval; a crash between `status='approved'` and the
acquisition call left a request stuck `approved` with no acquisition and nothing to
retry it.
**Fix applied:** the status poller now also picks up `approved` requests with no
`narratorrAcquisitionId` and (re)runs the idempotent handoff — self-healing on the
next tick. (`request.service.ts` `findApprovedAwaitingHandoff`, `status-poller.ts`)

### 3. First-user-admin election is race-prone / open in prod — APPLIED
**Consensus 5/12** (security, architect, chief-architect, chief-programmer, devils-advocate)
Two first OIDC logins could both observe `count()===0` and both become admin; with
an empty allowlist, any Plex account could sign in and the first became admin.
**Fix applied:** (a) in production Plex mode, boot now **fails** unless
`PLEX_ALLOWLIST` or `PLEX_OWNER_USERNAME` is set; (b) admin is granted on
`PLEX_OWNER_USERNAME` match, and the implicit first-user-admin fallback now applies
**only when no owner is configured** (dev/standalone). The residual dev-only race is
benign. (`config.ts`, `user.service.ts`) The deeper transactional bootstrap claim is
noted as a follow-up.

### 4. Insecure dev-bypass defaults could expose an admin surface — APPLIED
**Consensus 1/12** (security, P1)
`.env.example` shipped `BIND_HOST=0.0.0.0` + `AUTH_BYPASS=1`; the only guard was
`NODE_ENV==='production'`. Copying it onto a LAN exposed an unauthenticated admin.
**Fix applied:** `.env.example` now defaults `BIND_HOST=127.0.0.1` with a loud
warning on `AUTH_BYPASS`; `config.ts` throws if bypass is on while bound to a
non-loopback host unless `ALLOW_INSECURE_AUTH_BYPASS=1` is explicitly set.

### 5. Request creation trusted user-supplied catalog metadata — PARTIALLY APPLIED
**Consensus 1/12** (security, P1)
The authenticated user supplies `title`/`author`/`coverUrl`; a crafted request could
mislead an admin, and an arbitrary `coverUrl` made the admin browser fetch
attacker-chosen URLs.
**Fix applied:** `coverUrl` is now validated as an `https://` URL (blocks
`javascript:`/`data:`/internal-`http:`). **Deferred:** full server-side hydration of
title/author/cover from a trusted "metadata by ASIN" lookup — the vendored contract
only has search-by-query today, so this is filed as a contract addition. Title/author
remain a display snapshot the admin can cross-check.

### 6. Dev-port config split-brain — APPLIED
**Consensus 8/12** (the single most-flagged issue; introduced during verification)
The server reads `PORT`, but `vite.config.ts` proxied to `SERVER_PORT` and the client
used `CLIENT_PORT`, while `.env.example` documented only `PORT` — so the documented
knob moved the server but not the proxy.
**Fix applied:** the Vite proxy now derives its target from `PORT` (the documented
server var), with `SERVER_PORT` only as an explicit override; `CLIENT_PORT` documented
in `.env.example`. One concept, one variable. (`vite.config.ts`, `.env.example`)

### 7. Production SPA deep links could load broken asset URLs — APPLIED
**Consensus 4/12** (critic, devils-advocate, requirements-analyst, user-advocate)
`vite.config.ts` used `base: './'`; served as the SPA fallback at a nested path the
relative asset URLs could resolve wrong.
**Fix applied:** `base: '/'` so built asset URLs are absolute and resolve from any
deep link. (`vite.config.ts`)

### 8. Partial Narratorr config silently falls back to standalone — APPLIED
**Consensus 1/12** (api-designer, P1)
Setting only one of `NARRATORR_URL`/`NARRATORR_API_KEY` silently ran standalone.
**Fix applied:** boot throws if exactly one of the pair is set. (`config.ts`)

### 9. Poller can starve later acquisitions / unbounded read — APPLIED (mitigated)
**Consensus 4/12** (architect, chief-architect, ops, devils-advocate)
`findAcquiring()` loaded all rows unordered and `.slice(0,25)` always took the same
leading rows.
**Fix applied:** ordering pushed into SQL (`ORDER BY requested_at` + `LIMIT` in the
query). **Deferred:** a `nextPollAt` cursor for strict fairness beyond 25 concurrent
in-flight acquisitions (not a homelab-scale concern). (`request.service.ts`)

### 10. Quota admission is raceable (check-then-insert) — DEFERRED (documented)
**Consensus 5/12** (architect, chief-architect, chief-programmer, devils-advocate, testability)
Two concurrent creates for *different* ASINs can both read the same remaining quota
and both insert, slightly exceeding the rolling limit.
**Why deferred:** a correct fix needs serialized per-user admission (a quota
ledger or a write-locked transaction); under libSQL's single-writer/deferred-txn
semantics a naive `db.transaction()` wrapper would *not* actually close the race, so
shipping one would be false assurance — "actively worse." For the real threat model
(a handful of trusted family users; the partial unique index already stops same-book
spam) the worst case is a user briefly over quota by a few. Filed as a follow-up
(quota ledger / admission row). The **same-book** dedupe race *is* closed durably by
the partial unique index + the post-insert catch.

### 11. Shallow health check / no readiness — APPLIED (light)
**Consensus 1/12** (ops, P1)
`/api/health` always returned `ok` without touching the DB.
**Fix applied:** `/api/health` now runs a `SELECT 1` readiness probe and reports
`db: 'ok'|'down'` alongside mode/authMode (503 if the DB is unreachable). Richer
poller-health reporting is noted as a follow-up. (`health.ts`, `index.ts`)

---

## P2 — Recommended

### 12. Quota env parsing accepts malformed/negative values — APPLIED
**Consensus 7/12** (architect, chief-architect, chief-programmer, ops, critic, simplifier, testability)
`DEFAULT_REQUEST_QUOTA` used `parseInt`, so `10abc`→10 and negatives passed, against
the file's own strict-parse posture.
**Fix applied:** parsed/validated via Zod (`int >= 0`; blank/`0` → unlimited). (`config.ts`)

### 13. Missing production security headers — APPLIED
**Consensus 1/12** (security, P2)
**Fix applied:** `@fastify/helmet` registered in production (CSP with
`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, sane `img-src`/
`Referrer-Policy`). (`index.ts`, `package.json`)

### 14. `mine` query param accepted but ignored — APPLIED
**Consensus 3/12** (api-designer, chief-programmer, simplifier) — removed from
`requestListQuerySchema`. (`request.ts`)

### 15. `isoDateString` did not validate ISO-8601 — APPLIED
**Consensus 1/12** (api-designer) — tightened to a datetime check (we only ever emit
`toISOString()`, so no valid payload is rejected). (`v1/common.ts`)

### 16. Route IDs not validated as public IDs — APPLIED
**Consensus 1/12** (api-designer) — request route params now validate the `rq_`
prefix via `prefixedId`. (`requests.ts`, `admin.ts`)

### 17. Non-JSON error responses bypass `ApiError` (client) — APPLIED
**Consensus 1/12** (api-designer, P3) — client `parse()` now guards `JSON.parse` and
surfaces a clean `ApiError` on non-JSON bodies. (`client/api.ts`)

### 18. Settings read once at boot — DEFERRED (documented)
**Consensus 2/12** (ops, simplifier) — `app_settings` is seeded into the
`RequestService` policy at boot; runtime changes need a restart. Documented with a
comment; a settings-edit route + call-time resolution is a fast-follow (no edit route
exists yet).

### 19. No prod migration/rollback procedure — DEFERRED (documented)
**Consensus 1/12** (ops) — migrate-on-boot is fine for a single-instance homelab MVP;
a README note on backup-before-migrate + rollback is added. Decoupling migrations into
a release step is a deployment-policy decision for when this is containerized.

### 20. Prod build still emits the MSW/GraphQL chunk — ACCEPTED
**Consensus 1/12** (testability) — already split into a lazy chunk that is **never
imported** outside standalone mode (verified: main server bundle is 53 KB). The
unused file on disk is harmless; fully excluding it needs a build-time flag. Accepted.

### 21. Search status badges only reflect the first 50 requests — ACCEPTED
**Consensus 2/12** (simplifier, user-advocate) — the discover page maps
already-requested ASINs from the (50-row) My Requests list. Fine below 50 personal
requests; a dedicated "my request states" lookup is a fast-follow.

---

## P3 — Notes (not actioned)
- Mock book route also accepts acquisition IDs (test-only convenience) — api-designer.
- Various wording/UX polish (empty-states, quota surfacing in the header) — user-advocate.

---

## Positive observations (consensus)
- **Contract-first boundary** is the right call: every upstream response is parsed
  through the vendored Zod contract, so drift becomes a typed 502 rather than a silent
  bad shape (security, architect, chief-architect, chief-programmer).
- **`Idempotency-Key = request.publicId`** is the proven Stripe-style retry-safe
  command pattern; **jitter + exponential backoff** in the poller matches AWS/Google
  SRE guidance (chief-architect, chief-programmer).
- **Auth is enforced server-side** on every sensitive route (`requireUser`/
  `requireAdmin`); the React admin route is not trusted as the boundary. Sessions are
  HMAC-signed, `httpOnly`, expiry-checked, roles refreshed from the DB per request;
  OIDC uses state + nonce + PKCE (security).
- **Strict Zod bodies + Drizzle parameterization** — no injection surface; the
  partial unique index is exactly the durable invariant this app needs (security, architect).
- Service boundaries are a clean modular monolith, not premature microservices (chief-architect).
