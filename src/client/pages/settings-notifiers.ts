import type {
  KnownNotifierDto,
  CreateNotifierBody,
  NotifierTestBody,
} from '@shared/schemas/connectors';
import {
  NOTIFIER_REGISTRY,
  type NotifierType,
  type NotifierTypeDef,
} from '@shared/notifier-registry';
import { NOTIFICATION_EVENTS, type NotificationEvent } from '@shared/notification-events';

// =============================================================================
// Notifier add/edit form logic — pure functions, unit-tested without a DOM (vitest
// node env), per the `frontend-logic-extract-not-jsdom` learning. The per-type config
// init/build, the omit-to-keep secret encoding, the test-body assembly, and the
// ≥1-event / required-field validation all live here; the React modal only wires inputs
// to this state. The registry (shared) drives which fields exist per type.
// =============================================================================

export interface NotifierFormState {
  /** Present when editing an existing notifier; null for a new one. */
  id: string | null;
  name: string;
  type: NotifierType;
  enabled: boolean;
  events: NotificationEvent[];
  /** Field values keyed by field key — checkbox fields are booleans, the rest strings. */
  fields: Record<string, string | boolean>;
  /** `has<Secret>` flags from the DTO (a stored secret exists) — false for a new notifier. */
  has: Record<string, boolean>;
}

const ALL_EVENT_KEYS = NOTIFICATION_EVENTS.map((e) => e.key);

/** Blank initial field values for a type — checkbox → false, everything else → ''. */
function blankFields(def: NotifierTypeDef): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const f of def.fields) out[f.key] = f.kind === 'checkbox' ? false : '';
  return out;
}

/** A fresh form for adding a notifier of `type` (defaults to all events selected). */
export function newNotifierForm(type: NotifierType): NotifierFormState {
  const def = NOTIFIER_REGISTRY[type];
  return { id: null, name: '', type, enabled: true, events: [...ALL_EVENT_KEYS], fields: blankFields(def), has: {} };
}

/** An edit form seeded from a known notifier DTO — secrets blank (omit-to-keep), `has*` carried. */
export function formFromDto(dto: KnownNotifierDto): NotifierFormState {
  const def = NOTIFIER_REGISTRY[dto.type as NotifierType];
  const config = dto.config as Record<string, unknown>;
  const fields: Record<string, string | boolean> = {};
  const has: Record<string, boolean> = {};
  for (const f of def.fields) {
    const sf = def.secretFields.find((s) => s.field === f.key);
    if (sf) {
      // Secret: input starts blank (means "keep"); record whether one is already stored.
      fields[f.key] = f.kind === 'checkbox' ? false : '';
      has[f.key] = Boolean(config[sf.maskedField]);
    } else if (f.kind === 'checkbox') {
      fields[f.key] = Boolean(config[f.key]);
    } else {
      fields[f.key] = config[f.key] == null ? '' : String(config[f.key]);
    }
  }
  return { id: dto.id, name: dto.name, type: dto.type as NotifierType, enabled: dto.enabled, events: [...dto.events], fields, has };
}

/** Toggle one event key in the form's `events` list (preserving registry order). */
export function toggleEvent(events: NotificationEvent[], key: NotificationEvent): NotificationEvent[] {
  return events.includes(key)
    ? events.filter((e) => e !== key)
    : ALL_EVENT_KEYS.filter((k) => k === key || events.includes(k));
}

const str = (v: string | boolean | undefined): string => (typeof v === 'string' ? v : '');

/**
 * Build the type-specific `config` to send. Secrets are omit-to-keep: a blank input is
 * omitted (the server keeps the stored value); a typed one is included. Optional
 * non-secret text fields collapse blank → null; numbers blank → omitted (server default);
 * checkboxes go through as booleans.
 */
export function buildConfigPayload(def: NotifierTypeDef, state: NotifierFormState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of def.fields) {
    if (f.kind === 'checkbox') {
      out[f.key] = Boolean(state.fields[f.key]);
      continue;
    }
    const raw = str(state.fields[f.key]);
    if (f.secret) {
      // password kept verbatim (may contain spaces); other secrets (URLs) trimmed.
      const v = f.kind === 'password' ? raw : raw.trim();
      if (v !== '') out[f.key] = v;
      continue;
    }
    if (f.kind === 'number') {
      const t = raw.trim();
      if (t !== '') out[f.key] = Number(t);
      continue;
    }
    const t = raw.trim();
    out[f.key] = f.required ? t : t === '' ? null : t;
  }
  return out;
}

/** The create/edit body for the current form (the server validates `config` per type). */
export function buildNotifierBody(state: NotifierFormState): CreateNotifierBody {
  const def = NOTIFIER_REGISTRY[state.type];
  return {
    name: state.name.trim(),
    type: state.type,
    enabled: state.enabled,
    events: state.events,
    config: buildConfigPayload(def, state),
  };
}

/** The candidate test body — same config as a save, plus `id` (edit) + the form's publicUrl. */
export function buildNotifierTestBody(state: NotifierFormState, publicUrl: string | null): NotifierTestBody {
  const def = NOTIFIER_REGISTRY[state.type];
  return {
    type: state.type,
    config: buildConfigPayload(def, state),
    ...(state.id ? { id: state.id } : {}),
    ...(publicUrl !== null ? { publicUrl } : {}),
  };
}

/**
 * Validate the form → a map of field-key → message (empty = valid). `name` non-empty,
 * ≥1 event, required non-secret fields present, and required secrets present on CREATE
 * (on edit a stored secret — `has[key]` — satisfies the requirement; omit-to-keep).
 */
export function validateNotifierForm(state: NotifierFormState): Record<string, string> {
  const def = NOTIFIER_REGISTRY[state.type];
  const errors: Record<string, string> = {};
  if (state.name.trim() === '') errors.name = 'Name is required.';
  if (state.events.length === 0) errors.events = 'Select at least one event.';
  const isCreate = state.id === null;
  for (const f of def.fields) {
    if (!f.required || f.kind === 'checkbox') continue;
    const v = str(state.fields[f.key]).trim();
    if (f.secret) {
      if (v === '' && (isCreate || !state.has[f.key])) errors[f.key] = `${f.label} is required.`;
    } else if (v === '') {
      errors[f.key] = `${f.label} is required.`;
    }
  }
  return errors;
}
