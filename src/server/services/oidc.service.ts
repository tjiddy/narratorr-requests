import * as oidc from 'openid-client';
import type { PlexProfile } from './user.service.js';
import { badGateway, badRequest, forbidden } from '../util/errors.js';

export interface OidcServiceConfig {
  issuer: string;
  clientId: string;
  clientSecret: string | undefined;
  redirectUri: string;
  /** OAuth scope string, e.g. 'openid profile email'. */
  scope: string;
  /** Label used in error messages (e.g. 'Plex', 'Authelia'). */
  label: string;
}

interface PendingAuth {
  codeVerifier: string;
  nonce: string;
  createdAt: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000;

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Generic OIDC authorization-code + PKCE client. The SECURITY-CRITICAL flow
 * (discovery, PKCE, state/nonce, token exchange) is single-sourced here and shared
 * by every provider; the provider-specific bits — how to turn claims into a profile,
 * and any post-auth gate — are injected. Pending {state→verifier} is held in memory
 * with a short TTL (single-instance MVP; a shared store is a fast-follow if scaled).
 */
export class OidcService<P> {
  private configPromise: Promise<oidc.Configuration> | null = null;
  private readonly pending = new Map<string, PendingAuth>();

  constructor(
    private readonly cfg: OidcServiceConfig,
    /** Map ID-token claims (+ best-effort userinfo) into a domain profile. */
    private readonly mapClaims: (claims: Record<string, unknown>, userinfo: Record<string, unknown> | null) => P,
    /** Optional gate run on the mapped profile; throw (e.g. forbidden) to reject. */
    private readonly validate: (profile: P) => void = () => {},
  ) {}

  private async getConfig(): Promise<oidc.Configuration> {
    if (!this.configPromise) {
      this.configPromise = oidc
        .discovery(new URL(this.cfg.issuer), this.cfg.clientId, this.cfg.clientSecret)
        .catch((err: unknown) => {
          this.configPromise = null;
          throw badGateway('OIDC_DISCOVERY', `${this.cfg.label} OIDC discovery failed: ${describe(err)}`);
        });
    }
    return this.configPromise;
  }

  /** Build the authorization URL and remember the PKCE verifier for the callback. */
  async buildAuthUrl(nowMs = Date.now()): Promise<string> {
    const config = await this.getConfig();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();

    this.sweep(nowMs);
    this.pending.set(state, { codeVerifier, nonce, createdAt: nowMs });

    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: this.cfg.redirectUri,
      scope: this.cfg.scope,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    return url.href;
  }

  /** Exchange the callback for tokens, map claims, and run the provider gate. */
  async handleCallback(callbackUrl: string, nowMs = Date.now()): Promise<P> {
    const config = await this.getConfig();
    const current = new URL(callbackUrl);
    const state = current.searchParams.get('state');
    if (!state) throw badRequest('OIDC_STATE', 'missing state');
    const pending = this.pending.get(state);
    if (!pending || nowMs - pending.createdAt > PENDING_TTL_MS) {
      throw badRequest('OIDC_STATE', 'unknown or expired auth state');
    }
    this.pending.delete(state);

    let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
    try {
      tokens = await oidc.authorizationCodeGrant(config, current, {
        pkceCodeVerifier: pending.codeVerifier,
        expectedState: state,
        expectedNonce: pending.nonce,
      });
    } catch (err) {
      throw badGateway('OIDC_EXCHANGE', `${this.cfg.label} OIDC token exchange failed: ${describe(err)}`);
    }

    const claims = (tokens.claims() ?? {}) as Record<string, unknown>;
    let userinfo: Record<string, unknown> | null = null;
    const sub = str(claims['sub']);
    if (sub) {
      try {
        userinfo = (await oidc.fetchUserInfo(config, tokens.access_token, sub)) as Record<string, unknown>;
      } catch {
        userinfo = null; // userinfo is best-effort; claims may already suffice
      }
    }

    const profile = this.mapClaims(claims, userinfo);
    this.validate(profile);
    return profile;
  }

  private sweep(nowMs: number): void {
    for (const [state, p] of this.pending) {
      if (nowMs - p.createdAt > PENDING_TTL_MS) this.pending.delete(state);
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// =============================================================================
// Plex adapter (via the plex-oidc-bridge)
// =============================================================================

/**
 * Claim adapter: the plex-oidc-bridge's exact claim shape is NOT assumed. Pull a
 * stable subject, a display username, and best-effort email/thumb from the ID-token
 * claims or userinfo, falling through several common keys.
 */
export function mapPlexClaims(
  claims: Record<string, unknown>,
  userinfo: Record<string, unknown> | null,
): PlexProfile {
  const ui = userinfo ?? {};
  const plexId =
    str(claims['plex_id']) ?? str(claims['plexId']) ?? str(claims['sub']) ?? str(ui['sub']);
  const plexUsername =
    str(claims['preferred_username']) ??
    str(claims['username']) ??
    str(claims['plex_username']) ??
    str(claims['name']) ??
    str(ui['preferred_username']) ??
    str(ui['name']) ??
    plexId;
  if (!plexId || !plexUsername) {
    throw badGateway('OIDC_CLAIMS', 'Plex OIDC response had no usable subject/username claim');
  }
  return {
    plexId,
    plexUsername,
    email: str(claims['email']) ?? str(ui['email']) ?? null,
    thumb: str(claims['picture']) ?? str(claims['thumb']) ?? str(ui['picture']) ?? null,
  };
}

/** Plex allowlist gate: reject accounts not on the configured allowlist (empty = allow any). */
export function plexAllowlistGate(allowlist: string[]): (profile: PlexProfile) => void {
  const allowed = new Set(allowlist.map((s) => s.toLowerCase()));
  return (profile) => {
    if (allowed.size === 0) return;
    if (!allowed.has(profile.plexUsername.toLowerCase()) && !allowed.has(profile.plexId.toLowerCase())) {
      throw forbidden('Your Plex account is not on the allowlist for this server.');
    }
  };
}

// =============================================================================
// Authelia adapter (operator admin SSO)
// =============================================================================

export interface AutheliaProfile {
  subject: string;
  username: string;
  email: string | null;
}

/** Authelia emits standard OIDC claims; we take sub + a display username + email. */
export function mapAutheliaClaims(
  claims: Record<string, unknown>,
  userinfo: Record<string, unknown> | null,
): AutheliaProfile {
  const ui = userinfo ?? {};
  const subject = str(claims['sub']) ?? str(ui['sub']);
  const username =
    str(claims['preferred_username']) ??
    str(ui['preferred_username']) ??
    str(claims['name']) ??
    str(ui['name']) ??
    subject;
  if (!subject || !username) {
    throw badGateway('OIDC_CLAIMS', 'Authelia OIDC response had no usable subject/username claim');
  }
  return { subject, username, email: str(claims['email']) ?? str(ui['email']) ?? null };
}

/**
 * Optional subject pin: when set, only that exact Authelia `sub` may sign in.
 * Belt-and-suspenders on top of Authelia's own access control — null = allow any
 * Authelia account that reaches the flow (fine when Authelia already gates who can).
 */
export function autheliaAdminGate(adminSubject: string | null): (profile: AutheliaProfile) => void {
  return (profile) => {
    if (adminSubject && profile.subject !== adminSubject) {
      throw forbidden('This Authelia account is not the configured admin.');
    }
  };
}
