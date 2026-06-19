import { z } from 'zod';

// Roles this app owns. MVP auto-approves admins only (PLAN decision #5); a
// "trusted" role can be added later without a migration churn.
export const USER_ROLES = ['admin', 'user'] as const;
export const roleSchema = z.enum(USER_ROLES);
export type Role = z.infer<typeof roleSchema>;

// Account approval state, ORTHOGONAL to role. A new user authenticates but lands
// `pending` and can't request until an admin approves. `rejected` is a durable
// denial (survives re-login — never silently re-opens). Admins are always treated
// as active. The first user in any auth method is created active (+ admin).
export const USER_STATUSES = ['pending', 'active', 'rejected'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

// Shape returned to the client for a user.
export const userDtoSchema = z.object({
  publicId: z.string(),
  username: z.string(),
  // Which auth method this identity came from (e.g. 'local', 'plex', 'authelia',
  // or a configured OIDC provider id). Display-only on the client.
  authProvider: z.string(),
  email: z.string().nullable(),
  thumb: z.string().nullable(),
  role: roleSchema,
  status: userStatusSchema,
  requestQuota: z.number().int().nullable(), // null = use the app default
  autoApprove: z.boolean(),
  createdAt: z.string(),
});
export type UserDto = z.infer<typeof userDtoSchema>;

// Admin user management: partial update of a user. All fields optional; strict so
// stray keys are rejected. requestQuota null = fall back to the app default.
// `status` drives the approval queue (approve = active, reject = rejected).
export const updateUserBodySchema = z
  .object({
    role: roleSchema.optional(),
    status: userStatusSchema.optional(),
    requestQuota: z.number().int().min(0).nullable().optional(),
    autoApprove: z.boolean().optional(),
  })
  .strict();
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;

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

// --- Auth: login screen + local auth ----------------------------------------

// Server-driven login screen. The client renders the password form when `local`
// is true, plus one button per configured OIDC provider. Server is source of truth.
export const authProvidersDtoSchema = z.object({
  local: z.boolean(),
  providers: z.array(z.object({ id: z.string(), label: z.string() })),
});
export type AuthProvidersDto = z.infer<typeof authProvidersDtoSchema>;

// Local-auth credentials. Email is the login identity (lowercased → the stable subject
// key) and doubles as the user's contact + display source. Password floor is 8 (length is
// the cheap, effective lever).
export const localCredentialsSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email('enter a valid email address').max(254)),
    password: z.string().min(8, 'password must be at least 8 characters').max(200),
  })
  .strict();
export type LocalCredentials = z.infer<typeof localCredentialsSchema>;
