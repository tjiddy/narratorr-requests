import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppDeps } from '../services/deps.js';
import { decisionBodySchema, requestDtoSchema, requestListQuerySchema } from '../../shared/schemas/request.js';
import { listEnvelope } from '../../shared/schemas/v1/common.js';
import { requireAdmin } from '../plugins/auth.js';
import { notFound } from '../util/errors.js';

const pidParams = z.object({ publicId: z.string() });
const requestListSchema = listEnvelope(requestDtoSchema);
const DEFAULT_LIMIT = 50;

export function registerAdminRoutes(app: FastifyInstance, deps: AppDeps): void {
  const a = app.withTypeProvider<ZodTypeProvider>();

  // Admin queue — all users' requests, defaulting to the pending review queue.
  a.get(
    '/api/admin/requests',
    { schema: { querystring: requestListQuerySchema, response: { 200: requestListSchema } } },
    async (request) => {
      requireAdmin(request);
      return deps.requests.list({
        ...(request.query.status !== undefined ? { status: request.query.status } : {}),
        limit: request.query.limit ?? DEFAULT_LIMIT,
        offset: request.query.offset ?? 0,
      });
    },
  );

  // Approve/deny. Approve immediately hands the request off to Narratorr.
  a.post(
    '/api/admin/requests/:publicId/decision',
    { schema: { params: pidParams, body: decisionBodySchema, response: { 200: requestDtoSchema } } },
    async (request) => {
      const admin = requireAdmin(request);
      const row = await deps.requests.decide(admin.id, request.params.publicId, request.body);
      const requester = await deps.users.getById(row.userId);
      if (!requester) throw notFound('requester not found');
      return deps.requests.toDto(row, {
        publicId: requester.publicId,
        plexUsername: requester.plexUsername,
      });
    },
  );
}
