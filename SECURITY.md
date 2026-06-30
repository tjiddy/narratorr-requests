# Security Policy

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via GitHub's **[private vulnerability reporting](https://github.com/tjiddy/narratorr-requests/security/advisories/new)**
(the repository's *Security → Report a vulnerability* tab), or contact the maintainer
directly. You'll get an acknowledgement, and a fix or mitigation will be coordinated
before any public disclosure.

When reporting, please include the affected version (git tag), reproduction steps, and
the impact you observed.

## Supported Versions

The latest tagged release receives security fixes; there is no back-porting to older tags.
(`v1.0.0` is the initial stable release.)

## Security Model

narratorr-requests is a **self-hosted** app intended to run on a private network as a
contract-first sidecar to [narratorr](https://github.com/tjiddy/narratorr). It talks to
narratorr only over narratorr's public `/api/v1` using a server-held API key. The browser
only ever calls **our** `/api/*` — it never reaches narratorr directly and never receives
the narratorr API key.

### Authentication

Authentication is pluggable; exactly one posture is active per deployment:

- **`AUTH_BYPASS`** — a development shortcut that makes every request the dev admin. It
  **refuses to run when `NODE_ENV=production`** and **refuses to bind a non-loopback host**
  unless `ALLOW_INSECURE_AUTH_BYPASS` is explicitly set. These guards are enforced at config
  load (boot fails fast) and covered by tests.
- **Local** email + password — passwords hashed with **scrypt** and compared with
  `crypto.timingSafeEqual`. Login returns the same generic error for a wrong password and a
  nonexistent account, so response content does not enable username enumeration.
- **OIDC** — any number of generic OIDC providers. The authorization-code flow uses **PKCE
  (S256)** plus **state** and **nonce**, all drawn from `node:crypto`. State is single-use
  and expires after a short pending TTL. ID-token claims are validated, not coerced: a
  non-string subject is rejected (it can't become a forged identity key) and claim length is
  capped before it is used as a uniqueness key.

Identity is a generic `(authProvider, authSubject)` pair — there is **no account linking**
across providers.

### Authorization

Authentication is separate from authorization. A newly authenticated user enters an
**approval queue** (`pending` → `active` / `rejected`); only an `active` user can request,
and admin-only routes additionally check the admin role. The first user to sign in becomes
admin + active unless `BOOTSTRAP_ADMIN` pins a specific identity.

### Sessions

Sessions are stateless HMAC-signed tokens carried in a cookie that is `httpOnly`,
`SameSite=Lax`, scoped to a 7-day TTL, and marked `Secure` whenever there is TLS in front of the
app (`config.behindTls`, which defaults true under `NODE_ENV=production`). A production deploy run
over plain HTTP with no TLS terminator must set `BEHIND_TLS=false` so the browser will store and
send the cookie — otherwise login silently never persists. Verification uses a constant-time
compare; a tampered signature, a malformed token, or an expired token is rejected.

### Rate limiting

Authentication endpoints are rate-limited and return HTTP 429 when exceeded. The limiter
keys on **(client IP, email)** rather than IP alone, so one mistyped password can't lock out
every user behind a shared NAT; requests without an email (e.g. OIDC) key on IP. Behind a
reverse proxy, set `TRUSTED_PROXIES` so the real client IP is resolved from
`X-Forwarded-For` — otherwise every request appears to originate from the proxy and the
per-IP buckets (and the `Secure` cookie attribute) degrade.

### Secrets at rest

Connector secrets — the narratorr API key and all notifier credentials (the SMTP password, the
ntfy / Telegram / Gotify / Pushover tokens & keys, and the Discord / Slack / generic-webhook
capability URLs) — are **encrypted at rest** with **AES-256-GCM** (per-value random 12-byte IV, 16-byte auth tag),
stored as `enc:v1:<base64(iv|tag|ciphertext)>`. The 32-byte key is derived via **HKDF-SHA256**
from `SETTINGS_KEY` (opt-in) or, by default, the existing `SESSION_SECRET`. Decryption fails
*soft* (returns null → the connector reads as "unconfigured") rather than crashing boot, so a
key change degrades gracefully.

Secrets are **masked in every API response** — the GET surface returns presence flags (e.g.
`hasApiKey: true`), never the value — and a PUT that omits a secret field preserves the stored
value instead of clearing it.

### Outbound URL validation (SSRF)

A user-supplied request `coverUrl` is rendered as `<img src>` in the admin's browser and
forwarded as ntfy's `Icon` header (which the ntfy server then fetches), so it is validated at
the schema boundary: it must be an **`https` URL with a non-internal host**. The guard rejects
loopback, RFC-1918 / RFC-4193 private, and link-local addresses (including `169.254.169.254`
cloud-metadata), the `localhost` name family, alternate IPv4 encodings (decimal/hex/octal/short,
which the WHATWG URL parser canonicalizes before the range check), and internal IPv4 embedded in
IPv6 literals.

**Known limitation:** schema-time validation cannot stop **DNS rebinding** — a hostname that
passes validation but resolves to an internal address at fetch time. Closing that requires
fetch-time IP re-checking; it is tracked as a documented residual, not a silent gap.

### Input validation & data access

All API inputs are validated with **Zod** schemas before use. Database access goes through
**Drizzle ORM** with parameterized queries — there is no string-interpolated SQL. Responses
from narratorr are validated against a vendored Zod contract; a response that fails the
contract becomes a `502 CONTRACT_MISMATCH` rather than propagating unvalidated data.

## Dependencies

Dependency vulnerabilities are tracked with `pnpm audit`, run as part of release preparation.
Where a transitive advisory has no fix from its direct parent, the patched version is pinned
via `pnpm.overrides` in `package.json`. Supply-chain exposure is further limited by
`pnpm.onlyBuiltDependencies`, which restricts install-time lifecycle scripts to an explicit
allowlist.
