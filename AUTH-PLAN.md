# Auth Onboarding — Implementation Plan (v0.8.0)

> Goal: make narrator-request publicly distributable as a **pluggable narratorr request
> sidecar**. Decouple authentication (pluggable: local / OIDC) from authorization
> (internal approval queue). Kill the Plex-coupling and the empty-allowlist open door.

## Locked decisions (from Todd, do not relitigate)
- **Uniqueness = (authProvider, authSubject).** No account linking, ever. Same email via two
  providers = two separate accounts. Never auto-link by email (takeover vector).
- **Authorization = approval queue.** New user authenticates but lands `pending`; an admin
  approves in the Users page. **First user in any method → admin + active.** Replaces the
  `PLEX_ALLOWLIST` open door.
- **Two methods, both 1.0:** local username/password (independently toggleable) + generic OIDC
  (N providers). Plex (via bridge) and Authelia become OIDC provider *instances*, not special cases.
- **OIDC config stays in ENV** (bootstrap chicken-and-egg). Approvals managed in the UI.
- **Login screen is server-driven:** `GET /api/auth/providers` → `{ local, providers:[{id,label}] }`.

---

## A. Data model — `src/db/schema.ts` (users table)

Replace the column-per-provider identity with a generic one:

| Drop | Add | Keep / rename |
|------|-----|----------------|
| `plexId` (unique) | `authProvider text NOT NULL` | rename `plexUsername` → `username` (display) |
| `autheliaSubject` (unique) | `authSubject text NOT NULL` | `email`, `thumb`, `role`, `requestQuota`, `autoApprove`, `createdAt`, `publicId` |
| | `passwordHash text` (null unless local) | |
| | `status text NOT NULL DEFAULT 'pending'` | |

- New unique index on `(authProvider, authSubject)`.
- Rename index `idx_users_plex_username` → `idx_users_username`.
- `status` enum `['pending','active','rejected']` (new `USER_STATUSES` in `shared/schemas/user.ts`).
  - `pending`: authenticated, can't search/request, sees a "waiting for approval" screen.
  - `active`: normal.
  - `rejected`: durable denial — admin's decision sticks across re-logins (don't just delete the
    row, or an OIDC user loops back to `pending` on next login).
- `role` (`admin|user`) stays **orthogonal** to `status`. Admin ⇒ always treated active.

### Migration `0003_*.sql` (HIGHEST RISK ITEM)
Generate via `drizzle-kit generate` after editing schema, then **hand-edit the `INSERT … SELECT`**
in the SQLite table-rebuild to backfill instead of dropping data:
- `authProvider` = `CASE WHEN plex_id IS NOT NULL THEN 'plex' WHEN authelia_subject IS NOT NULL THEN 'authelia' ELSE 'local' END`
- `authSubject` = `COALESCE(plex_id, authelia_subject, public_id)`
- `username` = `plex_username`
- `status` = `'active'` (grandfather every existing user — they were already in)
- `password_hash` = NULL
Must be safe on an **empty** DB (fresh install) too. Validate against a *copy* of the live leia
DB before deploy (container-access scripts) — flag in PR notes.

---

## B. Config — `src/server/config.ts`

**Remove:** `PLEX_OIDC_*`, `AUTHELIA_OIDC_*`, `PLEX_ALLOWLIST`, `PLEX_OWNER_USERNAME`,
`AUTHELIA_ADMIN_SUBJECT`, the `plexOidc`/`autheliaOidc` config blocks.

**Add:**
- `LOCAL_AUTH` (bool, **default true** so a fresh container always has a way in; set `false` for
  pure-OIDC). New `boolFromStringDefault(true)` helper.
- `OIDC_PROVIDERS` = csv of provider ids (e.g. `plex,authelia,google`). For each `<ID>`:
  - `OIDC_<ID>_ISSUER` (req), `OIDC_<ID>_CLIENT_ID` (req), `OIDC_<ID>_REDIRECT_URI` (req)
  - `OIDC_<ID>_CLIENT_SECRET` (opt — public PKCE clients omit it)
  - `OIDC_<ID>_LABEL` (opt, default = id capitalized), `OIDC_<ID>_SCOPE` (opt, default `openid profile email`)
  - `OIDC_<ID>_USERNAME_CLAIM` / `_EMAIL_CLAIM` / `_SUBJECT_CLAIM` (opt; sensible default chains)
  - Build `oidcProviders: OidcProviderConfig[]`; fail-fast per provider listing missing keys.
- **Boot guard:** if `authMode==='standard'` and `!localAuth` and `oidcProviders.length===0`
  → throw "no auth method configured; enable LOCAL_AUTH or configure an OIDC provider."
- Keep `AUTH_BYPASS` (dev only, prod-refused), `SESSION_SECRET`, `SETTINGS_KEY`, bypass-bind guards.
- `authMode: 'bypass' | 'standard'` (was `'bypass' | 'plex'`).

Redirect-URI convention (documented): `OIDC_<ID>_REDIRECT_URI` must point at
`<publicUrl>/api/auth/oidc/<id>/callback`.

---

## C. OIDC service — `src/server/services/oidc.service.ts`

`OidcService<P>` (generic flow: discovery, PKCE, state/nonce, exchange) **unchanged**.

**Collapse** `mapPlexClaims` / `mapAutheliaClaims` / `plexAllowlistGate` / `autheliaAdminGate` into
**one** generic mapper:
```ts
export interface OidcProfile { subject: string; username: string; email: string | null; thumb: string | null; }
export function makeOidcMapper(opts?: { usernameClaim?; emailClaim?; subjectClaim? }):
  (claims, userinfo) => OidcProfile
```
- subject = `claims[subjectClaim ?? 'sub'] ?? ui.sub`
- username = configured claim, else fallback chain `preferred_username → username → name → ui.* → subject`
- email/thumb = configured/standard claims, best-effort.
- The `validate`/gate hook stays in the class (defaults no-op) but **no gates are wired** — the
  approval queue replaces allowlists. Plex's `plex_id` special key is covered by the fallback
  chain / `SUBJECT_CLAIM` override.

---

## D. User service — `src/server/services/user.service.ts`

- Remove `PlexProfile`, `upsertByPlex`, `upsertAutheliaAdmin`.
- `upsertFromOidc(provider: string, profile: OidcProfile): UserRow` — find by `(authProvider, authSubject)`;
  if found refresh `username/email/thumb` (never downgrade role/status); else create via **first-user rule**
  (`count()===0` → `admin` + `active`, else `user` + `pending`).
- `createLocalUser({ username, passwordHash }): UserRow` — `authProvider='local'`,
  `authSubject=username.toLowerCase()`, display `username` (original case), first-user rule. Unique
  `(local, subject)` blocks duplicate usernames.
- `findLocalByUsername(username): UserRow | undefined` — by `(authProvider='local', authSubject=lower)`.
- `ensureDevAdmin()` — `authProvider='local'`, `authSubject='dev-admin'`, `status='active'`, `role='admin'`.
- `toAuthUser`/`toDto`: `username` (renamed), **add `status`**.
- `updateUser` patch gains `status` (approve/reject). Keep role self-guard; add: admin can't
  reject/demote **themselves** out of active.

---

## E. Auth plumbing

- `src/server/types.ts` `AuthUser`: rename `plexUsername`→`username`, add `status: UserStatus`.
- `src/server/plugins/auth.ts`:
  - `toAuthUser` already DB-loaded per request → carries `status`.
  - Add `requireActiveUser(request)`: `requireUser`; if `role!=='admin' && status!=='active'` →
    `forbidden('ACCOUNT_PENDING' | 'ACCOUNT_REJECTED', …)`. Returns the user.
- New `src/server/util/password.ts`: scrypt hash/verify (no new dep). Format
  `scrypt$N$r$p$saltB64$hashB64`, `timingSafeEqual`. Login does a dummy verify when the user is
  missing (constant-time, anti-enumeration).

---

## F. Routes — `src/server/routes/auth.ts` (rewrite)

- `GET /api/auth/providers` **(public)** → `{ local: boolean, providers: [{id,label}] }`.
- Local (only when enabled):
  - `POST /api/auth/local/signup` `{username,password}` — validate (username `^[a-zA-Z0-9_.-]{3,32}$`,
    password ≥ 8), reject if taken, `createLocalUser`, set session, return me-shaped `{status,role,…}`.
  - `POST /api/auth/local/login` `{username,password}` — find + verify, set session.
  - Both **rate-limited** (see H).
- OIDC generic:
  - `GET /api/auth/oidc/:provider/login` → lookup in `deps.oidc`, `buildAuthUrl`, redirect (404 if unknown).
  - `GET /api/auth/oidc/:provider/callback` → reconstruct callback from **configured** redirectUri +
    incoming query (not Host header), `handleCallback`, `upsertFromOidc(provider, profile)`, set session, redirect.
- `POST /api/auth/logout` unchanged.
- Delete old `/api/auth/login`, `/api/auth/callback`, `/api/auth/authelia/*`.

**Apply the gate:** `requests.ts` `POST /api/requests` and `search.ts` `GET /api/search` →
`requireActiveUser`. Leave `GET /api/me` ungated (client needs it to discover `status`). Admin
routes already `requireAdmin`.

---

## G. Deps & wiring — `deps.ts`, `index.ts`

- `deps.ts`: replace `plexOidc`/`autheliaOidc` with `oidc: Map<string, OidcService<OidcProfile>>`;
  add `localAuth: boolean`.
- `index.ts`: build the `oidc` map from `config.oidcProviders`; register `@fastify/rate-limit`;
  `ensureDevAdmin` in bypass (already).

---

## H. Rate limiting
Add `@fastify/rate-limit` (in-memory, single-instance MVP). Register globally with a permissive
default, **tight override on the two local-auth routes** (e.g. 5/min/IP on login, 3/min/IP on
signup). One small, battle-tested dep — hand-rolling a login limiter is a security footgun.

---

## I. Client

- `api.ts`: `getAuthProviders()`, `localSignup()`, `localLogin()`. `plexUsername`→`username` in DTO usage.
- `hooks.ts`: `useAuthProviders`, `useLocalSignup/Login`; toast uses `user.username`.
- `LoginPage.tsx`: fetch `/api/auth/providers`; render the password form (login/signup toggle) when
  `local`, plus one button per OIDC provider (`/api/auth/oidc/<id>/login`). No hardcoded buttons.
- `App.tsx`: `status==='pending'` → `<PendingPage/>`; `status==='rejected'` → `<RejectedPage/>`
  (admins always active → normal app).
- `UsersPage`/`UserDetailPage`: `username` rename; pending users surfaced with **Approve / Reject**;
  status badge. `Layout.tsx`: `me.username`.

## J. Shared schemas
- `user.ts`: `USER_STATUSES`; `userDtoSchema`/`meDtoSchema` rename `plexUsername`→`username`, add
  `status`; `updateUserBodySchema` add `status`.
- `request.ts`: `requester.plexUsername`→`requester.username` (DTO contract, pre-1.0 — clean it).

## K. Tests
- `test-support/db.ts` `insertUser`: params `provider/subject/username/status`.
- Update: `oidc.service.test` (generic mapper), `user.service.test` (upsert + local + status),
  `request.service.test` (`requester.username`), `settings.route.test` (`AuthUser` status+username),
  notification tests (`requester.username`).
- New: `password.test.ts`; `auth.route.test.ts` (providers shape, signup→pending, first-user→admin+active,
  login verify, duplicate-username reject, gate: pending user POST /requests → 403).

## L. Docs
- `README.md` + `.env.example` / `.env.docker.example`: new `OIDC_*` + `LOCAL_AUTH` scheme; copy-paste
  presets for **plex (bridge), authelia, google, authentik, keycloak**; redirect-URI note; remove the
  old Plex/allowlist env. Note the breaking redirect-URI path change for existing Plex/Authelia.

---

## Scope split
**1.0 (this PR):** everything above.
**1.1 (deferred, documented, NOT built):** self-service password reset via SMTP connector; email
verification on local signup; shared OIDC pending-state store (multi-instance). **Account linking is
permanently off the table** (Todd).

---

## Adaptations from codex review (LOCKED — these override the above where they conflict)

Codex reviewed this plan; I agree with all findings. Changes folded in:

1. **First-user-admin race [BLOCKER].** Wrap the `count()` + insert in a `db.transaction()` so
   concurrent first signups serialize (SQLite single-writer makes this airtight). Applies to both
   `upsertFromOidc` create-path and `createLocalUser`.
2. **Migration field preservation [BLOCKER].** The `0003` `INSERT … SELECT` carries the **full**
   column map: `id, public_id, email, thumb, role, request_quota, auto_approve, created_at` +
   the new `auth_provider/auth_subject/username/status` (+ `password_hash` NULL). Preserving `id`
   keeps the `requests.user_id` FK valid through the rebuild.
3. **FK-safe rebuild [BLOCKER].** Follow the standard SQLite 12-step (the form drizzle-kit emits):
   create `__new_users`, `INSERT … SELECT` backfill, `DROP TABLE users`, `ALTER … RENAME`, recreate
   indexes. The drizzle libsql migrator disables FK enforcement around the migration. Add a
   migration test that runs `0000→0003` against a DB seeded (post-`0002` shape) with plex + authelia
   rows and asserts the mapping + that request rows still join.
4. **Drizzle metadata [BLOCKER].** Generate `0003` with `drizzle-kit generate` (writes `_journal.json`
   + `0003_snapshot.json`), then hand-edit **only the `INSERT … SELECT` data mapping** in the `.sql`.
   Snapshots describe schema, not data, so they stay valid — verify they match the final schema.
5. **OIDC provider-id validation [BLOCKER].** Provider ids must match `^[a-z0-9_-]{1,32}$` (reject
   `../`, `/`, etc.). Route param `:provider` is looked up in the map (404 if absent — never used to
   build paths). Env lookup maps the lowercase id → `OIDC_<UPPER>_*`.
6. **Bootstrap-admin hardening [SHOULD-FIX].** Add optional `BOOTSTRAP_ADMIN=<provider>:<subjectOrUsername>`.
   When set, ONLY that identity is granted admin on creation and first-user-auto-admin is **disabled**
   (closes "first public OIDC login owns the app" for open IdPs like any-Plex/any-Google). When unset,
   fall back to first-user-admin (fine for local-auth bootstrap / single-user IdP). Generalizes the old
   `PLEX_OWNER_USERNAME`.
7. **Rate-limit keying + proxy [SHOULD-FIX].** Add `TRUST_PROXY` env (default off; `true`/CIDR behind a
   reverse proxy) → Fastify `trustProxy`. Rate-limit local login by `IP + normalized username`, signup by
   `IP + username`; skip entirely in `AUTH_BYPASS`.
8. **Route policy, explicit [SHOULD-FIX].** `requireActiveUser` gates ALL user-facing data routes:
   `POST /api/requests`, `GET /api/requests`, `GET /api/requests/:id`, `GET /api/search`. Open to any
   authenticated user: `GET /api/me`, `POST /api/auth/logout`. Admin routes: `requireAdmin` (admins are
   always active). Rejected/pending users can read nothing but their own `me`.
9. **Error helpers [SHOULD-FIX].** `forbidden()` hardcodes `code='FORBIDDEN'`; add
   `accountPending()` / `accountRejected()` (403, codes `ACCOUNT_PENDING`/`ACCOUNT_REJECTED`) in
   `util/errors.ts`. (Client branches on `/api/me` status, but typed codes keep the API honest.)
10. **Local-row integrity [SHOULD-FIX].** `createLocalUser` always writes a hash; `findLocalByUsername`
    + login reject rows with a null `passwordHash` (can't auth an OIDC user through the local path).
11. **Username canonicalization [SHOULD-FIX].** trim → validate `^[a-zA-Z0-9_.-]{3,32}$` → `authSubject =
    toLowerCase()` (ASCII-restricted, so stable); display `username` = trimmed original. Reject names that
    normalize to empty.
12. **OIDC subject type [SHOULD-FIX].** Subject must be a non-empty string (existing `str()` helper);
    configured-claim path also goes through `str()`, else throw `OIDC_CLAIMS`.
13. **Rejected profile refresh [CONSIDER].** On OIDC re-login, refresh `username/email/thumb` only for
    `pending|active` rows; leave `rejected` rows' metadata frozen.
14. **Docs [CONSIDER].** Note in-memory OIDC pending-state + in-memory rate-limit ⇒ single-instance
    (multi-replica needs sticky sessions / shared store, deferred to 1.1). **No seeded default
    credentials, ever** — bootstrap is always an explicit first signup/login. Signup's "username taken"
    is accepted low-risk enumeration (every signup form leaks it).

## Open questions for codex (answered)
1. Identity as **columns on `users`** (chosen, since "no linking" ⇒ permanent 1:1) vs. a separate
   `identities` table. Agree columns is right?
2. `status` enum `pending|active|rejected` — is `rejected` worth it vs. pending+delete? (I say yes:
   durable decision, no OIDC re-login loop.)
3. Data-preserving migration vs. accept a clean wipe given "starting from scratch." (I lean preserve.)
4. `@fastify/rate-limit` dep vs. hand-rolled limiter. (I say add the dep.)
5. Gate **search** too, or only request-create? (I gate both.)
6. Anything in the threat model I'm missing (session fixation on signup, user-enumeration, the
   first-user-admin race across providers)?
