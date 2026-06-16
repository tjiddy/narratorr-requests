import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppDeps } from '../services/deps.js';
import { decisionBodySchema, requestDtoSchema, requestListQuerySchema } from '../../shared/schemas/request.js';
import { userDtoSchema, updateUserRoleBodySchema } from '../../shared/schemas/user.js';
import { listEnvelope, prefixedId } from '../../shared/schemas/v1/common.js';
import { requireAdmin } from '../plugins/auth.js';
import { badRequest, notFound } from '../util/errors.js';

const pidParams = z.object({ publicId: prefixedId('rq') });
const userPidParams = z.object({ publicId: prefixedId('us') });
const requestListSchema = listEnvelope(requestDtoSchema);
const userListSchema = listEnvelope(userDtoSchema);
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

  // User management — list everyone (admin only).
  a.get(
    '/api/admin/users',
    { schema: { response: { 200: userListSchema } } },
    async (request) => {
      requireAdmin(request);
      const rows = await deps.users.listAll();
      return { data: rows.map((r) => deps.users.toDto(r)), total: rows.length };
    },
  );

  // Promote/demote a user. Self-guard: an admin can never change their OWN role,
  // so they can't accidentally lock the last admin out of the admin surface.
  a.patch(
    '/api/admin/users/:publicId',
    { schema: { params: userPidParams, body: updateUserRoleBodySchema, response: { 200: userDtoSchema } } },
    async (request) => {
      const admin = requireAdmin(request);
      if (request.params.publicId === admin.publicId) {
        throw badRequest('SELF_ROLE', "you can't change your own role");
      }
      const updated = await deps.users.setRole(request.params.publicId, request.body.role);
      return deps.users.toDto(updated);
    },
  );
}
