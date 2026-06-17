import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services/deps.js';
import { registerHealthRoutes } from './health.js';
import { registerAuthRoutes } from './auth.js';
import { registerSearchRoutes } from './search.js';
import { registerRequestRoutes } from './requests.js';
import { registerAdminRoutes } from './admin.js';
import { registerSettingsRoutes } from './settings.js';

export function registerRoutes(app: FastifyInstance, deps: AppDeps): void {
  registerHealthRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerSearchRoutes(app, deps);
  registerRequestRoutes(app, deps);
  registerAdminRoutes(app, deps);
  registerSettingsRoutes(app, deps);
}
