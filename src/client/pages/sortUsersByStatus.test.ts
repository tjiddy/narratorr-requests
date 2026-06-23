import { describe, it, expect } from 'vitest';
import type { UserDto } from '@shared/schemas/user';
import { sortUsersByStatus, STATUS_ORDER } from './sortUsersByStatus';

// Minimal fixture — only `publicId` (identity for stability assertions) and
// `status` (the sort key) matter here; the rest are filler to satisfy the type.
const user = (publicId: string, status: UserDto['status']): UserDto => ({
  publicId,
  username: publicId,
  authProvider: 'local',
  email: null,
  thumb: null,
  role: 'user',
  status,
  requestQuota: null,
  autoApprove: false,
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('sortUsersByStatus', () => {
  it('orders pending(0) < active(1) < rejected(2)', () => {
    const sorted = sortUsersByStatus([
      user('a', 'active'),
      user('p', 'pending'),
      user('r', 'rejected'),
      user('p2', 'pending'),
    ]);
    expect(sorted.map((u) => u.status)).toEqual(['pending', 'pending', 'active', 'rejected']);
  });

  it('is stable within an equal status (preserves relative input order)', () => {
    const sorted = sortUsersByStatus([
      user('p1', 'pending'),
      user('p2', 'pending'),
      user('p3', 'pending'),
    ]);
    expect(sorted.map((u) => u.publicId)).toEqual(['p1', 'p2', 'p3']);
  });

  it('empty array → []', () => {
    expect(sortUsersByStatus([])).toEqual([]);
  });

  it('single element → unchanged', () => {
    const sorted = sortUsersByStatus([user('only', 'active')]);
    expect(sorted.map((u) => u.publicId)).toEqual(['only']);
  });

  it('does not mutate the input array', () => {
    const input = [user('a', 'active'), user('p', 'pending')];
    const before = input.map((u) => u.publicId);
    sortUsersByStatus(input);
    expect(input.map((u) => u.publicId)).toEqual(before);
  });

  it('STATUS_ORDER ranks pending first, rejected last', () => {
    expect(STATUS_ORDER.pending).toBeLessThan(STATUS_ORDER.active);
    expect(STATUS_ORDER.active).toBeLessThan(STATUS_ORDER.rejected);
  });
});
