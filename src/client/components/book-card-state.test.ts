import { describe, it, expect } from 'vitest';
import { resolveBookCardState } from './book-card-state';
import type { V1AudibleResult } from '@shared/schemas/v1/metadata';

const lib = (status: NonNullable<V1AudibleResult['library']>['status'], bookId = 'bk_1') =>
  ({ bookId, status }) satisfies V1AudibleResult['library'];

describe('resolveBookCardState', () => {
  it('shows the Request button when nothing is known (no library, no request)', () => {
    expect(resolveBookCardState(undefined, undefined)).toEqual({ kind: 'request' });
    expect(resolveBookCardState(null, undefined)).toEqual({ kind: 'request' });
  });

  it('shows the viewer’s own request status when they have one and the book isn’t imported', () => {
    expect(resolveBookCardState(undefined, 'pending')).toEqual({ kind: 'request-status', status: 'pending' });
    expect(resolveBookCardState(null, 'denied')).toEqual({ kind: 'request-status', status: 'denied' });
  });

  it('shows "In library" for an imported book — even over the viewer’s own request row', () => {
    expect(resolveBookCardState(lib('imported'), undefined)).toMatchObject({ kind: 'library', label: 'In library' });
    // imported wins over a stale personal request — the import IS that request's outcome.
    expect(resolveBookCardState(lib('imported'), 'pending')).toMatchObject({ kind: 'library', label: 'In library' });
  });

  it('shows "On the way" for an in-flight library book when the viewer has no request of their own', () => {
    for (const s of ['wanted', 'searching', 'downloading', 'importing'] as const) {
      expect(resolveBookCardState(lib(s), undefined)).toMatchObject({ kind: 'library', label: 'On the way', pulse: true });
    }
  });

  it('lets the viewer’s own request outrank an in-flight library row owned by others', () => {
    expect(resolveBookCardState(lib('downloading'), 'pending')).toEqual({ kind: 'request-status', status: 'pending' });
  });

  it('falls back to the Request button for a failed/missing library book and no personal request', () => {
    expect(resolveBookCardState(lib('failed'), undefined)).toEqual({ kind: 'request' });
    expect(resolveBookCardState(lib('missing'), undefined)).toEqual({ kind: 'request' });
  });
});
