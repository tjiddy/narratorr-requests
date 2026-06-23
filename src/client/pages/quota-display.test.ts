import { describe, it, expect } from 'vitest';
import { formatQuota } from './quota-display';
import type { MeDto } from '@shared/schemas/user';

const quota = (over: Partial<MeDto['quota']>): MeDto['quota'] => ({
  limit: 5,
  used: 3,
  remaining: 2,
  windowDays: 30,
  ...over,
});

describe('formatQuota', () => {
  it('capped, mid-window: shows used / limit / remaining / window and flags a numeric meter', () => {
    const d = formatQuota(quota({ limit: 5, used: 3, remaining: 2, windowDays: 30 }));
    expect(d.unlimited).toBe(false);
    if (d.unlimited) throw new Error('expected capped');
    expect(d.used).toBe(3);
    expect(d.limit).toBe(5);
    expect(d.remaining).toBe(2);
    expect(d.windowDays).toBe(30);
    expect(d.atCap).toBe(false);
    // The rendered label carries every number, and the window comes from the data (not "30").
    expect(d.label).toContain('3');
    expect(d.label).toContain('5');
    expect(d.label).toContain('2');
    expect(d.windowLabel).toBe('last 30 days');
  });

  it('unlimited (admin / null cap): returns the Unlimited representation, no ratio, no 0/negative remaining', () => {
    const d = formatQuota(quota({ limit: null, used: 5, remaining: null, windowDays: 30 }));
    expect(d.unlimited).toBe(true);
    expect(d.label).toMatch(/unlimited/i);
    // No numeric meter fields leak into the unlimited shape.
    expect(d).not.toHaveProperty('remaining');
    expect(d).not.toHaveProperty('limit');
    expect(d).not.toHaveProperty('used');
  });

  it('at quota (remaining === 0): renders 0 remaining / at-cap, distinct from unlimited', () => {
    const d = formatQuota(quota({ limit: 5, used: 5, remaining: 0, windowDays: 30 }));
    expect(d.unlimited).toBe(false);
    if (d.unlimited) throw new Error('expected capped');
    expect(d.remaining).toBe(0);
    expect(d.atCap).toBe(true);
    expect(d.variant).toBe('danger');
    expect(d.label).toContain('0 remaining');
  });

  it('zero limit: capped (not unlimited) with 0 limit shown — guards `limit || …` coercion', () => {
    const d = formatQuota(quota({ limit: 0, used: 0, remaining: 0, windowDays: 30 }));
    expect(d.unlimited).toBe(false);
    if (d.unlimited) throw new Error('expected capped');
    expect(d.limit).toBe(0);
    expect(d.used).toBe(0);
    expect(d.remaining).toBe(0);
    expect(d.atCap).toBe(true);
    expect(d.label).toContain('0 / 0');
  });

  it('over quota (defensive): renders at/over cap gracefully, never a negative number', () => {
    const d = formatQuota(quota({ limit: 5, used: 7, remaining: 0, windowDays: 30 }));
    expect(d.unlimited).toBe(false);
    if (d.unlimited) throw new Error('expected capped');
    expect(d.remaining).toBe(0);
    expect(d.atCap).toBe(true);
    expect(d.label).not.toMatch(/-\d/);
  });

  it('near cap (remaining low but > 0): flags a warning, not danger', () => {
    const d = formatQuota(quota({ limit: 10, used: 9, remaining: 1, windowDays: 30 }));
    if (d.unlimited) throw new Error('expected capped');
    expect(d.atCap).toBe(false);
    expect(d.variant).toBe('warning');
  });

  it('comfortably under cap: success variant', () => {
    const d = formatQuota(quota({ limit: 10, used: 1, remaining: 9, windowDays: 30 }));
    if (d.unlimited) throw new Error('expected capped');
    expect(d.variant).toBe('success');
  });

  it('singular window: "last 1 day" (no broken pluralization)', () => {
    const d = formatQuota(quota({ limit: 5, used: 0, remaining: 5, windowDays: 1 }));
    if (d.unlimited) throw new Error('expected capped');
    expect(d.windowLabel).toBe('last 1 day');
  });

  it('defensive: capped with a null remaining derives Math.max(0, limit - used)', () => {
    const d = formatQuota({ limit: 5, used: 7, remaining: null, windowDays: 30 });
    if (d.unlimited) throw new Error('expected capped');
    expect(d.remaining).toBe(0);
    expect(d.atCap).toBe(true);
  });
});
