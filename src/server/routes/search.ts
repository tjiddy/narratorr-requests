import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppDeps } from '../services/deps.js';
import { v1AudibleResultSchema, v1MetadataSearchQuerySchema } from '../../shared/schemas/v1/metadata.js';
import { requireActiveUser } from '../plugins/auth.js';

const searchResponseSchema = z.object({ data: z.array(v1AudibleResultSchema) });

/** Authenticated public-catalog search proxy (per-user throttle + shared cache). */
export function registerSearchRoutes(app: FastifyInstance, deps: AppDeps): void {
  const a = app.withTypeProvider<ZodTypeProvider>();
  a.get(
    '/api/search',
    { schema: { querystring: v1MetadataSearchQuerySchema, response: { 200: searchResponseSchema } } },
    async (request) => {
      const user = requireActiveUser(request);
      const data = await deps.search.search(user.id, request.query.q);
      return { data };
    },
  );
}
