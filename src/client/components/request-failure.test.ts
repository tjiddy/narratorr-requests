import { describe, it, expect } from 'vitest';
import { requestFailureReason } from './request-failure';
import type { RequestDto } from '@shared/schemas/request';

const r = (over: Partial<Pick<RequestDto, 'status' | 'failureReason'>>): Pick<RequestDto, 'status' | 'failureReason'> => ({
  status: 'failed',
  failureReason: null,
  ...over,
});

describe('requestFailureReason', () => {
  it('returns the reason for a failed request that carries one', () => {
    expect(requestFailureReason(r({ status: 'failed', failureReason: 'Download failed upstream.' }))).toBe(
      'Download failed upstream.',
    );
  });

  it('returns null for a failed request with no reason (renders nothing)', () => {
    expect(requestFailureReason(r({ status: 'failed', failureReason: null }))).toBeNull();
  });

  it('ignores a reason on a non-failed request', () => {
    for (const status of ['pending', 'approved', 'acquiring', 'available', 'denied'] as const) {
      expect(requestFailureReason(r({ status, failureReason: 'leftover' }))).toBeNull();
    }
  });
});
