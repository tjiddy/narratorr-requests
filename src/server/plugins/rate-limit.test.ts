import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { authRateLimitOptions } from './rate-limit.js';

// Call the keyGenerator directly with a stub request — the limiter itself (429 trip) is
// covered by the auth-route integration test; here we pin the keying logic.
const keyFor = (ip: string, body?: unknown) =>
  authRateLimitOptions.keyGenerator({ ip, body } as unknown as FastifyRequest);

describe('authRateLimitOptions.keyGenerator', () => {
  it('keys two emails from the same IP into separate buckets', () => {
    const a = keyFor('1.2.3.4', { email: 'alice@example.com' });
    const b = keyFor('1.2.3.4', { email: 'bob@example.com' });
    expect(a).toBe('1.2.3.4|alice@example.com');
    expect(b).toBe('1.2.3.4|bob@example.com');
    expect(a).not.toBe(b);
  });

  it('falls back to IP alone when email is missing, null, non-string, or empty', () => {
    expect(keyFor('1.2.3.4')).toBe('1.2.3.4|');
    expect(keyFor('1.2.3.4', {})).toBe('1.2.3.4|');
    expect(keyFor('1.2.3.4', { email: null })).toBe('1.2.3.4|');
    expect(keyFor('1.2.3.4', { email: 42 })).toBe('1.2.3.4|');
    expect(keyFor('1.2.3.4', { email: '' })).toBe('1.2.3.4|');
  });

  it('trims and lowercases the email', () => {
    expect(keyFor('1.2.3.4', { email: '  A@B.COM ' })).toBe('1.2.3.4|a@b.com');
  });

  it('bounds the email at 64 chars (.slice(0, 64))', () => {
    const long = 'x'.repeat(100);
    expect(keyFor('1.2.3.4', { email: long })).toBe(`1.2.3.4|${'x'.repeat(64)}`);
  });
});
