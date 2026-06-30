import { z } from 'zod';

// =============================================================================
// VENDORED CONTRACT — Narratorr `/api/v1`, build-info probe: GET /api/v1/system.
//
// Source: narratorr #1709 — a native v1 endpoint returning narratorr's own build
// info `{ version, commit, buildTime, nodeVersion, os }` under X-Api-Key auth. We
// consume it to surface the connected narratorr's version + reachability on the
// admin System Information card.
//
// CONSUMER-LENIENT, on purpose (see CLAUDE.md): we assert ONLY `version` (the one
// field we render); everything else is optional and unknown provider fields are
// tolerated (NON-`.strict()`). A response missing `version` fails this schema and
// surfaces as a 502 CONTRACT_MISMATCH inside NarratorrClient.getSystem(), which the
// admin route catches and degrades to `narratorr.state = 'unavailable'`.
//
// NOT to be confused with `/api/v1/system/status` — narratorr's Prowlarr/Readarr
// compat shim, which is the WRONG surface for us to consume.
// =============================================================================
export const v1SystemSchema = z.object({
  version: z.string(),
  commit: z.string().optional(),
  buildTime: z.string().optional(),
  nodeVersion: z.string().optional(),
  os: z.string().optional(),
});

export type V1System = z.infer<typeof v1SystemSchema>;
