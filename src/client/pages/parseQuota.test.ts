import { describe, it, expect } from 'vitest';
import { parseQuota } from './parseQuota';

describe('parseQuota', () => {
  it('empty string → null (clear quota / use app default)', () => {
    expect(parseQuota('')).toBeNull();
  });

  it('whitespace-only → null (trims to empty)', () => {
    expect(parseQuota('   ')).toBeNull();
  });

  it('"0" → 0 (boundary — must NOT be folded to null/undefined by falsy coercion)', () => {
    expect(parseQuota('0')).toBe(0);
  });

  it('positive integer → that number', () => {
    expect(parseQuota('5')).toBe(5);
  });

  it('surrounding whitespace is trimmed before parsing', () => {
    expect(parseQuota('  5  ')).toBe(5);
  });

  it('negative → undefined (rejected, no mutation)', () => {
    expect(parseQuota('-1')).toBeUndefined();
  });

  it('negative with whitespace → undefined', () => {
    expect(parseQuota('  -5  ')).toBeUndefined();
  });

  it('non-integer decimal → undefined', () => {
    expect(parseQuota('1.5')).toBeUndefined();
  });

  it('non-numeric junk → undefined (NaN path)', () => {
    expect(parseQuota('abc')).toBeUndefined();
  });

  it('"Infinity" → undefined (Number("Infinity") is not an integer)', () => {
    expect(parseQuota('Infinity')).toBeUndefined();
  });

  // Behaviour-preserving: parseQuota mirrors Number(trimmed), so any string that
  // coerces to a finite non-negative integer is accepted (not just plain decimal
  // digits). Documents the intentional grammar (spec review F1).
  it('"1e2" → 100 (preserves Number() coercion, integer result)', () => {
    expect(parseQuota('1e2')).toBe(100);
  });
});
