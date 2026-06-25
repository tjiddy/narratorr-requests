import type {
  KnownNotifierDto,
  CreateNotifierBody,
  NotifierTestBody,
} from '@shared/schemas/connectors';
import {
  NOTIFIER_REGISTRY,
  type NotifierField,
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
  events: NotificationEvent[];
  /** Field values keyed by field key — checkbox fields are booleans, the rest strings. */
  fields: Record<string, string | boolean>;
  /** `has<Secret>` flags from the DTO (a stored secret exists) — false for a new notifier. */
  has: Record<string, boolean>;
  /**
   * Per-field "clear the stored value" flags, keyed by field key. Only meaningful for an
   * already-saved OPTIONAL secret (the UI exposes the affordance only then). A non-empty
   * input always wins over this flag (see `buildConfigPayload`).
   */
  clear: Record<string, boolean>;
}

const ALL_EVENT_KEYS = NOTIFICATION_EVENTS.map((e) => e.key);

/**
 * Blank initial field values for a type — a checkbox seeds from its registry `defaultValue`
 * (so Discord `includeCover` starts ON) falling back to `false`; everything else → ''.
 */
function blankFields(def: NotifierTypeDef): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const f of def.fields) out[f.key] = f.kind === 'checkbox' ? (f.defaultValue ?? false) : '';
  return out;
}

/** A fresh form for adding a notifier of `type` (defaults to all events selected). */
export function newNotifierForm(type: NotifierType): NotifierFormState {
  const def = NOTIFIER_REGISTRY[type];
  return { id: null, name: '', type, events: [...ALL_EVENT_KEYS], fields: blankFields(def), has: {}, clear: {} };
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
  return { id: dto.id, name: dto.name, type: dto.type as NotifierType, events: [...dto.events], fields, has, clear: {} };
}

/** Toggle one event key in the form's `events` list (preserving registry order). */
export function toggleEvent(events: NotificationEvent[], key: NotificationEvent): NotificationEvent[] {
  return events.includes(key)
    ? events.filter((e) => e !== key)
    : ALL_EVENT_KEYS.filter((k) => k === key || events.includes(k));
}

const str = (v: string | boolean | undefined): string => (typeof v === 'string' ? v : '');

/**
 * Build the type-specific `config` to send. Secrets follow a single deterministic
 * precedence ladder (first match wins), applied per secret field:
 *   1. Input non-empty → send the typed value (replacement; the clear flag is ignored).
 *   2. Input blank AND clear selected (optional secret only) → emit `''` (server's clear
 *      sentinel — a REQUIRED secret never reaches here, so it can't be cleared).
 *   3. Input blank, clear not selected → omit the field (server keeps the stored value).
 * Optional non-secret text fields collapse blank → null; numbers blank → omitted (server
 * default); checkboxes go through as booleans.
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
      if (v !== '') {
        out[f.key] = v; // rung 1: replacement wins
      } else if (!f.required && state.clear[f.key]) {
        out[f.key] = ''; // rung 2: clear sentinel (optional secrets only)
      }
      // rung 3: blank + no clear → omit (keep stored)
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
    events: state.events,
    config: buildConfigPayload(def, state),
  };
}

/**
 * The candidate test body — same config as a save, plus the `event` to sample, `id` (edit)
 * and the form's publicUrl. `event` defaults to the first selected event so Test exercises
 * what the notifier actually fires on. Returns `null` when no event is selected (a
 * leniently-stored zero-event notifier): the caller hides/disables Test rather than send.
 */
export function buildNotifierTestBody(state: NotifierFormState, publicUrl: string | null): NotifierTestBody | null {
  const event = state.events[0];
  if (event === undefined) return null;
  const def = NOTIFIER_REGISTRY[state.type];
  return {
    type: state.type,
    event,
    config: buildConfigPayload(def, state),
    ...(state.id ? { id: state.id } : {}),
    ...(publicUrl !== null ? { publicUrl } : {}),
  };
}

/**
 * Whether to render the "clear stored value" affordance for a field: an already-saved
 * (`has[key]`) OPTIONAL secret only — never a required secret, never an unsaved one.
 */
export function showClearAffordance(field: NotifierField, state: NotifierFormState): boolean {
  return field.secret && !field.required && Boolean(state.has[field.key]);
}

/**
 * The hint text under a notifier field input. Secret-aware: a stored optional secret
 * advertises replace-or-clear; a stored required secret advertises keep-on-blank; an
 * unsaved secret (and any non-secret) falls back to the field's own hint.
 */
export function secretFieldHint(field: NotifierField, state: NotifierFormState): string | undefined {
  if (!field.secret) return field.hint;
  if (!state.has[field.key]) return field.hint;
  return field.required
    ? 'Leave blank to keep the current value.'
    : 'Type a new value to replace it, or use “Clear stored value” to remove it.';
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
