import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  deriveErrorState,
  resetErrorState,
  errorMessage,
  logBoundaryError,
} from './error-boundary-state';

describe('deriveErrorState', () => {
  it('carries a thrown Error into the errored state', () => {
    const error = new Error('boom');
    expect(deriveErrorState(error)).toEqual({ hasError: true, error });
  });

  it('carries a non-Error thrown value (string / object) into the errored state', () => {
    expect(deriveErrorState('kaboom')).toEqual({ hasError: true, error: 'kaboom' });
    const obj = { code: 42 };
    expect(deriveErrorState(obj)).toEqual({ hasError: true, error: obj });
  });
});

describe('resetErrorState', () => {
  it('returns a non-errored state (the recover / initial path)', () => {
    expect(resetErrorState()).toEqual({ hasError: false });
  });
});

describe('errorMessage', () => {
  it('uses an Error’s own message', () => {
    expect(errorMessage(new Error('specific failure'))).toBe('specific failure');
  });

  it('falls back for a non-Error value without crashing on .message', () => {
    expect(errorMessage({ not: 'an error' })).toBe('Something went wrong while rendering this page.');
    expect(errorMessage(undefined)).toBe('Something went wrong while rendering this page.');
    expect(errorMessage(null)).toBe('Something went wrong while rendering this page.');
  });

  it('uses a non-empty thrown string, but falls back for an empty / whitespace one', () => {
    expect(errorMessage('a plain string throw')).toBe('a plain string throw');
    expect(errorMessage('')).toBe('Something went wrong while rendering this page.');
    expect(errorMessage('   ')).toBe('Something went wrong while rendering this page.');
  });

  it('falls back for an Error with an empty message', () => {
    expect(errorMessage(new Error(''))).toBe('Something went wrong while rendering this page.');
  });
});

describe('logBoundaryError', () => {
  afterEach(() => vi.restoreAllMocks());

  it('surfaces the error for diagnosis via console.error (AC4)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('boom');
    logBoundaryError(error, 'at SearchPage');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]).toContain(error);
  });

  it('tolerates a missing component stack', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logBoundaryError('kaboom');
    expect(spy).toHaveBeenCalledOnce();
  });
});
