import { describe, it, expect } from 'vitest';
import {
  UNIT_DAYS,
  unitToDays,
  daysLabel,
  parseLimit,
  isLimitValid,
  buildDefaultQuota,
  initDefaultQuota,
  isDefaultQuotaDirty,
  type DefaultQuotaState,
} from './settings-default-quota';

const state = (over: Partial<DefaultQuotaState> = {}): DefaultQuotaState => ({ limit: '3', unit: 'week', ...over });

describe('unit ↔ days mapping', () => {
  it('maps each unit to its fixed day count (day=1, week=7, month=30)', () => {
    expect(unitToDays('day')).toBe(1);
    expect(unitToDays('week')).toBe(7);
    expect(unitToDays('month')).toBe(30);
    expect(UNIT_DAYS).toEqual({ day: 1, week: 7, month: 30 });
  });

  it('seeds the form from a DTO, mapping days back to a unit', () => {
    expect(initDefaultQuota({ limit: 3, windowDays: 7 })).toEqual({ limit: '3', unit: 'week' });
    expect(initDefaultQuota({ limit: 5, windowDays: 1 })).toEqual({ limit: '5', unit: 'day' });
    expect(initDefaultQuota({ limit: 10, windowDays: 30 })).toEqual({ limit: '10', unit: 'month' });
  });

  it('seeds a null limit (unlimited) as a blank field', () => {
    expect(initDefaultQuota({ limit: null, windowDays: 30 })).toEqual({ limit: '', unit: 'month' });
  });
});

describe('parseLimit / unlimited handling', () => {
  it('treats blank and 0 as unlimited (null)', () => {
    expect(parseLimit('')).toEqual({ ok: true, value: null });
    expect(parseLimit('   ')).toEqual({ ok: true, value: null });
    expect(parseLimit('0')).toEqual({ ok: true, value: null });
  });

  it('parses a positive integer to its number', () => {
    expect(parseLimit('3')).toEqual({ ok: true, value: 3 });
    expect(parseLimit(' 42 ')).toEqual({ ok: true, value: 42 });
  });

  it('rejects decimals, negatives, and non-numeric input', () => {
    for (const bad of ['3.5', '-1', 'abc', '1e3', '5x', '-0']) {
      expect(parseLimit(bad).ok).toBe(false);
      expect(isLimitValid(bad)).toBe(false);
    }
  });
});

describe('buildDefaultQuota', () => {
  it('builds { limit, windowDays } from the form, blank/0 → null limit', () => {
    expect(buildDefaultQuota(state({ limit: '3', unit: 'week' }))).toEqual({ limit: 3, windowDays: 7 });
    expect(buildDefaultQuota(state({ limit: '', unit: 'month' }))).toEqual({ limit: null, windowDays: 30 });
    expect(buildDefaultQuota(state({ limit: '0', unit: 'day' }))).toEqual({ limit: null, windowDays: 1 });
  });
});

describe('daysLabel', () => {
  it('renders the `= N days` hint for the unit', () => {
    expect(daysLabel('day')).toBe('= 1 days');
    expect(daysLabel('week')).toBe('= 7 days');
    expect(daysLabel('month')).toBe('= 30 days');
  });
});

describe('isDefaultQuotaDirty', () => {
  const saved = initDefaultQuota({ limit: 3, windowDays: 7 }); // { limit: '3', unit: 'week' }

  it('is clean when nothing changed', () => {
    expect(isDefaultQuotaDirty(saved, saved)).toBe(false);
  });

  it('is dirty when the limit changes', () => {
    expect(isDefaultQuotaDirty(state({ limit: '5', unit: 'week' }), saved)).toBe(true);
  });

  it('is dirty when the unit changes', () => {
    expect(isDefaultQuotaDirty(state({ limit: '3', unit: 'month' }), saved)).toBe(true);
  });

  it('treats blank and 0 as the same (both unlimited) — not dirty against each other', () => {
    const unlimited = initDefaultQuota({ limit: null, windowDays: 30 }); // { limit: '', unit: 'month' }
    expect(isDefaultQuotaDirty(state({ limit: '0', unit: 'month' }), unlimited)).toBe(false);
  });

  it('is dirty when an invalid limit is typed (so the Save affordance shows to fix it)', () => {
    expect(isDefaultQuotaDirty(state({ limit: '3.5', unit: 'week' }), saved)).toBe(true);
  });
});
