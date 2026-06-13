import * as oidc from 'openid-client';
import type { PlexProfile } from './user.service.js';
import { badGateway, badRequest, forbidden } from '../util/errors.js';

export interface PlexOidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string | undefined;
  redirectUri: string;
  /** Allowed Plex usernames/ids (case-insensitive). Empty = allow any authenticated user. */
  allowlist: string[];
  ownerUsername: string | null;
}

interface PendingAuth {
  codeVerifier: string;
  nonce: string;
  createdAt: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Claim adapter (Codex decision #2): the plex-oidc-bridge's exact claim shape is
 * NOT assumed. We pull a stable subject, a display username, and best-effort
 * email/thumb from either the ID token claims or userinfo, falling back through
 * several common keys. This is the ONE place to adjust once the bridge's real
 * claims are confirmed against a running instance.
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

/**
 * Plex OIDC via the bridge. Authorization-code + PKCE. Pending {state→verifier}
 * is held in memory with a short TTL (single-instance MVP; a shared store is a
 * fast-follow if this is ever scaled horizontally).
 */
export class PlexOidcService {
  private configPromise: Promise<oidc.Configuration> | null = null;
  private readonly pending = new Map<string, PendingAuth>();

  constructor(private readonly cfg: PlexOidcConfig) {}

  private async getConfig(): Promise<oidc.Configuration> {
    if (!this.configPromise) {
      this.configPromise = oidc
        .discovery(new URL(this.cfg.issuer), this.cfg.clientId, this.cfg.clientSecret)
        .catch((err: unknown) => {
          this.configPromise = null;
          throw badGateway('OIDC_DISCOVERY', `Plex OIDC discovery failed: ${describe(err)}`);
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
      scope: 'openid profile email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    return url.href;
  }

  /** Exchange the callback for tokens, map claims, and enforce the allowlist. */
  async handleCallback(callbackUrl: string, nowMs = Date.now()): Promise<PlexProfile> {
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
      throw badGateway('OIDC_EXCHANGE', `Plex OIDC token exchange failed: ${describe(err)}`);
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

    const profile = mapPlexClaims(claims, userinfo);
    this.enforceAllowlist(profile);
    return profile;
  }

  get ownerUsername(): string | null {
    return this.cfg.ownerUsername;
  }

  private enforceAllowlist(profile: PlexProfile): void {
    if (this.cfg.allowlist.length === 0) return;
    const allowed = new Set(this.cfg.allowlist.map((s) => s.toLowerCase()));
    if (!allowed.has(profile.plexUsername.toLowerCase()) && !allowed.has(profile.plexId.toLowerCase())) {
      throw forbidden('Your Plex account is not on the allowlist for this server.');
    }
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
