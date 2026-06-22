import { describe, it, expect } from 'vitest';
import { updateUserBodySchema, localCredentialsSchema } from './user.js';

describe('updateUserBodySchema', () => {
  describe('requestQuota — int().min(0).nullable().optional()', () => {
    it('rejects negative and non-integer values', () => {
      expect(updateUserBodySchema.safeParse({ requestQuota: -1 }).success).toBe(false);
      expect(updateUserBodySchema.safeParse({ requestQuota: 1.5 }).success).toBe(false);
    });

    it('accepts 0, null, and absent', () => {
      expect(updateUserBodySchema.safeParse({ requestQuota: 0 }).success).toBe(true);
      expect(updateUserBodySchema.safeParse({ requestQuota: null }).success).toBe(true);
      expect(updateUserBodySchema.safeParse({}).success).toBe(true);
    });
  });

  describe('role enum (case-sensitive)', () => {
    it('accepts admin and user', () => {
      expect(updateUserBodySchema.safeParse({ role: 'admin' }).success).toBe(true);
      expect(updateUserBodySchema.safeParse({ role: 'user' }).success).toBe(true);
    });

    it('rejects out-of-set and wrong-case values', () => {
      expect(updateUserBodySchema.safeParse({ role: 'Admin' }).success).toBe(false);
      expect(updateUserBodySchema.safeParse({ role: 'owner' }).success).toBe(false);
    });
  });

  describe('status enum (case-sensitive)', () => {
    it('accepts pending, active, rejected', () => {
      expect(updateUserBodySchema.safeParse({ status: 'pending' }).success).toBe(true);
      expect(updateUserBodySchema.safeParse({ status: 'active' }).success).toBe(true);
      expect(updateUserBodySchema.safeParse({ status: 'rejected' }).success).toBe(true);
    });

    it('rejects out-of-set and wrong-case values', () => {
      expect(updateUserBodySchema.safeParse({ status: 'invalid' }).success).toBe(false);
      expect(updateUserBodySchema.safeParse({ status: 'Active' }).success).toBe(false);
    });
  });

  describe('.strict()', () => {
    it('rejects an unknown key', () => {
      expect(updateUserBodySchema.safeParse({ role: 'admin', extra: 1 }).success).toBe(false);
    });
  });
});

describe('localCredentialsSchema', () => {
  const pw = 'x'.repeat(8);

  describe('email — trim + lowercase + valid email + max(254)', () => {
    it('accepts a valid 254-char address and rejects 255', () => {
      // '@example.com' is 12 chars; pad the local part to hit the boundary exactly.
      const email254 = `${'a'.repeat(242)}@example.com`;
      const email255 = `${'a'.repeat(243)}@example.com`;
      expect(email254.length).toBe(254);
      expect(email255.length).toBe(255);
      expect(localCredentialsSchema.safeParse({ email: email254, password: pw }).success).toBe(true);
      expect(localCredentialsSchema.safeParse({ email: email255, password: pw }).success).toBe(false);
    });

    it('rejects a malformed address', () => {
      expect(localCredentialsSchema.safeParse({ email: 'notanemail', password: pw }).success).toBe(false);
    });

    it('rejects a whitespace-only email — .trim() empties it before z.email() (path points at email)', () => {
      // The .trim() before the z.email() pipe is load-bearing: '   ' trims to '' which
      // is not a valid email. Asserting the path catches a regression that drops the trim.
      const result = localCredentialsSchema.safeParse({ email: '   ', password: pw });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['email']);
    });

    it('trims and lowercases the email (the normalized value is the subject key)', () => {
      const parsed = localCredentialsSchema.parse({ email: '  USER@EXAMPLE.COM ', password: pw });
      expect(parsed.email).toBe('user@example.com');
    });
  });

  describe('password — min(8).max(200)', () => {
    it('rejects 7 chars, accepts 8 and 200, rejects 201', () => {
      expect(localCredentialsSchema.safeParse({ email: 'user@x.com', password: 'x'.repeat(7) }).success).toBe(false);
      expect(localCredentialsSchema.safeParse({ email: 'user@x.com', password: 'x'.repeat(8) }).success).toBe(true);
      expect(localCredentialsSchema.safeParse({ email: 'user@x.com', password: 'x'.repeat(200) }).success).toBe(true);
      expect(localCredentialsSchema.safeParse({ email: 'user@x.com', password: 'x'.repeat(201) }).success).toBe(false);
    });
  });

  describe('.strict()', () => {
    it('rejects an unknown key', () => {
      expect(localCredentialsSchema.safeParse({ email: 'user@x.com', password: pw, extra: 1 }).success).toBe(false);
    });
  });
});
