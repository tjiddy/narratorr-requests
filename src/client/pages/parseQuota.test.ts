import { describe, it, expect } from 'vitest';
import {
  initRequestQuota,
  buildRequestQuota,
  isRequestQuotaValid,
  isRequestQuotaDirty,
  type RequestQuotaState,
} from './parseQuota';
import type { UserDto } from '@shared/schemas/user';

const rq = (q: UserDto['requestQuota']) => q;

describe('initRequestQuota — seeds the control from the saved union', () => {
  it('seeds each non-limited mode with a blank Custom field', () => {
    expect(initRequestQuota(rq({ mode: 'inherit' }))).toEqual({ mode: 'inherit', limit: '' });
    expect(initRequestQuota(rq({ mode: 'unlimited' }))).toEqual({ mode: 'unlimited', limit: '' });
    expect(initRequestQuota(rq({ mode: 'blocked' }))).toEqual({ mode: 'blocked', limit: '' });
  });

  it('seeds a limited override as Custom mode + its cap', () => {
    expect(initRequestQuota(rq({ mode: 'limited', limit: 7 }))).toEqual({ mode: 'limited', limit: '7' });
  });
});

describe('buildRequestQuota — builds the PATCH value per state', () => {
  it('non-limited modes build a bare { mode }', () => {
    expect(buildRequestQuota({ mode: 'inherit', limit: '' })).toEqual({ mode: 'inherit' });
    expect(buildRequestQuota({ mode: 'unlimited', limit: '' })).toEqual({ mode: 'unlimited' });
    expect(buildRequestQuota({ mode: 'blocked', limit: '' })).toEqual({ mode: 'blocked' });
  });

  it('limited builds { mode, limit } from a valid positive cap', () => {
    expect(buildRequestQuota({ mode: 'limited', limit: '5' })).toEqual({ mode: 'limited', limit: 5 });
    expect(buildRequestQuota({ mode: 'limited', limit: ' 12 ' })).toEqual({ mode: 'limited', limit: 12 });
  });

  it('limited with an invalid limit → undefined (caller no-ops, no mutation)', () => {
    for (const bad of ['', '0', '-1', '1.5', 'abc', '1e2', '0x10', '   ']) {
      expect(buildRequestQuota({ mode: 'limited', limit: bad })).toBeUndefined();
    }
  });

  it('non-limited modes ignore a leftover typed limit (restore-on-toggle keeps the value harmless)', () => {
    expect(buildRequestQuota({ mode: 'unlimited', limit: '9' })).toEqual({ mode: 'unlimited' });
  });
});

describe('isRequestQuotaValid', () => {
  it('non-limited modes are always valid', () => {
    expect(isRequestQuotaValid({ mode: 'inherit', limit: '' })).toBe(true);
    expect(isRequestQuotaValid({ mode: 'blocked', limit: 'junk' })).toBe(true);
  });

  it('limited requires a valid positive cap', () => {
    expect(isRequestQuotaValid({ mode: 'limited', limit: '3' })).toBe(true);
    expect(isRequestQuotaValid({ mode: 'limited', limit: '' })).toBe(false);
    expect(isRequestQuotaValid({ mode: 'limited', limit: '0' })).toBe(false);
  });
});

describe('isRequestQuotaDirty', () => {
  const initial: RequestQuotaState = { mode: 'inherit', limit: '' };

  it('clean when nothing changed', () => {
    expect(isRequestQuotaDirty(initial, initial)).toBe(false);
  });

  it('dirty when the mode changed', () => {
    expect(isRequestQuotaDirty({ mode: 'blocked', limit: '' }, initial)).toBe(true);
  });

  it('within limited, dirty only when the effective cap changed', () => {
    const base: RequestQuotaState = { mode: 'limited', limit: '5' };
    expect(isRequestQuotaDirty({ mode: 'limited', limit: '5' }, base)).toBe(false);
    expect(isRequestQuotaDirty({ mode: 'limited', limit: ' 5 ' }, base)).toBe(false);
    expect(isRequestQuotaDirty({ mode: 'limited', limit: '6' }, base)).toBe(true);
    expect(isRequestQuotaDirty({ mode: 'limited', limit: 'bad' }, base)).toBe(true); // invalid → shows Save to fix
  });
});
