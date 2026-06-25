# Changelog

All notable changes to narratorr-requests are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- The default request quota (limit + a day/week/month rolling window) is now admin-editable
  in the Settings UI, stored in `app_settings` — no redeploy. Per-user overrides still win and
  admins remain unlimited.

### Removed
- `DEFAULT_REQUEST_QUOTA` env var (and the hardcoded 30-day window). The default quota is set
  in Settings instead; a fresh DB seeds 10 requests per rolling 30 days.

## [1.0.0] - 2026-06-24

Initial public release.

### Added
- Overseerr-style audiobook request flow: search/browse → request → admin approval → handoff
  to narratorr's `search → download → import` pipeline, with the request reconciled to
  `available` as narratorr completes the import (tracked live on the requester's My Requests page).
- Library-aware search: each result reflects narratorr's library status (in library /
  acquiring / requestable), so users don't re-request books already owned.
- Pluggable authentication: local email + password (scrypt) and any number of generic OIDC
  providers (Plex bridge, Authelia, Authentik, Keycloak, Google, …), plus an `AUTH_BYPASS` dev
  mode that refuses to run in production or bind a non-loopback host.
- Authorization via an in-app approval queue (`pending` / `active` / `rejected`), independent
  of authentication; the first user becomes admin, or pin one with `BOOTSTRAP_ADMIN`.
- Admin user management: approve/reject pending users, promote/demote admins (self-guarded),
  and set per-user request quota + auto-approve.
- Per-user request quotas (rolling 30-day window) with an app-wide default
  (`DEFAULT_REQUEST_QUOTA`) and per-user overrides.
- In-app Settings (admin) to connect narratorr and add any number of notifiers — ntfy, email
  (SMTP), webhook, Discord, Slack, Telegram, Pushover, and Gotify — each firing on the events it
  subscribes to: a new request, a new signup, or a failed request. Notifier secrets are stored
  encrypted at rest with AES-256-GCM and masked in API responses.
- Request-lifecycle polling that reconciles narratorr book status to `available` / `failed`.
- Contract-first narratorr integration: the consumed `/api/v1` surface is vendored as Zod
  schemas; a non-conforming response surfaces as `502 CONTRACT_MISMATCH`.
- `coverUrl` SSRF guard (https-only, internal-host rejection) on request input.
- Brute-force protection: rate-limited auth endpoints keyed on client IP + attempted email.
- Multi-arch (amd64 / arm64) Docker images published to Docker Hub and GHCR.

[Unreleased]: https://github.com/tjiddy/narratorr-requests/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/tjiddy/narratorr-requests/releases/tag/v1.0.0
