import { describe, it, expect } from 'vitest';
import { isUniqueViolation } from './db.js';

describe('isUniqueViolation', () => {
  it('classifies a RangeError as not-a-unique-violation (guards the race path)', () => {
    // A RangeError is a value/programmer error, never a constraint breach — it must not
    // be swallowed by the insert-time race-resolution catch.
    expect(isUniqueViolation(new RangeError('out of range'))).toBe(false);
  });

  it('matches the libSQL UNIQUE constraint message', () => {
    expect(
      isUniqueViolation(new Error('UNIQUE constraint failed: requests.user_id, requests.asin')),
    ).toBe(true);
  });

  it('matches an error whose message mentions SQLITE_CONSTRAINT', () => {
    expect(isUniqueViolation(new Error('SQLITE_CONSTRAINT: ...'))).toBe(true);
  });

  it('does not match a plain non-constraint error', () => {
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
  });

  it('stringifies and classifies a non-Error value without throwing', () => {
    expect(isUniqueViolation('UNIQUE constraint failed: x')).toBe(true);
    expect(isUniqueViolation('boom')).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it('documents the broad SQLITE_CONSTRAINT arm (FK/CHECK/NOT-NULL also match today)', () => {
    // Known limitation: the regex is broader than SQLITE_CONSTRAINT_UNIQUE, so a FK or
    // CHECK breach also routes into the re-query path. Pinned so any future narrowing is
    // a deliberate, test-visible change.
    expect(isUniqueViolation(new Error('SQLITE_CONSTRAINT_FOREIGNKEY: FOREIGN KEY constraint failed'))).toBe(true);
  });
});
