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

  it('"Infinity" → undefined (not a digits-only string)', () => {
    expect(parseQuota('Infinity')).toBeUndefined();
  });

  // Grammar aligned onto parseLimit's strict digits-only `/^\d+$/` (issue #77): the two
  // quota inputs now reject the same non-canonical numeric forms, removing the second
  // silent asymmetry between the per-user and default-quota paths. Exponent, hex and
  // trailing-`.0` forms — which Number() would have coerced to a finite integer — are
  // rejected here exactly as parseLimit rejects them on the default-quota field.
  it('"1e2" → undefined (exponent notation rejected; was 100 under Number())', () => {
    expect(parseQuota('1e2')).toBeUndefined();
  });

  it('"0x10" → undefined (hex notation rejected)', () => {
    expect(parseQuota('0x10')).toBeUndefined();
  });

  it('"1.0" → undefined (trailing-zero decimal rejected — digits only)', () => {
    expect(parseQuota('1.0')).toBeUndefined();
  });
});
