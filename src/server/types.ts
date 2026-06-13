import 'fastify';
import type { Role } from '../shared/schemas/user.js';

// The authenticated user attached to every request by the auth plugin. Request
// creation and admin checks build on THIS, never on ad-hoc header parsing
// (Codex risk #1 — the real user boundary, not a retrofit).
export interface AuthUser {
  id: number;
  publicId: string;
  plexUsername: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}
