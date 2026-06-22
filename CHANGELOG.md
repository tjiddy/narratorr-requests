# Changelog

All notable changes to narratorr-request are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] — Unreleased

Initial public release.

### Added
- Overseerr-style audiobook request flow: search/browse → request → admin approval → handoff
  to narratorr's `search → download → import` pipeline → "available" notification.
- Pluggable authentication: local email + password (scrypt) and any number of generic OIDC
  providers (Plex bridge, Authelia, Authentik, Keycloak, Google, …), plus an `AUTH_BYPASS` dev
  mode that refuses to run in production or bind a non-loopback host.
- Authorization via an in-app approval queue (`pending` / `active` / `rejected`), independent
  of authentication; the first user becomes admin, or pin one with `BOOTSTRAP_ADMIN`.
- In-app Settings for the narratorr connection and notification channels (ntfy / email /
  webhook), stored encrypted at rest with AES-256-GCM; secrets are masked in API responses.
- Request-lifecycle polling that reconciles narratorr book status to `available` / `failed`.
- Contract-first narratorr integration: the consumed `/api/v1` surface is vendored as Zod
  schemas; a non-conforming response surfaces as `502 CONTRACT_MISMATCH`.
- `coverUrl` SSRF guard (https-only, internal-host rejection) on request input.
- Multi-arch (amd64 / arm64) Docker images published to Docker Hub and GHCR.

[Unreleased]: https://github.com/tjiddy/narratorr-request/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/tjiddy/narratorr-request/releases/tag/v1.0.0
