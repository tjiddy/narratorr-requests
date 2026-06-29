import { describe, it, expect } from 'vitest';
import { v1SystemSchema } from './system.js';

describe('v1SystemSchema (vendored, consumer-lenient)', () => {
  it('parses a body carrying only version', () => {
    const parsed = v1SystemSchema.parse({ version: 'v1.0.0' });
    expect(parsed.version).toBe('v1.0.0');
  });

  it('tolerates unknown/extra provider fields without .strict()', () => {
    const parsed = v1SystemSchema.parse({
      version: 'v1.0.0',
      commit: 'abc1234',
      buildTime: '2026-06-01T00:00:00.000Z',
      nodeVersion: 'v24.10.0',
      os: 'Linux 6.8.0',
      somethingNarratorrAddedLater: true,
    });
    expect(parsed.version).toBe('v1.0.0');
    expect(parsed.commit).toBe('abc1234');
  });

  it('rejects a body missing version', () => {
    expect(v1SystemSchema.safeParse({ commit: 'abc1234' }).success).toBe(false);
  });
});
