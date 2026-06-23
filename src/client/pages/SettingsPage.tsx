import { useState, type ReactNode } from 'react';
import type { ConnectorSettingsDto, TestConnectorBody } from '@shared/schemas/connectors';
import { useConnectorSettings, useUpdateConnectors, useTestConnector } from '../hooks';
import { Button } from '../components/Button';
import { initNarratorr, buildNarratorr, type NarratorrState } from './settings-narratorr';
import {
  initNtfy,
  initEmail,
  initWebhook,
  buildNtfy,
  buildEmail,
  buildWebhook,
  buildTestBody,
  type NtfyState,
  type EmailState,
  type WebhookState,
} from './settings-channels';

const inputCls =
  'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50';

const secretPlaceholder = (has: boolean, required = false) =>
  has ? '•••••••• (unchanged)' : required ? 'required' : 'optional';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground/70">{hint}</span>}
    </label>
  );
}

function Section({
  title,
  subtitle,
  enabled,
  onToggle,
  testBody,
  children,
}: {
  title: string;
  subtitle: string;
  // Toggle is optional: omit both to render a non-toggling, always-expanded card.
  // The narratorr connection has no enable/disable concept (it's the app's lifeline),
  // so it renders without a toggle; ntfy/email/webhook keep theirs.
  enabled?: boolean;
  onToggle?: (v: boolean) => void;
  // The Test request body built from the section's CURRENT form values. Computed by the
  // parent so the per-section state and the top-level Public URL are both in scope.
  testBody?: TestConnectorBody;
  children: ReactNode;
}) {
  const test = useTestConnector();
  const expanded = onToggle ? Boolean(enabled) : true;
  return (
    <div className="glass-card flex flex-col gap-4 rounded-xl p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-xs text-muted-foreground/70">{subtitle}</p>
        </div>
        {onToggle && (
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <span className="text-muted-foreground">Enabled</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={Boolean(enabled)}
              onChange={(e) => onToggle(e.target.checked)}
            />
          </label>
        )}
      </div>
      {expanded && <div className="flex flex-col gap-3 border-t border-border/50 pt-4">{children}</div>}
      {expanded && testBody && (
        <div className="flex items-center gap-2 border-t border-border/50 pt-3">
          <Button
            variant="secondary"
            size="sm"
            loading={test.isPending && test.variables?.channel === testBody.channel}
            onClick={() => test.mutate(testBody)}
          >
            Test
          </Button>
          <span className="text-xs text-muted-foreground/70">Tests the current values above — no save required.</span>
        </div>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { data, isLoading, error } = useConnectorSettings();

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect to narratorr and configure how you’re notified about new requests.
        </p>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground/70">Loading…</p>}
      {error && <p className="text-sm text-destructive">Could not load settings.</p>}
      {/* Remount on save so freshly-masked secrets + has* flags reset cleanly. */}
      {data && <SettingsForm key={JSON.stringify(data)} initial={data} />}
    </div>
  );
}

// --- Per-channel form state -------------------------------------------------
// State types + init/build helpers live in ./settings-channels (ntfy/email/webhook) and
// ./settings-narratorr — pure logic, unit-tested without a DOM. The form composes from
// focused section components; the Test body for each is built from current state here.

type Patch<T> = (p: Partial<T>) => void;

function SettingsForm({ initial }: { initial: ConnectorSettingsDto }) {
  const update = useUpdateConnectors();

  const [publicUrl, setPublicUrl] = useState(initial.publicUrl ?? '');
  const [narr, setNarr] = useState(() => initNarratorr(initial.narratorr));
  const [ntfy, setNtfy] = useState(() => initNtfy(initial.ntfy));
  const [email, setEmail] = useState(() => initEmail(initial.email));
  const [webhook, setWebhook] = useState(() => initWebhook(initial.webhook));

  const patchNarr: Patch<NarratorrState> = (p) => setNarr((s) => ({ ...s, ...p }));
  const patchNtfy: Patch<NtfyState> = (p) => setNtfy((s) => ({ ...s, ...p }));
  const patchEmail: Patch<EmailState> = (p) => setEmail((s) => ({ ...s, ...p }));
  const patchWebhook: Patch<WebhookState> = (p) => setWebhook((s) => ({ ...s, ...p }));

  // The candidate connector payloads for the CURRENT form values — shared by save (PUT)
  // and Test, so a Test runs against exactly what a save would persist (no save required).
  const candidatePublicUrl = publicUrl.trim() || null;
  const candidates = {
    narratorr: buildNarratorr(narr),
    ntfy: buildNtfy(ntfy),
    email: buildEmail(email),
    webhook: buildWebhook(webhook),
  };

  function save() {
    update.mutate({ publicUrl: candidatePublicUrl, ...candidates });
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

      <NarratorrSection state={narr} patch={patchNarr} testBody={buildTestBody('narratorr', candidates, candidatePublicUrl)} />
      <NtfySection state={ntfy} patch={patchNtfy} testBody={buildTestBody('ntfy', candidates, candidatePublicUrl)} />
      <EmailSection state={email} patch={patchEmail} testBody={buildTestBody('email', candidates, candidatePublicUrl)} />
      <WebhookSection state={webhook} patch={patchWebhook} testBody={buildTestBody('webhook', candidates, candidatePublicUrl)} />

      <div className="sticky bottom-4 flex justify-end">
        <Button variant="primary" loading={update.isPending} onClick={save}>
          Save settings
        </Button>
      </div>
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
  return (
    <Section
      title="Narratorr connection"
      subtitle="The library this app sends approved requests to. Required for search and requests to work — blank the Host and save to disconnect."
      testBody={testBody}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Host" hint="Hostname or IP, no protocol (e.g. narratorr or 192.168.1.10).">
          <input className={inputCls} value={state.host} onChange={(e) => patch({ host: e.target.value })} placeholder="narratorr" />
        </Field>
        <Field label="Port">
          <input className={inputCls} type="number" value={state.port} onChange={(e) => patch({ port: e.target.value })} placeholder="3000" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={state.useSsl}
          onChange={(e) => patch({ useSsl: e.target.checked })}
        />
        <span>Use SSL (https)</span>
      </label>
      <Field label="URL Base" hint="Optional — only if narratorr is behind a reverse-proxy subpath (e.g. /lib).">
        <input className={inputCls} value={state.urlBase} onChange={(e) => patch({ urlBase: e.target.value })} placeholder="/lib" />
      </Field>
      <Field label="API key" hint={state.hasKey ? 'Leave blank to keep the current key.' : 'From narratorr → Settings → API.'}>
        <input className={inputCls} type="password" autoComplete="off" value={state.key} onChange={(e) => patch({ key: e.target.value })} placeholder={secretPlaceholder(state.hasKey, true)} />
      </Field>
    </Section>
  );
}

function NtfySection({
  state,
  patch,
  testBody,
}: {
  state: NtfyState;
  patch: Patch<NtfyState>;
  testBody: TestConnectorBody;
}) {
  return (
    <Section
      title="ntfy"
      subtitle="Push notifications to your phone via ntfy.sh or a self-hosted server."
      enabled={state.on}
      onToggle={(v) => patch({ on: v })}
      testBody={testBody}
    >
      <Field label="Server URL">
        <input className={inputCls} value={state.url} onChange={(e) => patch({ url: e.target.value })} placeholder="https://ntfy.sh" />
      </Field>
      <Field label="Topic">
        <input className={inputCls} value={state.topic} onChange={(e) => patch({ topic: e.target.value })} placeholder="my-narratorr-requests" />
      </Field>
      <Field label="Access token" hint={state.hasToken ? 'Leave blank to keep the current token.' : 'Only needed for protected topics.'}>
        <input className={inputCls} type="password" autoComplete="off" value={state.token} onChange={(e) => patch({ token: e.target.value })} placeholder={secretPlaceholder(state.hasToken)} />
      </Field>
      <Field label="Priority" hint="Optional: min, low, default, high, or max.">
        <input className={inputCls} value={state.priority} onChange={(e) => patch({ priority: e.target.value })} placeholder="default" />
      </Field>
    </Section>
  );
}

function EmailSection({
  state,
  patch,
  testBody,
}: {
  state: EmailState;
  patch: Patch<EmailState>;
  testBody: TestConnectorBody;
}) {
  const onToggleSecure = (on: boolean) => {
    // Keep the port consistent with the TLS mode unless a custom port is set.
    const port = on && (state.port === '' || state.port === '587') ? '465' : !on && state.port === '465' ? '587' : state.port;
    patch({ secure: on, port });
  };
  return (
    <Section
      title="Email (SMTP)"
      subtitle="Send request notifications to an email address."
      enabled={state.on}
      onToggle={(v) => patch({ on: v })}
      testBody={testBody}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="SMTP host">
          <input className={inputCls} value={state.host} onChange={(e) => patch({ host: e.target.value })} placeholder="smtp.example.com" />
        </Field>
        <Field label="Port">
          <input className={inputCls} type="number" value={state.port} onChange={(e) => patch({ port: e.target.value })} placeholder="587" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={state.secure}
          onChange={(e) => onToggleSecure(e.target.checked)}
        />
        <span>Implicit TLS (port 465) — leave off for STARTTLS (e.g. 587)</span>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Username" hint="Optional for open relays.">
          <input className={inputCls} autoComplete="off" value={state.user} onChange={(e) => patch({ user: e.target.value })} placeholder="optional" />
        </Field>
        <Field label="Password" hint={state.hasPass ? 'Leave blank to keep.' : 'Optional.'}>
          <input className={inputCls} type="password" autoComplete="off" value={state.pass} onChange={(e) => patch({ pass: e.target.value })} placeholder={secretPlaceholder(state.hasPass)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <input className={inputCls} value={state.from} onChange={(e) => patch({ from: e.target.value })} placeholder="narratorr-request@example.com" />
        </Field>
        <Field label="To (admin)">
          <input className={inputCls} value={state.to} onChange={(e) => patch({ to: e.target.value })} placeholder="you@example.com" />
        </Field>
      </div>
    </Section>
  );
}

function WebhookSection({
  state,
  patch,
  testBody,
}: {
  state: WebhookState;
  patch: Patch<WebhookState>;
  testBody: TestConnectorBody;
}) {
  return (
    <Section
      title="Webhook / Discord"
      subtitle="POST a JSON payload to any endpoint. Works as a Discord webhook URL out of the box."
      enabled={state.on}
      onToggle={(v) => patch({ on: v })}
      testBody={testBody}
    >
      <Field label="Webhook URL">
        <input className={inputCls} value={state.url} onChange={(e) => patch({ url: e.target.value })} placeholder="https://discord.com/api/webhooks/…" />
      </Field>
    </Section>
  );
}
