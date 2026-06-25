import { describe, it, expect } from 'vitest';
import { parsePositiveLimit, isPositiveLimitValid } from './quota-limit';
import { DEFAULT_QUOTA_LIMIT_MAX } from '@shared/schemas/connectors';

describe('parsePositiveLimit — the shared positive-int limit field', () => {
  it('accepts a plain positive-integer digit string', () => {
    expect(parsePositiveLimit('3')).toEqual({ ok: true, value: 3 });
    expect(parsePositiveLimit(' 42 ')).toEqual({ ok: true, value: 42 });
  });

  it('rejects blank, 0, decimals, scientific, hex, negatives, and junk', () => {
    for (const bad of ['', '   ', '0', '00', '3.5', '-1', '-0', '1e3', '0x10', '5x', 'abc']) {
      expect(parsePositiveLimit(bad).ok).toBe(false);
      expect(isPositiveLimitValid(bad)).toBe(false);
    }
  });

  it('accepts the ceiling but rejects values past DEFAULT_QUOTA_LIMIT_MAX', () => {
    expect(parsePositiveLimit(String(DEFAULT_QUOTA_LIMIT_MAX))).toEqual({ ok: true, value: DEFAULT_QUOTA_LIMIT_MAX });
    expect(parsePositiveLimit(String(DEFAULT_QUOTA_LIMIT_MAX + 1)).ok).toBe(false);
  });

  it('rejects a digit string so long it parses past the safe-integer range (no silent round-trip)', () => {
    expect(parsePositiveLimit('9'.repeat(20)).ok).toBe(false);
  });
});
