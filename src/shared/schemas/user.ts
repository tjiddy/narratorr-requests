import { z } from 'zod';
import { quotaLimitSchema, quotaWindowDaysSchema } from './connectors.js';

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

// Per-user request-quota override as an explicit POLICY MODE (discriminated union), NOT an
// overloaded `number | null`. The four modes are first-class admin intentions:
//   • inherit   — no override; fall back to the app default.
//   • unlimited — no cap for this user, even if the default is limited.
//   • limited   — a per-user positive cap (rides the global rolling window).
//   • blocked   — a hard admin block, distinct from "a cap of 0" (→ 403 QUOTA_BLOCKED).
// Reused as BOTH the read shape (`userDtoSchema.requestQuota`) and the PATCH body field, so the
// mode-first editor loads existing state, not just saves it. A never-overridden user reads `inherit`.
export const requestQuotaSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('inherit') }),
  z.strictObject({ mode: z.literal('unlimited') }),
  z.strictObject({ mode: z.literal('limited'), limit: quotaLimitSchema }),
  z.strictObject({ mode: z.literal('blocked') }),
]);
export type RequestQuota = z.infer<typeof requestQuotaSchema>;
export const REQUEST_QUOTA_MODES = ['inherit', 'unlimited', 'limited', 'blocked'] as const;
export type RequestQuotaMode = (typeof REQUEST_QUOTA_MODES)[number];

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
  requestQuota: requestQuotaSchema, // the four-mode per-user override ({ mode:'inherit' } = app default)
  autoApprove: z.boolean(),
  createdAt: z.string(),
});
export type UserDto = z.infer<typeof userDtoSchema>;

// Admin user management: partial update of a user. All fields optional; strict so
// stray keys are rejected. `requestQuota` omitted = no change; `{ mode:'inherit' }` = fall back to
// the app default. `status` drives the approval queue (approve = active, reject = rejected).
export const updateUserBodySchema = z
  .object({
    role: roleSchema.optional(),
    status: userStatusSchema.optional(),
    requestQuota: requestQuotaSchema.optional(),
    autoApprove: z.boolean().optional(),
  })
  .strict();
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;

// `GET /api/me` — the current user plus their RESOLVED effective rolling-window quota. `mode` is
// authoritative (not `limit === null`): `unlimited` → limit/remaining null; `limited` → positive
// limit + clamped remaining; `blocked` → limit null, remaining 0 (the badge renders "blocked").
export const meDtoSchema = userDtoSchema.extend({
  quota: z.object({
    mode: z.enum(['unlimited', 'limited', 'blocked']),
    limit: z.number().int().positive().nullable(), // null for unlimited & blocked
    used: z.number().int(),
    remaining: z.number().int().nullable(), // null for unlimited
    windowDays: quotaWindowDaysSchema,
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
