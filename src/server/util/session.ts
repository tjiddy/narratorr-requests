import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

// HMAC-signed, stateless session cookie. Mirrors Narratorr's pattern: a
// base64url JSON payload plus an HMAC-SHA256 signature, compared in constant
// time after hashing both sides to a fixed length.
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  uid: number; // users.id
  pid: string; // users.publicId
  iat: number;
  exp: number;
}

export function createSessionToken(data: { uid: number; pid: string }, secret: string, nowMs = Date.now()): string {
  const payload: SessionPayload = { uid: data.uid, pid: data.pid, iat: nowMs, exp: nowMs + SESSION_TTL_MS };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

export function verifySessionToken(token: string, secret: string, nowMs = Date.now()): SessionPayload | null {
  const parts = token.split('.');
  const b64 = parts[0];
  const sig = parts[1];
  if (parts.length !== 2 || b64 === undefined || sig === undefined) return null;

  const expected = createHmac('sha256', secret).update(b64).digest('base64url');
  // Hash both to a fixed 32 bytes so length never leaks and timingSafeEqual is safe.
  const a = createHash('sha256').update(sig).digest();
  const b = createHash('sha256').update(expected).digest();
  if (!timingSafeEqual(a, b)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(b64, 'base64url').toString()) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.uid !== 'number' || typeof payload.pid !== 'string') return null;
  if (typeof payload.exp !== 'number' || nowMs >= payload.exp) return null;
  return payload;
}
