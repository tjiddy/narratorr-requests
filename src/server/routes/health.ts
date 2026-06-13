import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppDeps } from '../services/deps.js';

const healthSchema = z.object({
  status: z.literal('ok'),
  mode: z.enum(['standalone', 'narratorr']),
  authMode: z.enum(['bypass', 'plex']),
});

export function registerHealthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const a = app.withTypeProvider<ZodTypeProvider>();
  a.get('/api/health', { schema: { response: { 200: healthSchema } } }, async () => ({
    status: 'ok' as const,
    mode: deps.config.mode,
    authMode: deps.config.authMode,
  }));
}
