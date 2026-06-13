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
export const notFound = (message = 'Not found') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const tooManyRequests = (code: string, message: string) => new ApiError(429, code, message);
export const badGateway = (code: string, message: string) => new ApiError(502, code, message);
