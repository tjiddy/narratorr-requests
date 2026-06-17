/**
 * Typed application error → mapped to the v1 error envelope
 * `{ error: { code, message } }` by the error-handler plugin.
 */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (code: string, message: string) => new ApiError(400, code, message);
export const unauthorized = (message = 'Authentication required') =>
  new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Forbidden') => new ApiError(403, 'FORBIDDEN', message);
// Approval-queue states: authenticated but not (yet) allowed to use the app. Distinct
// codes so the client can render the right "pending" vs "rejected" screen.
export const accountPending = (
  message = 'Your account is awaiting approval by an administrator.',
) => new ApiError(403, 'ACCOUNT_PENDING', message);
export const accountRejected = (message = 'Your account was not approved.') =>
  new ApiError(403, 'ACCOUNT_REJECTED', message);
export const notFound = (message = 'Not found') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const tooManyRequests = (code: string, message: string) => new ApiError(429, code, message);
export const badGateway = (code: string, message: string) => new ApiError(502, code, message);
