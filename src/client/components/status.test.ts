import { describe, it, expect } from 'vitest';
import { REQUEST_STATUS_LABELS, REQUEST_STATUS_VARIANT } from './status';
import { REQUEST_STATUSES } from '@shared/schemas/request';
import type { BadgeVariant } from './Badge';

const BADGE_VARIANTS: readonly BadgeVariant[] = ['success', 'warning', 'danger', 'info', 'muted'];

describe('request status maps', () => {
  it('has a non-empty label and a valid variant for every request status', () => {
    for (const status of REQUEST_STATUSES) {
      expect(REQUEST_STATUS_LABELS[status]?.length ?? 0).toBeGreaterThan(0);
      expect(BADGE_VARIANTS).toContain(REQUEST_STATUS_VARIANT[status]);
    }
  });

  it('has no keys beyond the six known statuses', () => {
    const known = new Set<string>(REQUEST_STATUSES);
    expect(Object.keys(REQUEST_STATUS_LABELS).every((k) => known.has(k))).toBe(true);
    expect(Object.keys(REQUEST_STATUS_VARIANT).every((k) => known.has(k))).toBe(true);
    expect(Object.keys(REQUEST_STATUS_LABELS)).toHaveLength(REQUEST_STATUSES.length);
    expect(Object.keys(REQUEST_STATUS_VARIANT)).toHaveLength(REQUEST_STATUSES.length);
  });

  it('applies the user-facing renames', () => {
    expect(REQUEST_STATUS_LABELS.pending).toBe('Requested');
    expect(REQUEST_STATUS_LABELS.acquiring).toBe('Processing');
  });
});
