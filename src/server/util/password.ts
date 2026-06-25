import {
  scrypt,
  scryptSync,
  randomBytes,
  timingSafeEqual,
  type BinaryLike,
  type ScryptOptions,
} from 'node:crypto';

// Local-auth password hashing with scrypt (built into Node — no extra dependency,
// memory-hard, and recommended by OWASP for password storage). Self-describing
// format so cost params can evolve without breaking existing hashes:
//   scrypt$N$r$p$<saltB64>$<hashB64>
// Hand-wrapped (rather than promisify) so the options-arg overload is used.
function scryptAsync(password: BinaryLike, salt: BinaryLike, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

const N = 16384; // CPU/memory cost (2^14)
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;

interface ParsedHash {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  expected: Buffer;
}

function parse(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] as string, 'base64');
    expected = Buffer.from(parts[5] as string, 'base64');
  } catch {
    return null;
  }
  if (salt.length === 0 || expected.length === 0) return null;
  return { n, r, p, salt, expected };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

// A real, well-formed hash used as the work target when a login names a user that
// doesn't exist (or an OIDC identity with no password). Verifying against it makes the
// no-such-user path run the SAME scrypt work as the real path, so response time doesn't
// leak which usernames exist (anti-enumeration). Computed once, synchronously, at import.
const DUMMY_HASH = (() => {
  const salt = Buffer.alloc(SALT_BYTES, 0x2a);
  const derived = scryptSync('narratorr-requests-dummy', salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`;
})();

/**
 * Verify a password against a stored hash. ALWAYS performs one scrypt derivation — even
 * for a null/empty/malformed stored hash (it falls back to a dummy) — so the timing of a
 * failed verify can't distinguish "no such user" from "wrong password". Returns false
 * (never throws) on any non-match; the compare is constant-time.
 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const real = stored ? parse(stored) : null;
  // Run the KDF against the real hash when present, else the dummy — same work either way.
  const target = real ?? (parse(DUMMY_HASH) as ParsedHash);
  let derived: Buffer;
  try {
    derived = await scryptAsync(password, target.salt, target.expected.length, { N: target.n, r: target.r, p: target.p });
  } catch {
    return false;
  }
  const match = derived.length === target.expected.length && timingSafeEqual(derived, target.expected);
  // A dummy-path verify can never authenticate, regardless of the (meaningless) compare.
  return real !== null && match;
}
