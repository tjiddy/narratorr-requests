# Changelog

All notable changes to narratorr-requests are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  and set a per-user request-quota mode + auto-approve.
- Request quotas as explicit policy modes (no overloaded `0`/blank). The app-wide default is
  either `unlimited` or a positive `limited` cap over a day/week/month rolling window, set in the
  Settings UI and stored in `app_settings` (no redeploy). Per-user overrides are one of four
  modes — inherit the default, unlimited, a custom limit, or blocked (a hard admin block that
  returns `403 QUOTA_BLOCKED`, distinct from the at-cap `429 QUOTA_EXCEEDED`). Admins are always
  unlimited; a fresh DB seeds a limit of 10 per 30 days.
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
