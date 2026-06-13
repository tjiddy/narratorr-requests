import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppDeps } from '../services/deps.js';

const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['ok', 'down']),
  mode: z.enum(['standalone', 'narratorr']),
  authMode: z.enum(['bypass', 'plex']),
});

/** Liveness + readiness: confirms the DB is actually reachable, not just that the process is up. */
export function registerHealthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const a = app.withTypeProvider<ZodTypeProvider>();
  a.get(
    '/api/health',
    { schema: { response: { 200: healthSchema, 503: healthSchema } } },
    async (_request, reply) => {
      let db: 'ok' | 'down' = 'ok';
      try {
        await deps.db.run(sql`select 1`);
      } catch {
        db = 'down';
      }
      const body = {
        status: db === 'ok' ? ('ok' as const) : ('degraded' as const),
        db,
        mode: deps.config.mode,
        authMode: deps.config.authMode,
      };
      return db === 'ok' ? body : reply.status(503).send(body);
    },
  );
}
