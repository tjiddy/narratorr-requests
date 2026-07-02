/**
 * Pure logic for the route-level {@link ErrorBoundary}. Kept as plain functions (not
 * baked into the class) so it's unit-testable in the repo's node-only vitest project
 * without standing up jsdom — see the `frontend-logic-extract-not-jsdom` learning and the
 * co-located `book-card-state` / `status` helpers.
 */

/** Errored → carries the thrown value; recovered → no error. */
export type ErrorBoundaryState = { hasError: false } | { hasError: true; error: unknown };

/** The boundary's initial / reset state (a pure reset helper, testable + reusable). */
export function resetErrorState(): ErrorBoundaryState {
  return { hasError: false };
}

/**
 * The `getDerivedStateFromError` reducer: a pure function of the thrown value → next
 * state. Any value can be thrown in JS (not just `Error`), so `error` is `unknown` and
 * gets normalized for display by {@link errorMessage}.
 */
export function deriveErrorState(error: unknown): ErrorBoundaryState {
  return { hasError: true, error };
}

/**
 * A human-displayable message for any thrown value. Guards the non-`Error` cases (a bare
 * string, an object with no `.message`, `null`/`undefined`) so the fallback never crashes
 * reaching for `.message`.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim() !== '') return error;
  return 'Something went wrong while rendering this page.';
}

/**
 * Surface the thrown error for diagnosis (AC4) — a single seam over `console.error` so the
 * logging path is verifiable in node without a DOM render. Called from `componentDidCatch`.
 */
export function logBoundaryError(error: unknown, componentStack?: string | null): void {
  console.error('[ErrorBoundary] Uncaught render error:', error, componentStack ?? '');
}
