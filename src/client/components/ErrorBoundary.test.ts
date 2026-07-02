import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ErrorInfo } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * Node-only coverage for the class's lifecycle *wiring* — the seam between React's
 * lifecycle hooks and the pure `error-boundary-state` helpers. The helper unit tests
 * (`error-boundary-state.test.ts`) would all stay green if the class stopped delegating,
 * so these assert the delegation itself. No render / jsdom: we call the static method and
 * instance methods directly.
 */
describe('ErrorBoundary class seam', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts from the recovered (non-errored) state', () => {
    const boundary = new ErrorBoundary({ children: null });
    expect(boundary.state).toEqual({ hasError: false });
  });

  it('getDerivedStateFromError delegates the thrown value into the errored state', () => {
    const error = new Error('boom');
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ hasError: true, error });
    // non-Error throws flow through the same seam
    expect(ErrorBoundary.getDerivedStateFromError('kaboom')).toEqual({ hasError: true, error: 'kaboom' });
  });

  it('componentDidCatch surfaces the error and component stack via console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boundary = new ErrorBoundary({ children: null });
    const error = new Error('boom');
    const info: ErrorInfo = { componentStack: 'at SearchPage' };

    boundary.componentDidCatch(error, info);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]).toContain(error);
    expect(spy.mock.calls[0]).toContain('at SearchPage');
  });
});
