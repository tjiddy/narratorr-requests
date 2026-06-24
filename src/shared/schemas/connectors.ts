import { z } from 'zod';
import { httpUrl } from './field-helpers.js';
import { notificationEventSchema, type NotificationEvent } from '../notification-events.js';
import { NOTIFIER_DEFS, NOTIFIER_TYPES, type NotifierType } from '../notifier-registry.js';

// =============================================================================
// Connector settings — the narratorr connection + a list of N notifiers, edited on
// the admin Settings page. Layers:
//   • StoredConnectors  — shape persisted in app_settings.connectors (secrets ENCRYPTED).
//   • ConnectorSettingsDto — masked GET payload (secrets become has* / host-hints).
//   • UpdateConnectorSettingsBody — PUT body (publicUrl + narratorr only).
//   • Create/Update/Test notifier bodies — per-notifier CRUD.
//
// Notifiers are a generalized list (Sonarr/Radarr-style Connections): each has a name,
// a type (from the shared registry), the events it fires on, and type-specific config. The registry (src/shared/notifier-registry.ts) is the single
// source of truth for field metadata + config/masked schemas + secret metadata.
// =============================================================================

// narratorr Server URL: the full base URL of the narratorr instance (`http://narratorr:3000`,
// `http://[::1]:3000`, `http://host:3000/lib`). Reuses the shared `httpUrl` helper (scheme
// required, trailing slashes stripped) plus a host-exists refinement so a bare `http://` with
// no host is rejected. Internal/private hosts and IPv6 literals are intentionally allowed —
// this is trusted server-to-server admin config, NOT the public-only coverUrl SSRF guard
// (`isInternalHost` in request.ts). The refinement is narratorr-specific (not folded into the
// shared `httpUrl`) so publicUrl/notifier fields keep their existing, looser behavior.
const narratorrUrl = httpUrl.refine((v) => {
  try {
    return new URL(v).hostname !== '';
  } catch {
    return false;
  }
}, 'enter a valid http(s) URL including a host');

// ---- Stored shape -----------------------------------------------------------
/**
 * A notifier as persisted. `type` is a BARE STRING (not the registry-derived
 * `NotifierType`) and `config` is OPAQUE on purpose: a stored row whose type is no
 * longer in the registry must still parse and round-trip — never be rejected or
 * dropped by the storage boundary. Secret fields inside `config` hold `enc:v1:…`
 * strings at rest. `NotifierType` is applied only when narrowing a known row into its
 * typed config + adapter.
 */
export interface StoredNotifier {
  id: string;
  name: string;
  type: string;
  events: NotificationEvent[];
  config: Record<string, unknown>;
}

/**
 * Type-lenient storage schema for a stored notifier — `type: string`, opaque config.
 * Used to validate/round-trip stored rows; an out-of-registry `type` must still parse.
 */
export const storedNotifierSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  events: z.array(notificationEventSchema),
  config: z.record(z.string(), z.unknown()),
});

/**
 * As persisted. The narratorr secret (apiKey) holds an `enc:v1:…` string at rest;
 * `notifiers` is the generalized notifier list (secrets encrypted inside each config).
 */
export interface StoredConnectors {
  publicUrl: string | null;
  narratorr: { url: string; apiKey: string } | null;
  notifiers: StoredNotifier[];
}

// ---- Masked notifier DTO (GET) ----------------------------------------------
// Discriminated so an unknown stored type is PRESERVED end-to-end, not 500'd:
//   • Known: { id, name, type: <registry key>, events, config: <masked> }
//   • Unknown: { id, name, type: <raw string>, events, unknown: true }
//     — no config, rendered deletable.
const knownNotifierDtoSchemas = NOTIFIER_DEFS.map((def) =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.literal(def.type),
    events: z.array(notificationEventSchema),
    config: def.maskedConfigSchema,
  }),
);

export const unknownNotifierDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  events: z.array(notificationEventSchema),
  unknown: z.literal(true),
});

// z.union wants a >=2 tuple; the spread yields an array, so cast to satisfy the type. The
// inferred type of a ZodTypeAny union collapses to `unknown`, so the DTO TS types below are
// hand-written (discriminated, accurate) — this schema is the runtime/response validator only.
export const notifierDtoSchema = z.union([
  ...knownNotifierDtoSchemas,
  unknownNotifierDtoSchema,
] as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);

/** A known notifier in the masked GET DTO — `config` carries masked secrets (has* / host-hints). */
export interface KnownNotifierDto {
  id: string;
  name: string;
  type: NotifierType;
  events: NotificationEvent[];
  config: Record<string, unknown>;
}
/** A stored notifier whose type is no longer in the registry — deletable, no config. */
export interface UnknownNotifierDto {
  id: string;
  name: string;
  type: string;
  events: NotificationEvent[];
  unknown: true;
}
export type NotifierDto = KnownNotifierDto | UnknownNotifierDto;

// ---- Masked connector-settings DTO (GET) ------------------------------------
export const connectorSettingsDtoSchema = z.object({
  publicUrl: z.string().nullable(),
  narratorr: z
    .object({
      url: z.string(),
      hasApiKey: z.boolean(),
    })
    .nullable(),
  notifiers: z.array(notifierDtoSchema),
});
/** Hand-written (the runtime schema's `notifiers` infers `unknown[]`; this keeps it typed). */
export interface ConnectorSettingsDto {
  publicUrl: string | null;
  narratorr: { url: string; hasApiKey: boolean } | null;
  notifiers: NotifierDto[];
}

// ---- narratorr connector (shared by PUT + Test) -----------------------------
// Non-`.strict()` per CLAUDE.md (tolerate provider/UI drift on unused nested keys) —
// the .strict() guard lives on the top-level bodies only. Secrets optional (omit-to-keep).
const narratorrConnectorSchema = z.object({
  url: narratorrUrl,
  apiKey: z.string().trim().optional(),
});

// ---- Update body (PUT /connectors) ------------------------------------------
// Now carries ONLY publicUrl + narratorr — the notification channels moved to the
// per-notifier CRUD routes. publicUrl: omitted → keep, null → clear, value → set.
export const updateConnectorSettingsBodySchema = z
  .object({
    publicUrl: httpUrl.nullable().optional(),
    narratorr: narratorrConnectorSchema.nullable().optional(),
  })
  .strict();
export type UpdateConnectorSettingsBody = z.infer<typeof updateConnectorSettingsBodySchema>;

// ---- Test the narratorr connection (POST /connectors/test) -------------------
// Probes the CURRENT (unsaved) narratorr form values without persisting. Secrets stay
// optional (omit-to-keep → falls back to the stored secret server-side). Notifier tests
// have their own route + body (notifierTestBodySchema) below.
export const testConnectorBodySchema = z
  .object({
    channel: z.literal('narratorr'),
    narratorr: narratorrConnectorSchema.nullable().optional(),
  })
  .strict();
export type TestConnectorBody = z.infer<typeof testConnectorBodySchema>;

export const testConnectorResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});
export type TestConnectorResult = z.infer<typeof testConnectorResultSchema>;

// ---- Notifier CRUD bodies ----------------------------------------------------
// The envelope is validated here (name/type/events); the type-specific `config`
// is validated server-side against the registry's per-type `configSchema` (the type is
// only known at runtime). `config` stays opaque at this layer.
// Bounds are proportionate (admin-only, single JSON row): a sane `name` ceiling and a
// soft cap on the event list keep a fat-fingered/abusive body from bloating the blob. The
// open `config` record stays unbounded here — each type's `configSchema` constrains it
// downstream (see CLAUDE.md: don't over-engineer the opaque config layer).
const NOTIFIER_NAME_MAX = 100;
const NOTIFIER_EVENTS_MAX = 20;
const notifierWriteBodySchema = z
  .object({
    name: z.string().trim().min(1).max(NOTIFIER_NAME_MAX),
    type: z.enum(NOTIFIER_TYPES),
    events: z.array(notificationEventSchema).min(1).max(NOTIFIER_EVENTS_MAX),
    config: z.record(z.string(), z.unknown()),
  })
  .strict();
export const createNotifierBodySchema = notifierWriteBodySchema;
export const updateNotifierBodySchema = notifierWriteBodySchema;
export type CreateNotifierBody = z.infer<typeof createNotifierBodySchema>;
export type UpdateNotifierBody = z.infer<typeof updateNotifierBodySchema>;

// ---- Test a notifier candidate (POST /notifiers/test) -----------------------
// Fires a sample event through the built channel from the CURRENT (unsaved) form values —
// no save required. `event` selects WHICH sample is sent (the client picks from the
// notifier's selected events) so Test exercises the event the notifier is actually
// configured for; it defaults to `request.created` to preserve the legacy probe when
// omitted. `id` (edit) → omit-to-keep secrets against the stored notifier; absent
// (create) → required secrets must be present. Always returns 200.
export const notifierTestBodySchema = z
  .object({
    type: z.enum(NOTIFIER_TYPES),
    config: z.record(z.string(), z.unknown()),
    event: notificationEventSchema.default('request.created'),
    id: z.string().optional(),
    publicUrl: httpUrl.nullable().optional(),
  })
  .strict();
export type NotifierTestBody = z.infer<typeof notifierTestBodySchema>;
