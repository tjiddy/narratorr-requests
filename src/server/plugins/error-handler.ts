import fp from 'fastify-plugin';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ApiError } from '../util/errors.js';
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
      if (error.statusCode >= 500) request.log.error({ err: error, code: error.code }, error.message);
      else request.log.warn({ code: error.code }, error.message);
      return reply.status(error.statusCode).send(errorBody(error.code, error.message));
    }

    if (isValidationError(error)) {
      request.log.warn({ err: error }, 'validation error');
      return reply.status(400).send(errorBody('BAD_REQUEST', error.message));
    }

    request.log.error({ err: error }, error.message || 'Unhandled error');
    return reply.status(500).send(errorBody('INTERNAL', 'Internal server error'));
  });
}

export const errorHandlerPlugin = fp(errorHandlerInner, { name: 'error-handler' });
