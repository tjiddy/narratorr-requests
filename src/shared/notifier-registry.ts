import { z } from 'zod';
import { httpUrl, ntfyPriority } from './schemas/field-helpers.js';

// =============================================================================
// Notifier registry — the single source of truth for the notifier types the app
// supports, shared between client and server. Each entry declares:
//   • UI field metadata that DRIVES the add/edit form (the client renders inputs
//     from this, NOT by introspecting Zod).
//   • `configSchema` — server-side validation of the write config (plaintext;
//     secrets are omit-to-keep, so they're optional here).
//   • `maskedConfigSchema` — the shape of the masked config in the GET DTO
//     (secrets become has* booleans / host hints; asserted on the way out).
//   • `secretFields` — structured secret metadata the generic mask/reveal/resolve
//     helpers walk (server-side). A capability-URL secret (webhook/Discord/Slack
//     URL) carries a `hintField` so it masks to a host hint, never the full URL.
//
// Adding a future type = a new entry here + a server adapter (notifications/index.ts).
// No switch edits anywhere. The adapter map (type → NotificationChannel) lives
// server-side because adapters pull in server-only deps (nodemailer, fetch).
// =============================================================================

/** The registry keys, as a literal tuple — drives `z.enum` and the `NotifierType` union. */
export const NOTIFIER_TYPES = ['ntfy', 'email', 'webhook'] as const;
export type NotifierType = (typeof NOTIFIER_TYPES)[number];

export type NotifierFieldKind = 'text' | 'password' | 'url' | 'number' | 'select' | 'checkbox';

/** A single form field for a notifier type — the client renders an input from this. */
export interface NotifierField {
  key: string;
  label: string;
  kind: NotifierFieldKind;
  placeholder?: string;
  hint?: string;
  /** A secret value — encrypted at rest, masked in the DTO, omit-to-keep on edit. */
  secret: boolean;
  required: boolean;
  options?: { value: string; label: string }[];
}

/** Structured secret metadata — what the generic mask/reveal/resolve helpers walk. */
export interface NotifierSecretField {
  /** The config key holding the secret. */
  field: string;
  /** The boolean key in the masked DTO (e.g. `hasToken`). */
  maskedField: string;
  /** A required secret must be present on create (no stored value to keep). */
  required?: boolean;
  /** Capability-URL secret: also emit a host hint under this key (never the full URL). */
  hintField?: string;
}

export interface NotifierTypeDef {
  type: NotifierType;
  label: string;
  blurb: string;
  fields: NotifierField[];
  /** Write-path validation: plaintext config; secrets optional (omit-to-keep). */
  configSchema: z.ZodTypeAny;
  /** Masked GET DTO shape — secrets surfaced as has* booleans / host hints, never values. */
  maskedConfigSchema: z.ZodTypeAny;
  secretFields: NotifierSecretField[];
}

// ---- ntfy -------------------------------------------------------------------
const ntfy: NotifierTypeDef = {
  type: 'ntfy',
  label: 'ntfy',
  blurb: 'Push notifications to your phone via ntfy.sh or a self-hosted server.',
  fields: [
    { key: 'url', label: 'Server URL', kind: 'url', placeholder: 'https://ntfy.sh', secret: false, required: true },
    { key: 'topic', label: 'Topic', kind: 'text', placeholder: 'my-narratorr-requests', secret: false, required: true },
    {
      key: 'token',
      label: 'Access token',
      kind: 'password',
      hint: 'Only needed for protected topics.',
      secret: true,
      required: false,
    },
    { key: 'priority', label: 'Priority', kind: 'text', placeholder: 'default', hint: 'Optional: min, low, default, high, or max.', secret: false, required: false },
  ],
  configSchema: z.object({
    url: httpUrl,
    topic: z.string().trim().min(1),
    token: z.string().trim().optional(),
    priority: ntfyPriority.nullable().default(null),
  }),
  maskedConfigSchema: z.object({
    url: z.string(),
    topic: z.string(),
    hasToken: z.boolean(),
    priority: z.string().nullable(),
  }),
  secretFields: [{ field: 'token', maskedField: 'hasToken' }],
};

// ---- email (SMTP) -----------------------------------------------------------
const email: NotifierTypeDef = {
  type: 'email',
  label: 'Email (SMTP)',
  blurb: 'Send notifications to an email address over SMTP.',
  fields: [
    { key: 'host', label: 'SMTP host', kind: 'text', placeholder: 'smtp.example.com', secret: false, required: true },
    { key: 'port', label: 'Port', kind: 'number', placeholder: '587', secret: false, required: false },
    { key: 'secure', label: 'Implicit TLS (port 465) — leave off for STARTTLS (e.g. 587)', kind: 'checkbox', secret: false, required: false },
    { key: 'user', label: 'Username', kind: 'text', hint: 'Optional for open relays.', secret: false, required: false },
    { key: 'pass', label: 'Password', kind: 'password', secret: true, required: false },
    { key: 'from', label: 'From', kind: 'text', placeholder: 'narratorr-request@example.com', secret: false, required: true },
    { key: 'to', label: 'To (admin)', kind: 'text', placeholder: 'you@example.com', secret: false, required: true },
  ],
  configSchema: z.object({
    host: z.string().trim().min(1),
    port: z.coerce.number().int().min(1).max(65535).default(587),
    secure: z.boolean().default(false),
    user: z.string().trim().nullable().default(null),
    pass: z.string().trim().optional(),
    from: z.string().trim().min(1),
    to: z.string().trim().min(1),
  }),
  maskedConfigSchema: z.object({
    host: z.string(),
    port: z.number(),
    secure: z.boolean(),
    user: z.string().nullable(),
    from: z.string(),
    to: z.string(),
    hasPassword: z.boolean(),
  }),
  secretFields: [{ field: 'pass', maskedField: 'hasPassword' }],
};

// ---- webhook / Discord ------------------------------------------------------
// The webhook URL commonly carries a token (Discord/Slack capability URLs), so it is
// itself a secret: encrypted at rest, masked to a host hint, omit-to-keep on edit.
const webhook: NotifierTypeDef = {
  type: 'webhook',
  label: 'Webhook / Discord',
  blurb: 'POST a JSON payload to any endpoint. Works as a Discord webhook URL out of the box.',
  fields: [
    {
      key: 'url',
      label: 'Webhook URL',
      kind: 'url',
      placeholder: 'https://discord.com/api/webhooks/…',
      secret: true,
      required: true,
    },
  ],
  // The URL is a secret (omit-to-keep): a valid http(s) URL, '' to clear, or omitted to keep.
  configSchema: z.object({
    url: httpUrl.or(z.literal('')).optional(),
  }),
  maskedConfigSchema: z.object({
    hasUrl: z.boolean(),
    urlHint: z.string().nullable(),
  }),
  secretFields: [{ field: 'url', maskedField: 'hasUrl', required: true, hintField: 'urlHint' }],
};

export const NOTIFIER_REGISTRY: Record<NotifierType, NotifierTypeDef> = { ntfy, email, webhook };

/** Type guard: is this stored `type` string a key in the registry? */
export function isKnownNotifierType(type: string): type is NotifierType {
  return type in NOTIFIER_REGISTRY;
}

/** All registry entries (stable order), for building the DTO union / iterating types. */
export const NOTIFIER_DEFS: NotifierTypeDef[] = NOTIFIER_TYPES.map((t) => NOTIFIER_REGISTRY[t]);
