import { z } from 'zod';

// Roles this app owns. MVP auto-approves admins only (PLAN decision #5); a
// "trusted" role can be added later without a migration churn.
export const USER_ROLES = ['admin', 'user'] as const;
export const roleSchema = z.enum(USER_ROLES);
export type Role = z.infer<typeof roleSchema>;

// Shape returned to the client for a user.
export const userDtoSchema = z.object({
  publicId: z.string(),
  plexUsername: z.string(),
  email: z.string().nullable(),
  thumb: z.string().nullable(),
  role: roleSchema,
  requestQuota: z.number().int().nullable(), // null = unlimited
  createdAt: z.string(),
});
export type UserDto = z.infer<typeof userDtoSchema>;

// Admin user management: change a user's role. Strict so stray fields are rejected.
export const updateUserRoleBodySchema = z.object({ role: roleSchema }).strict();
export type UpdateUserRoleBody = z.infer<typeof updateUserRoleBodySchema>;

// `GET /api/me` — the current user plus their rolling-window quota usage.
export const meDtoSchema = userDtoSchema.extend({
  quota: z.object({
    limit: z.number().int().nullable(), // null = unlimited
    used: z.number().int(),
    remaining: z.number().int().nullable(), // null = unlimited
    windowDays: z.number().int(),
  }),
});
export type MeDto = z.infer<typeof meDtoSchema>;
