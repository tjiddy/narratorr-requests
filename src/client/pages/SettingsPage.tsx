import { useState, type ReactNode } from 'react';
import type { ConnectorSettingsDto, NotifierDto, KnownNotifierDto, TestConnectorBody } from '@shared/schemas/connectors';
import { NOTIFIER_REGISTRY, NOTIFIER_TYPES, type NotifierType, type NotifierField } from '@shared/notifier-registry';
import { NOTIFICATION_EVENTS } from '@shared/notification-events';
import {
  useConnectorSettings,
  useUpdateConnectors,
  useTestConnector,
  useCreateNotifier,
  useUpdateNotifier,
  useDeleteNotifier,
  useTestNotifier,
} from '../hooks';
import { Button } from '../components/Button';
import { initNarratorr, buildNarratorr, connectionFormKey, type NarratorrState } from './settings-narratorr';
import {
  newNotifierForm,
  formFromDto,
  toggleEvent,
  buildNotifierBody,
  buildNotifierTestBody,
  validateNotifierForm,
  type NotifierFormState,
} from './settings-notifiers';

const inputCls =
  'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50';

const secretPlaceholder = (has: boolean, required = false) =>
  has ? '•••••••• (unchanged)' : required ? 'required' : 'optional';

function Field({ label, hint, error, children }: { label: string; hint?: string | undefined; error?: string | undefined; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-destructive">{error}</span>
      ) : (
        hint && <span className="text-xs text-muted-foreground/70">{hint}</span>
      )}
    </label>
  );
}

/** Discriminate the masked notifier DTO: a known type carries `config`; unknown carries `unknown`. */
function isKnownNotifier(n: NotifierDto): n is KnownNotifierDto {
  return !('unknown' in n && n.unknown);
}

export function SettingsPage() {
  const { data, isLoading, error } = useConnectorSettings();

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect to narratorr and configure how you’re notified about new requests and signups.
        </p>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground/70">Loading…</p>}
      {error && <p className="text-sm text-destructive">Could not load settings.</p>}
      {/* Key on ONLY the connection slice (not the notifier list) so a notifier mutation's
          refetch doesn't remount the form and discard unsaved connection edits; a real
          connection save changes the slice and reseeds freshly-masked secrets + has* flags. */}
      {data && <SettingsForm key={connectionFormKey(data)} initial={data} />}
    </div>
  );
}

type Patch<T> = (p: Partial<T>) => void;

function SettingsForm({ initial }: { initial: ConnectorSettingsDto }) {
  const update = useUpdateConnectors();

  const [publicUrl, setPublicUrl] = useState(initial.publicUrl ?? '');
  const [narr, setNarr] = useState(() => initNarratorr(initial.narratorr));
  const patchNarr: Patch<NarratorrState> = (p) => setNarr((s) => ({ ...s, ...p }));

  const candidatePublicUrl = publicUrl.trim() || null;
  const narratorrTestBody: TestConnectorBody = { channel: 'narratorr', narratorr: buildNarratorr(narr) };

  function save() {
    update.mutate({ publicUrl: candidatePublicUrl, narratorr: buildNarratorr(narr) });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* General */}
      <div className="glass-card flex flex-col gap-3 rounded-xl p-4">
        <p className="font-medium">General</p>
        <Field
          label="Public URL"
          hint="Where this app is reached (e.g. https://requests.example.com). Used to deep-link notifications to the queue."
        >
          <input
            className={inputCls}
            value={publicUrl}
            onChange={(e) => setPublicUrl(e.target.value)}
            placeholder="https://requests.example.com"
          />
        </Field>
      </div>

      <NarratorrSection state={narr} patch={patchNarr} testBody={narratorrTestBody} />

      <div className="sticky bottom-4 flex justify-end">
        <Button variant="primary" loading={update.isPending} onClick={save}>
          Save connection
        </Button>
      </div>

      <NotifiersSection notifiers={initial.notifiers} publicUrl={candidatePublicUrl} />
    </div>
  );
}

function NarratorrSection({
  state,
  patch,
  testBody,
}: {
  state: NarratorrState;
  patch: Patch<NarratorrState>;
  testBody: TestConnectorBody;
}) {
  const test = useTestConnector();
  return (
    <div className="glass-card flex flex-col gap-4 rounded-xl p-4">
      <div>
        <p className="font-medium">Narratorr connection</p>
        <p className="text-xs text-muted-foreground/70">
          The library this app sends approved requests to. Required for search and requests to work — blank the Host and
          save to disconnect.
        </p>
      </div>
      <div className="flex flex-col gap-3 border-t border-border/50 pt-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Host" hint="Hostname or IP, no protocol (e.g. narratorr or 192.168.1.10).">
            <input className={inputCls} value={state.host} onChange={(e) => patch({ host: e.target.value })} placeholder="narratorr" />
          </Field>
          <Field label="Port">
            <input className={inputCls} type="number" value={state.port} onChange={(e) => patch({ port: e.target.value })} placeholder="3000" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={state.useSsl} onChange={(e) => patch({ useSsl: e.target.checked })} />
          <span>Use SSL (https)</span>
        </label>
        <Field label="URL Base" hint="Optional — only if narratorr is behind a reverse-proxy subpath (e.g. /lib).">
          <input className={inputCls} value={state.urlBase} onChange={(e) => patch({ urlBase: e.target.value })} placeholder="/lib" />
        </Field>
        <Field label="API key" hint={state.hasKey ? 'Leave blank to keep the current key.' : 'From narratorr → Settings → API.'}>
          <input className={inputCls} type="password" autoComplete="off" value={state.key} onChange={(e) => patch({ key: e.target.value })} placeholder={secretPlaceholder(state.hasKey, true)} />
        </Field>
      </div>
      <div className="flex items-center gap-2 border-t border-border/50 pt-3">
        <Button variant="secondary" size="sm" loading={test.isPending} onClick={() => test.mutate(testBody)}>
          Test
        </Button>
        <span className="text-xs text-muted-foreground/70">Tests the current values above — no save required.</span>
      </div>
    </div>
  );
}

// --- Notifiers ---------------------------------------------------------------

function NotifiersSection({ notifiers, publicUrl }: { notifiers: NotifierDto[]; publicUrl: string | null }) {
  const [editing, setEditing] = useState<NotifierFormState | null>(null);
  const del = useDeleteNotifier();
  const test = useTestNotifier();

  // Test a SAVED notifier straight from its card: rebuild the candidate from the masked
  // DTO (secrets blank → omit-to-keep, resolved by id server-side), exactly as the modal
  // does. The test body samples the notifier's first selected event (null → no event, Test
  // is hidden on the card below).
  const testSaved = (n: KnownNotifierDto) => {
    const body = buildNotifierTestBody(formFromDto(n), publicUrl);
    if (body) test.mutate(body);
  };

  return (
    <div className="glass-card flex flex-col gap-4 rounded-xl p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">Notifiers</p>
          <p className="text-xs text-muted-foreground/70">
            Add as many destinations as you like — each fires on the events you choose (new requests, new signups).
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setEditing(newNotifierForm(NOTIFIER_TYPES[0]))}>
          Add notifier
        </Button>
      </div>

      {notifiers.length === 0 && (
        <p className="border-t border-border/50 pt-4 text-sm text-muted-foreground/70">No notifiers yet.</p>
      )}

      <div className="flex flex-col gap-2">
        {notifiers.map((n) => (
          <NotifierCard
            key={n.id}
            notifier={n}
            {...(isKnownNotifier(n) && {
              onEdit: () => setEditing(formFromDto(n)),
              // No event selected → nothing to sample → hide Test (the modal requires ≥1
              // event, but a leniently-stored notifier can have none).
              ...(n.events.length > 0 && { onTest: () => testSaved(n) }),
            })}
            onDelete={() => del.mutate(n.id)}
            testing={test.isPending && test.variables?.id === n.id}
            deleting={del.isPending && del.variables === n.id}
          />
        ))}
      </div>

      {editing && (
        <NotifierModal
          form={editing}
          setForm={setEditing}
          publicUrl={publicUrl}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function NotifierCard({
  notifier,
  onEdit,
  onTest,
  onDelete,
  testing,
  deleting,
}: {
  notifier: NotifierDto;
  onEdit?: () => void;
  onTest?: () => void;
  onDelete: () => void;
  testing: boolean;
  deleting: boolean;
}) {
  const known = isKnownNotifier(notifier);
  const typeLabel = known ? NOTIFIER_REGISTRY[notifier.type as NotifierType].label : notifier.type;
  const eventLabels = notifier.events
    .map((e) => NOTIFICATION_EVENTS.find((ev) => ev.key === e)?.label ?? e)
    .join(', ');

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/50 px-3 py-2">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${notifier.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
          title={notifier.enabled ? 'Enabled' : 'Disabled'}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {notifier.name} <span className="text-xs font-normal text-muted-foreground/70">· {typeLabel}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground/70">
            {known ? eventLabels || 'No events' : 'Unknown type — disabled. Delete to remove.'}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {onEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
        )}
        {onTest && (
          <Button variant="ghost" size="sm" loading={testing} onClick={onTest}>
            Test
          </Button>
        )}
        <Button variant="ghost" size="sm" loading={deleting} onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}

function NotifierModal({
  form,
  setForm,
  publicUrl,
  onClose,
}: {
  form: NotifierFormState;
  setForm: (f: NotifierFormState) => void;
  publicUrl: string | null;
  onClose: () => void;
}) {
  const create = useCreateNotifier();
  const edit = useUpdateNotifier();
  const test = useTestNotifier();
  const [submitted, setSubmitted] = useState(false);

  const def = NOTIFIER_REGISTRY[form.type];
  const errors = validateNotifierForm(form);
  const isValid = Object.keys(errors).length === 0;
  const showError = (k: string) => (submitted ? errors[k] : undefined);

  const setField = (key: string, value: string | boolean) =>
    setForm({ ...form, fields: { ...form.fields, [key]: value } });
  const setClear = (key: string, value: boolean) =>
    setForm({ ...form, clear: { ...form.clear, [key]: value } });

  function save() {
    setSubmitted(true);
    if (!isValid) return;
    const body = buildNotifierBody(form);
    if (form.id) {
      edit.mutate({ id: form.id, body }, { onSuccess: onClose });
    } else {
      create.mutate(body, { onSuccess: onClose });
    }
  }

  function runTest() {
    setSubmitted(true);
    if (!isValid) return;
    const body = buildNotifierTestBody(form, publicUrl);
    if (body) test.mutate(body);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="glass-card flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-medium">{form.id ? 'Edit notifier' : 'Add notifier'}</p>

        <Field label="Name" error={showError('name')}>
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. My phone" />
        </Field>

        <Field label="Type">
          <select
            className={inputCls}
            value={form.type}
            disabled={form.id !== null}
            onChange={(e) => setForm(newNotifierForm(e.target.value as NotifierType))}
          >
            {NOTIFIER_TYPES.map((t) => (
              <option key={t} value={t}>
                {NOTIFIER_REGISTRY[t].label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Events" error={showError('events')} hint="Which events this notifier fires on.">
          <div className="flex flex-col gap-1.5">
            {NOTIFICATION_EVENTS.map((ev) => (
              <label key={ev.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={form.events.includes(ev.key)}
                  onChange={() => setForm({ ...form, events: toggleEvent(form.events, ev.key) })}
                />
                <span>{ev.label}</span>
              </label>
            ))}
          </div>
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          <span>Enabled</span>
        </label>

        <div className="flex flex-col gap-3 border-t border-border/50 pt-4">
          {def.fields.map((f) => (
            <NotifierFieldInput key={f.key} field={f} form={form} setField={setField} setClear={setClear} error={showError(f.key)} />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-4">
          <Button variant="secondary" size="sm" loading={test.isPending} onClick={runTest}>
            Test
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={create.isPending || edit.isPending} onClick={save}>
              {form.id ? 'Save' : 'Add'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotifierFieldInput({
  field,
  form,
  setField,
  setClear,
  error,
}: {
  field: NotifierField;
  form: NotifierFormState;
  setField: (key: string, value: string | boolean) => void;
  setClear: (key: string, value: boolean) => void;
  error?: string | undefined;
}) {
  const value = form.fields[field.key];

  if (field.kind === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-primary" checked={Boolean(value)} onChange={(e) => setField(field.key, e.target.checked)} />
        <span>{field.label}</span>
      </label>
    );
  }

  const hasStored = field.secret && Boolean(form.has[field.key]);
  // The clear affordance is shown ONLY for an already-saved OPTIONAL secret.
  const clearable = hasStored && !field.required;
  const inputEmpty = typeof value !== 'string' || value.trim() === '';

  const secretHint = field.secret
    ? hasStored
      ? clearable
        ? 'Type a new value to replace it, or use “Clear stored value” to remove it.'
        : 'Leave blank to keep the current value.'
      : field.hint
    : field.hint;
  const placeholder = field.secret ? secretPlaceholder(Boolean(form.has[field.key]), field.required) : field.placeholder;

  return (
    <Field label={field.label} hint={secretHint} error={error}>
      <input
        className={inputCls}
        type={field.kind === 'password' ? 'password' : field.kind === 'number' ? 'number' : 'text'}
        autoComplete="off"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => setField(field.key, e.target.value)}
        placeholder={placeholder}
      />
      {clearable && (
        // A non-empty input always wins (rung 1), so disable + visually uncheck while the
        // input has text — clear and replace can never both be active.
        <label className="flex items-center gap-2 text-xs text-muted-foreground/70">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-primary"
            checked={Boolean(form.clear[field.key]) && inputEmpty}
            disabled={!inputEmpty}
            onChange={(e) => setClear(field.key, e.target.checked)}
          />
          <span>Clear stored value</span>
        </label>
      )}
    </Field>
  );
}
