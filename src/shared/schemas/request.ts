import { z } from 'zod';

// =============================================================================
// Request lifecycle (this app's domain). Maps onto Narratorr status:
//   pending --approve--> approved --handoff(POST /acquisitions)--> acquiring
//   --poll(GET /acquisitions/:id imported)--> available
//   denied / failed are terminal.
// =============================================================================
export const REQUEST_STATUSES = [
  'pending',
  'approved',
  'denied',
  'acquiring',
  'available',
  'failed',
] as const;
export const requestStatusSchema = z.enum(REQUEST_STATUSES);
export type RequestStatus = z.infer<typeof requestStatusSchema>;

/**
 * "Open" = still occupying a quota slot and still de-duplicated against new
 * requests for the same book. `failed` is excluded here (refunded) unless it
 * was user-caused — that nuance lives in the quota query, not this list.
 */
export const OPEN_REQUEST_STATUSES = ['pending', 'approved', 'acquiring', 'available'] as const;

/** Statuses that block a duplicate open request for the same (user, asin). */
export const ACTIVE_REQUEST_STATUSES = ['pending', 'approved', 'acquiring'] as const;

// Snapshot fields are denormalized onto the request at create time so the queue
// renders even if the upstream catalog entry changes or disappears.
export const createRequestBodySchema = z
  .object({
    asin: z.string().trim().min(1),
    title: z.string().trim().min(1),
    author: z.string().trim().nullish(),
    narrator: z.string().trim().nullish(),
    // https-only: a request-supplied coverUrl is rendered in the admin's browser, so
    // reject javascript:/data:/internal-http: to avoid SSRF-ish loads and abuse.
    coverUrl: z.string().trim().regex(/^https:\/\//, 'coverUrl must be an https URL').nullish(),
    note: z.string().trim().max(500).nullish(),
  })
  .strict();
export type CreateRequestBody = z.infer<typeof createRequestBodySchema>;

// Admin approve/deny.
export const decisionBodySchema = z
  .object({
    action: z.enum(['approve', 'deny']),
    note: z.string().trim().max(500).nullish(),
  })
  .strict();
export type DecisionBody = z.infer<typeof decisionBodySchema>;

export const requestListQuerySchema = z.object({
  status: requestStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type RequestListQuery = z.infer<typeof requestListQuerySchema>;

// Shape returned to the client. `requester` is included for the admin queue;
// `acquisitionStatus` is the live projection the poller refreshes.
export const requestDtoSchema = z.object({
  publicId: z.string(),
  asin: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  narrator: z.string().nullable(),
  coverUrl: z.string().nullable(),
  status: requestStatusSchema,
  note: z.string().nullable(),
  requestedAt: z.string(),
  decidedAt: z.string().nullable(),
  narratorrBookId: z.string().nullable(),
  narratorrAcquisitionId: z.string().nullable(),
  requester: z.object({ publicId: z.string(), plexUsername: z.string() }),
});
export type RequestDto = z.infer<typeof requestDtoSchema>;
