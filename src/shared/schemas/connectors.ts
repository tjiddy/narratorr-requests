import { z } from 'zod';

// =============================================================================
// Connector settings — the narratorr connection + notification channels, edited
// on the admin Settings page. Three layers:
//   • StoredConnectors  — shape persisted in app_settings.connectors (secrets ENCRYPTED).
//   • ConnectorSettingsDto — masked GET payload (secrets become has* booleans).
//   • UpdateConnectorSettingsBody — PUT payload (secret omitted = keep, '' = clear).
// =============================================================================

const httpUrl = z
  .string()
  .trim()
  .regex(/^https?:\/\//, 'must be an http(s) URL')
  // Normalize trailing slashes so deep links (`${url}/admin`) and ntfy publish URLs
  // never get a double slash from a pasted base URL (config.ts used to do this).
  .transform((v) => v.replace(/\/+$/, ''));

// ntfy priority: the documented set or a 1-5 digit. A typo would otherwise be sent
// verbatim in the Priority header and silently rejected by ntfy.
const ntfyPriority = z
  .string()
  .trim()
  .regex(/^(min|low|default|high|max|[1-5])$/, 'must be min/low/default/high/max or 1-5');

// narratorr Host: a bare hostname or IP only — no scheme, path, or whitespace. Port,
// SSL, and URL Base are discrete fields; `getNarratorrConfig` composes the base URL
// from them server-side. Internal/private hosts (`narratorr`, `localhost`, `10.x`) are
// intentionally allowed — this is trusted server-to-server admin config, NOT the
// public-only coverUrl SSRF guard (`isInternalHost` in request.ts).
const narratorrHost = z
  .string()
  .trim()
  .min(1)
  .refine((v) => !/[\s/]/.test(v) && !v.includes('://'), 'enter a hostname or IP only, without http(s):// or a path');

// narratorr URL Base: optional reverse-proxy subpath. Normalized to a single leading
// slash and no trailing slash (`lib` → `/lib`, `/lib/` → `/lib`); blank → no subpath.
const urlBase = z
  .string()
  .trim()
  .transform((v) => {
    const trimmed = v.replace(/^\/+/, '').replace(/\/+$/, '');
    return trimmed ? `/${trimmed}` : null;
  });

/**
 * As persisted. Secret fields (narratorr.apiKey, ntfy.token, email.pass) hold
 * `enc:v1:…` strings at rest; structurally identical to the decrypted runtime config.
 */
export interface StoredConnectors {
  publicUrl: string | null;
  narratorr: { host: string; port: number; useSsl: boolean; urlBase: string | null; apiKey: string } | null;
  ntfy: { url: string; topic: string; token: string | null; priority: string | null } | null;
  email: {
    host: string;
    port: number;
    secure: boolean;
    user: string | null;
    pass: string | null;
    from: string;
    to: string;
  } | null;
  webhook: { url: string } | null;
}

// ---- Masked DTO (GET) -------------------------------------------------------
export const connectorSettingsDtoSchema = z.object({
  publicUrl: z.string().nullable(),
  narratorr: z
    .object({
      host: z.string(),
      port: z.number(),
      useSsl: z.boolean(),
      urlBase: z.string().nullable(),
      hasApiKey: z.boolean(),
    })
    .nullable(),
  ntfy: z
    .object({ url: z.string(), topic: z.string(), hasToken: z.boolean(), priority: z.string().nullable() })
    .nullable(),
  email: z
    .object({
      host: z.string(),
      port: z.number(),
      secure: z.boolean(),
      user: z.string().nullable(),
      from: z.string(),
      to: z.string(),
      hasPassword: z.boolean(),
    })
    .nullable(),
  webhook: z.object({ url: z.string() }).nullable(),
});
export type ConnectorSettingsDto = z.infer<typeof connectorSettingsDtoSchema>;

// ---- Per-connector candidate shapes -----------------------------------------
// Shared by the PUT body and the Test body so the candidate sent to Test mirrors a
// save exactly (secrets optional; omit-to-keep). Each is the connector's own object,
// non-`.strict()` per CLAUDE.md (tolerate provider/UI drift on unused nested keys) —
// the .strict() guard lives on the top-level bodies only.
const narratorrConnectorSchema = z.object({
  host: narratorrHost,
  port: z.coerce.number().int().min(1).max(65535),
  useSsl: z.boolean(),
  urlBase: urlBase.nullable().optional(),
  apiKey: z.string().trim().optional(),
});
const ntfyConnectorSchema = z.object({
  url: httpUrl,
  topic: z.string().trim().min(1),
  token: z.string().trim().optional(),
  priority: ntfyPriority.nullable().optional(),
});
const emailConnectorSchema = z.object({
  host: z.string().trim().min(1),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().trim().nullable().optional(),
  pass: z.string().trim().optional(),
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
});
const webhookConnectorSchema = z.object({ url: httpUrl });

// ---- Update body (PUT) ------------------------------------------------------
// Per connector: omitted (undefined) → leave unchanged; null → disable/clear; object → set.
// Secret fields inside: omitted → keep existing secret; '' → clear it; non-empty → replace.
export const updateConnectorSettingsBodySchema = z
  .object({
    publicUrl: httpUrl.nullable().optional(),
    narratorr: narratorrConnectorSchema.nullable().optional(),
    ntfy: ntfyConnectorSchema.nullable().optional(),
    email: emailConnectorSchema.nullable().optional(),
    webhook: webhookConnectorSchema.nullable().optional(),
  })
  .strict();
export type UpdateConnectorSettingsBody = z.infer<typeof updateConnectorSettingsBodySchema>;

// ---- Test a connector -------------------------------------------------------
// The Test body carries the same candidate connector fields as a PUT plus a top-level
// `publicUrl`, so Test validates the CURRENT (unsaved) form values without persisting.
// Secrets stay optional (omit-to-keep → falls back to the stored secret server-side);
// `publicUrl` is not a secret, so an omitted value falls back to the stored one while an
// explicit value (including null) is used as given. Top-level stays `.strict()`.
export const CONNECTOR_KEYS = ['narratorr', 'ntfy', 'email', 'webhook'] as const;
export const testConnectorBodySchema = z
  .object({
    channel: z.enum(CONNECTOR_KEYS),
    publicUrl: httpUrl.nullable().optional(),
    narratorr: narratorrConnectorSchema.nullable().optional(),
    ntfy: ntfyConnectorSchema.nullable().optional(),
    email: emailConnectorSchema.nullable().optional(),
    webhook: webhookConnectorSchema.nullable().optional(),
  })
  .strict();
export type TestConnectorBody = z.infer<typeof testConnectorBodySchema>;

export const testConnectorResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});
export type TestConnectorResult = z.infer<typeof testConnectorResultSchema>;
