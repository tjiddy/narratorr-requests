import fp from 'fastify-plugin';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ApiError } from '../util/errors.js';
import { NarratorrError } from '../services/narratorr-client.js';
import { errorBody } from '../../shared/schemas/v1/common.js';

function isValidationError(error: FastifyError | Error): boolean {
  if ('validation' in error && (error as FastifyError).validation) return true;
  const code = (error as { code?: string }).code;
  return code === 'FST_ERR_VALIDATION';
}

/**
 * Translates thrown errors into the v1 error envelope `{ error: { code, message } }`.
 * Typed `ApiError`s carry their own status/code; Fastify/Zod validation failures
 * become 400 BAD_REQUEST; anything else is a 500 with a generic message (no leak).
 */
async function errorHandlerInner(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof ApiError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, code: error.code }, error.message);
        // "Narratorr not configured" is a deliberately user-facing, leak-free message
        // (the normal state on a fresh install) — let it through the 5xx scrub with a
        // 503 so the client shows "set it up in Settings" instead of "try again".
        if (error instanceof NarratorrError && error.upstreamCode === 'NOT_CONFIGURED') {
          return reply.status(503).send(errorBody('NOT_CONFIGURED', error.message));
        }
        // Otherwise keep the machine-readable code but never leak internal/upstream
        // detail (e.g. NarratorrError's "Narratorr GET … failed") to the browser.
        const publicMessage =
          error.statusCode === 502 || error.statusCode === 503 || error.statusCode === 504
            ? 'A required service is temporarily unavailable. Please try again.'
            : 'Internal server error';
        return reply.status(error.statusCode).send(errorBody(error.code, publicMessage));
      }
      request.log.warn({ code: error.code }, error.message);
      return reply.status(error.statusCode).send(errorBody(error.code, error.message));
    }

    if (isValidationError(error)) {
      request.log.warn({ err: error }, 'validation error');
      return reply.status(400).send(errorBody('BAD_REQUEST', error.message));
    }

    // Rate-limit rejections arrive as a plain error carrying statusCode 429 (the limiter
    // normally formats its own response via errorResponseBuilder; this is belt-and-braces
    // so a throttle can never masquerade as a 500 and skew 5xx dashboards).
    if ((error as { statusCode?: number }).statusCode === 429) {
      request.log.warn({ err: error }, 'rate limited');
      return reply.status(429).send(errorBody('RATE_LIMITED', 'Too many attempts. Please wait and try again.'));
    }

    request.log.error({ err: error }, error.message || 'Unhandled error');
    return reply.status(500).send(errorBody('INTERNAL', 'Internal server error'));
  });
}

export const errorHandlerPlugin = fp(errorHandlerInner, { name: 'error-handler' });
