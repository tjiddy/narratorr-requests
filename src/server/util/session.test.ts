import { describe, it, expect } from 'vitest';
import { createSessionToken, verifySessionToken, SESSION_TTL_MS } from './session.js';

const SECRET = 'test-session-secret';
const DATA = { uid: 7, pid: 'us_abc' };
const T = 1_700_000_000_000; // fixed clock

describe('createSessionToken / verifySessionToken', () => {
  it('round-trips: create at T verifies at T to the full payload', () => {
    const token = createSessionToken(DATA, SECRET, T);
    expect(verifySessionToken(token, SECRET, T)).toEqual({
      uid: 7,
      pid: 'us_abc',
      iat: T,
      exp: T + SESSION_TTL_MS,
    });
  });

  describe('expiry boundary (guard is nowMs >= exp)', () => {
    const token = createSessionToken(DATA, SECRET, T);
    const exp = T + SESSION_TTL_MS;

    it('verifies just before exp', () => {
      expect(verifySessionToken(token, SECRET, exp - 1)).toMatchObject({ uid: 7, pid: 'us_abc' });
    });

    it('rejects exactly at exp', () => {
      expect(verifySessionToken(token, SECRET, exp)).toBeNull();
    });

    it('rejects after exp', () => {
      expect(verifySessionToken(token, SECRET, exp + 1)).toBeNull();
    });
  });

  it('rejects a tampered signature', () => {
    const token = createSessionToken(DATA, SECRET, T);
    const [b64] = token.split('.');
    expect(verifySessionToken(`${b64}.deadbeef`, SECRET, T)).toBeNull();
  });

  it('rejects a tampered payload re-encoded against the old signature', () => {
    const token = createSessionToken(DATA, SECRET, T);
    const sig = token.split('.')[1];
    const forged = Buffer.from(JSON.stringify({ uid: 999, pid: 'us_evil', iat: T, exp: T + SESSION_TTL_MS }))
      .toString('base64url');
    expect(verifySessionToken(`${forged}.${sig}`, SECRET, T)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = createSessionToken(DATA, 'other-secret', T);
    expect(verifySessionToken(token, SECRET, T)).toBeNull();
  });

  describe('malformed token structure', () => {
    it('rejects a single-segment token', () => {
      expect(verifySessionToken('a', SECRET, T)).toBeNull();
    });

    it('rejects a three-segment token', () => {
      expect(verifySessionToken('a.b.c', SECRET, T)).toBeNull();
    });

    it('rejects an empty string', () => {
      expect(verifySessionToken('', SECRET, T)).toBeNull();
    });
  });

  it('rejects a non-JSON payload even when the signature is valid', () => {
    // Sign a payload that base64url-decodes to non-JSON, so it passes the HMAC
    // check and fails only at JSON.parse.
    const b64 = Buffer.from('not json at all').toString('base64url');
    const sig = createSessionTokenSig(b64, SECRET);
    expect(verifySessionToken(`${b64}.${sig}`, SECRET, T)).toBeNull();
  });

  describe('type-guard failures (uid/pid/exp)', () => {
    it('rejects a string uid', () => {
      const token = signPayload({ uid: '7', pid: 'us_abc', iat: T, exp: T + SESSION_TTL_MS }, SECRET);
      expect(verifySessionToken(token, SECRET, T)).toBeNull();
    });

    it('rejects a missing pid', () => {
      const token = signPayload({ uid: 7, iat: T, exp: T + SESSION_TTL_MS }, SECRET);
      expect(verifySessionToken(token, SECRET, T)).toBeNull();
    });

    it('rejects a non-numeric exp', () => {
      const token = signPayload({ uid: 7, pid: 'us_abc', iat: T, exp: 'soon' }, SECRET);
      expect(verifySessionToken(token, SECRET, T)).toBeNull();
    });
  });

  describe('iat is emitted but not validated (pins current contract)', () => {
    it('verifies a token with a missing iat', () => {
      const token = signPayload({ uid: 7, pid: 'us_abc', exp: T + SESSION_TTL_MS }, SECRET);
      expect(verifySessionToken(token, SECRET, T)).toMatchObject({ uid: 7, pid: 'us_abc' });
    });

    it('verifies a token with a string iat', () => {
      const token = signPayload({ uid: 7, pid: 'us_abc', iat: 'whenever', exp: T + SESSION_TTL_MS }, SECRET);
      expect(verifySessionToken(token, SECRET, T)).toMatchObject({ uid: 7, pid: 'us_abc' });
    });
  });
});

// --- helpers: mirror session.ts's wire format to forge arbitrary payloads ---
import { createHmac } from 'node:crypto';

function createSessionTokenSig(b64: string, secret: string): string {
  return createHmac('sha256', secret).update(b64).digest('base64url');
}

function signPayload(payload: Record<string, unknown>, secret: string): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${b64}.${createSessionTokenSig(b64, secret)}`;
}
