import { z } from 'zod';

// Response contract for OUR admin-only `GET /api/admin/system` (the System Information
// card). Lives in `src/shared/schemas/` so both the server route and the client can
// import it without the client reaching into server-only route code.
//
// The WIRE carries raw values only — all humanization (db-size label, the narratorr
// display line) happens in the client pure helpers (see src/client/pages/system-info.ts),
// never here.

/**
 * Reachability of the connected narratorr, inferred from the `getSystem()` fetch:
 * - `connected`      — getSystem() returned a `version`.
 * - `not_configured` — narratorr holder unconfigured (no upstream call attempted).
 * - `unreachable`    — network error / timeout / non-2xx upstream.
 * - `unavailable`    — reachable but the body failed the vendored contract
 *                      (CONTRACT_MISMATCH), or any other caught error.
 */
export const narratorrSystemStateSchema = z.enum([
  'connected',
  'unreachable',
  'not_configured',
  'unavailable',
]);
export type NarratorrSystemState = z.infer<typeof narratorrSystemStateSchema>;

export const systemInfoSchema = z.object({
  /** Build-time branch + short SHA, or "dev" when not baked (local build / dev). */
  version: z.string(),
  /** ISO-8601 build timestamp, or null when not baked. */
  builtAt: z.string().nullable(),
  /** `process.version`, e.g. "v24.10.0". */
  node: z.string(),
  /** `${os.type()} ${os.release()}`. */
  os: z.string(),
  /** From `fs.stat` on `config.databasePath`; null on ANY stat failure / non-regular file. */
  databaseSizeBytes: z.number().nullable(),
  narratorr: z.object({
    state: narratorrSystemStateSchema,
    /** Present only when state === 'connected'. */
    version: z.string().optional(),
    commit: z.string().optional(),
  }),
});

export type SystemInfoDto = z.infer<typeof systemInfoSchema>;
