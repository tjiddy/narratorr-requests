import { randomBytes } from 'node:crypto';

// Opaque public-ID generator. Matches the `<prefix>_<token>` shape the v1
// contract validates via `prefixedId` (token is [A-Za-z0-9]+). We own `us_`
// (users), `rq_` (requests), `nf_` (notifiers), and `aq_` (acquisitions, in standalone mock).
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

// Largest multiple of the alphabet that fits in a byte (7 * 36 = 252). Bytes ≥ this
// map unevenly under modulo, so we reject and resample them — every symbol stays
// equally likely (no modulo bias). Opaque IDs don't need this, but unbiased is free.
const MAX_UNBIASED = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

export function publicId(prefix: string, length = 20): string {
  let token = '';
  while (token.length < length) {
    for (const byte of randomBytes(length - token.length)) {
      if (byte < MAX_UNBIASED) token += ALPHABET[byte % ALPHABET.length];
    }
  }
  return `${prefix}_${token}`;
}
