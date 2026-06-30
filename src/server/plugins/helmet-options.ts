import type { FastifyHelmetOptions } from '@fastify/helmet';

/**
 * Build the `@fastify/helmet` options for serving the SPA. Pulled out of `main()` (which
 * auto-runs on import and so can't be `inject()`ed) into a pure, `behindTls`-parameterised
 * factory so both branches are exercisable in one test process — `behindTls` is an argument,
 * NOT the frozen `config` singleton.
 *
 * `behindTls` is the single "there is TLS in front of us" signal. When it's false (a plain-HTTP
 * deploy — LAN/VPN/Tailscale, or a prod image without a TLS terminator), we must NOT emit the two
 * headers that assume HTTPS:
 *  - the CSP directive `upgrade-insecure-requests`, which rewrites every `http://` subresource to
 *    `https://` — over plain HTTP those hit a port with no TLS listener and die with
 *    `ERR_SSL_PROTOCOL_ERROR`, blank-screening the app, and
 *  - the `Strict-Transport-Security` (HSTS) response header.
 *
 * To keep the `behindTls: true` output BYTE-IDENTICAL to the historical inline block, we do NOT
 * make `upgradeInsecureRequests` explicit on the true branch: helmet 8 emits the raw directives in
 * insertion order and then appends the *missing* defaults (`script-src-attr`, `form-action`,
 * `upgrade-insecure-requests`) afterward, so an explicit key would reorder the merged CSP. Instead
 * we only touch the directive when disabling it — conditionally spreading `upgradeInsecureRequests:
 * null` (helmet reads `null` as "explicitly disabled" → suppressed from the default merge). HSTS is
 * disabled via the top-level `strictTransportSecurity` option (a response-header option, not a CSP
 * directive).
 */
export function buildHelmetOptions({ behindTls }: { behindTls: boolean }): FastifyHelmetOptions {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'https:', 'data:'],
        // scriptSrc stays strict 'self' — the no-flash boot script is served as an
        // external /theme-init.js (not inline) so no hash/nonce is needed.
        scriptSrc: ["'self'"],
        // Google Fonts: stylesheet from fonts.googleapis.com, font files from
        // fonts.gstatic.com (mirrors Narratorr's helmet-options.ts).
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        // Only TOUCH this directive when disabling it: on the true branch the directives
        // object is identical to the historical one (helmet appends `upgrade-insecure-requests`
        // via its default merge); on the false branch `null` lands in helmet's
        // `directivesExplicitlyDisabled` and is suppressed.
        ...(behindTls ? {} : { upgradeInsecureRequests: null }),
      },
    },
    // helmet 8 name for HSTS; a response-header option, not a CSP directive. `false` omits it.
    strictTransportSecurity: behindTls,
    referrerPolicy: { policy: 'no-referrer' },
  };
}
