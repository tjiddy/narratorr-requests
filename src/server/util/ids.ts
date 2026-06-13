import { randomBytes } from 'node:crypto';

// Opaque public-ID generator. Matches the `<prefix>_<token>` shape the v1
// contract validates via `prefixedId` (token is [A-Za-z0-9]+). We own `us_`
// (users), `rq_` (requests), and `aq_` (acquisitions, in standalone mock).
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function publicId(prefix: string, length = 20): string {
  const bytes = randomBytes(length);
  let token = '';
  for (let i = 0; i < length; i++) {
    // Modulo bias is negligible here (36 vs 256) and irrelevant for opaque IDs.
    token += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${prefix}_${token}`;
}
