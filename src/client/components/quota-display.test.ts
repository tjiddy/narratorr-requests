import { describe, it, expect } from 'vitest';
import { formatQuota } from './quota-display';
import type { MeDto } from '@shared/schemas/user';

const quota = (over: Partial<MeDto['quota']>): MeDto['quota'] => ({
  mode: 'limited',
  limit: 5,
  used: 3,
  remaining: 2,
  windowDays: 30,
  ...over,
});

describe('formatQuota', () => {
  it('limited, mid-window: shows used / limit / remaining / window and a numeric meter', () => {
    const d = formatQuota(quota({ mode: 'limited', limit: 5, used: 3, remaining: 2, windowDays: 30 }));
    expect(d.kind).toBe('limited');
    if (d.kind !== 'limited') throw new Error('expected limited');
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

  it('unlimited mode: returns the Unlimited representation, no ratio, no numeric fields', () => {
    const d = formatQuota(quota({ mode: 'unlimited', limit: null, used: 5, remaining: null, windowDays: 30 }));
    expect(d.kind).toBe('unlimited');
    expect(d.label).toMatch(/unlimited/i);
    expect(d).not.toHaveProperty('remaining');
    expect(d).not.toHaveProperty('limit');
    expect(d).not.toHaveProperty('used');
  });

  it('blocked mode: renders the admin-block label with a danger variant — NOT a 0 / 0 meter', () => {
    const d = formatQuota(quota({ mode: 'blocked', limit: null, used: 0, remaining: 0, windowDays: 30 }));
    expect(d.kind).toBe('blocked');
    if (d.kind !== 'blocked') throw new Error('expected blocked');
    expect(d.variant).toBe('danger');
    expect(d.label).toMatch(/blocked by admin/i);
    expect(d.label).not.toContain('0 / 0'); // a policy denial, not "out of slots"
  });

  it('at quota (remaining === 0): renders 0 remaining / at-cap, distinct from unlimited', () => {
    const d = formatQuota(quota({ mode: 'limited', limit: 5, used: 5, remaining: 0, windowDays: 30 }));
    if (d.kind !== 'limited') throw new Error('expected limited');
    expect(d.remaining).toBe(0);
    expect(d.atCap).toBe(true);
    expect(d.variant).toBe('danger');
    expect(d.label).toContain('0 remaining');
  });

  it('over quota (defensive): renders at/over cap gracefully, never a negative number', () => {
    const d = formatQuota(quota({ mode: 'limited', limit: 5, used: 7, remaining: 0, windowDays: 30 }));
    if (d.kind !== 'limited') throw new Error('expected limited');
    expect(d.remaining).toBe(0);
    expect(d.atCap).toBe(true);
    expect(d.label).not.toMatch(/-\d/);
  });

  it('near cap (remaining low but > 0): flags a warning, not danger', () => {
    const d = formatQuota(quota({ mode: 'limited', limit: 10, used: 9, remaining: 1, windowDays: 30 }));
    if (d.kind !== 'limited') throw new Error('expected limited');
    expect(d.atCap).toBe(false);
    expect(d.variant).toBe('warning');
  });

  it('comfortably under cap: success variant', () => {
    const d = formatQuota(quota({ mode: 'limited', limit: 10, used: 1, remaining: 9, windowDays: 30 }));
    if (d.kind !== 'limited') throw new Error('expected limited');
    expect(d.variant).toBe('success');
  });

  it('singular window: "last 1 day" (no broken pluralization)', () => {
    const d = formatQuota(quota({ mode: 'limited', limit: 5, used: 0, remaining: 5, windowDays: 1 }));
    if (d.kind !== 'limited') throw new Error('expected limited');
    expect(d.windowLabel).toBe('last 1 day');
  });

  it('defensive: limited with a null remaining derives Math.max(0, limit - used)', () => {
    const d = formatQuota({ mode: 'limited', limit: 5, used: 7, remaining: null, windowDays: 30 });
    if (d.kind !== 'limited') throw new Error('expected limited');
    expect(d.remaining).toBe(0);
    expect(d.atCap).toBe(true);
  });
});
