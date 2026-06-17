import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('round-trips a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('produces the self-describing scrypt format with a unique salt per call', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(a.split('$')).toHaveLength(6);
    expect(a).not.toBe(b); // random salt → different hash for the same password
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });

  it('returns false (never throws) for null/empty/malformed/tampered hashes', async () => {
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$bad$format')).toBe(false);
    const good = await hashPassword('secret');
    const tampered = good.slice(0, -4) + 'AAAA'; // corrupt the trailing hash bytes
    expect(await verifyPassword('secret', tampered)).toBe(false);
  });

  it('runs the KDF even for a missing/malformed hash (no timing oracle for enumeration)', async () => {
    // The no-such-user path must do the same scrypt work as a real verify, so its timing
    // can't reveal which usernames exist. Generous bound: it would be ~1000x faster if the
    // KDF were skipped — we just require it isn't a near-instant short-circuit.
    const real = await hashPassword('password123');
    const time = async (stored: string | null) => {
      const start = process.hrtime.bigint();
      await verifyPassword('attempt-guess', stored);
      return Number(process.hrtime.bigint() - start) / 1e6; // ms
    };
    const iterations = 5;
    let realMs = 0;
    let missingMs = 0;
    for (let i = 0; i < iterations; i++) {
      realMs += await time(real);
      missingMs += await time(null);
    }
    expect(missingMs).toBeGreaterThan(realMs * 0.5);
  });
});
