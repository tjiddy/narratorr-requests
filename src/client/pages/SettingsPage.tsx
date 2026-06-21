import { useState, type ReactNode } from 'react';
import type { ConnectorSettingsDto, UpdateConnectorSettingsBody } from '@shared/schemas/connectors';
import { useConnectorSettings, useUpdateConnectors, useTestConnector } from '../hooks';
import { Button } from '../components/Button';
import type { ConnectorChannel } from '../api';

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
  channel,
  children,
}: {
  title: string;
  subtitle: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  channel?: ConnectorChannel;
  children: ReactNode;
}) {
  const test = useTestConnector();
  return (
    <div className="glass-card flex flex-col gap-4 rounded-xl p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-xs text-muted-foreground/70">{subtitle}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <span className="text-muted-foreground">Enabled</span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
        </label>
      </div>
      {enabled && <div className="flex flex-col gap-3 border-t border-border/50 pt-4">{children}</div>}
      {enabled && channel && (
        <div className="flex items-center gap-2 border-t border-border/50 pt-3">
          <Button
            variant="secondary"
            size="sm"
            loading={test.isPending && test.variables === channel}
            onClick={() => test.mutate(channel)}
          >
            Test
          </Button>
          <span className="text-xs text-muted-foreground/70">Tests the last saved settings — save first.</span>
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
// Grouped per connector so the form composes from focused section components and
// the `??`/`?.` defaulting lives in these init/build helpers, not the form body.

type NarratorrState = { on: boolean; url: string; key: string; hasKey: boolean };
type NtfyState = { on: boolean; url: string; topic: string; token: string; priority: string; hasToken: boolean };
type EmailState = {
  on: boolean;
  host: string;
  port: string;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string;
  hasPass: boolean;
};
type WebhookState = { on: boolean; url: string };

const initNarratorr = (c: ConnectorSettingsDto['narratorr']): NarratorrState => ({
  on: c !== null,
  url: c?.url ?? '',
  key: '',
  hasKey: c?.hasApiKey ?? false,
});
const initNtfy = (c: ConnectorSettingsDto['ntfy']): NtfyState => ({
  on: c !== null,
  url: c?.url ?? 'https://ntfy.sh',
  topic: c?.topic ?? '',
  token: '',
  priority: c?.priority ?? '',
  hasToken: c?.hasToken ?? false,
});
const initEmail = (c: ConnectorSettingsDto['email']): EmailState => ({
  on: c !== null,
  host: c?.host ?? '',
  port: String(c?.port ?? 587),
  secure: c?.secure ?? false,
  user: c?.user ?? '',
  pass: '',
  from: c?.from ?? '',
  to: c?.to ?? '',
  hasPass: c?.hasPassword ?? false,
});
const initWebhook = (c: ConnectorSettingsDto['webhook']): WebhookState => ({ on: c !== null, url: c?.url ?? '' });

const buildNarratorr = (s: NarratorrState): UpdateConnectorSettingsBody['narratorr'] =>
  s.on ? { url: s.url.trim(), ...(s.key.trim() ? { apiKey: s.key.trim() } : {}) } : null;
const buildNtfy = (s: NtfyState): UpdateConnectorSettingsBody['ntfy'] =>
  s.on
    ? {
        url: s.url.trim(),
        topic: s.topic.trim(),
        ...(s.token.trim() ? { token: s.token.trim() } : {}),
        priority: s.priority.trim() || null,
      }
    : null;
const buildEmail = (s: EmailState): UpdateConnectorSettingsBody['email'] =>
  s.on
    ? {
        host: s.host.trim(),
        port: Number(s.port) || 587,
        secure: s.secure,
        user: s.user.trim() || null,
        ...(s.pass ? { pass: s.pass } : {}),
        from: s.from.trim(),
        to: s.to.trim(),
      }
    : null;
const buildWebhook = (s: WebhookState): UpdateConnectorSettingsBody['webhook'] =>
  s.on ? { url: s.url.trim() } : null;

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

  function save() {
    update.mutate({
      publicUrl: publicUrl.trim() || null,
      narratorr: buildNarratorr(narr),
      ntfy: buildNtfy(ntfy),
      email: buildEmail(email),
      webhook: buildWebhook(webhook),
    });
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

      <NarratorrSection state={narr} patch={patchNarr} />
      <NtfySection state={ntfy} patch={patchNtfy} />
      <EmailSection state={email} patch={patchEmail} />
      <WebhookSection state={webhook} patch={patchWebhook} />

      <div className="sticky bottom-4 flex justify-end">
        <Button variant="primary" loading={update.isPending} onClick={save}>
          Save settings
        </Button>
      </div>
    </div>
  );
}

function NarratorrSection({ state, patch }: { state: NarratorrState; patch: Patch<NarratorrState> }) {
  return (
    <Section
      title="Narratorr connection"
      subtitle="The library this app sends approved requests to. Required for search and requests to work."
      enabled={state.on}
      onToggle={(v) => patch({ on: v })}
      channel="narratorr"
    >
      <Field label="Narratorr URL" hint="Base URL of your narratorr instance.">
        <input className={inputCls} value={state.url} onChange={(e) => patch({ url: e.target.value })} placeholder="https://narratorr.example.com" />
      </Field>
      <Field label="API key" hint={state.hasKey ? 'Leave blank to keep the current key.' : 'From narratorr → Settings → API.'}>
        <input className={inputCls} type="password" autoComplete="off" value={state.key} onChange={(e) => patch({ key: e.target.value })} placeholder={secretPlaceholder(state.hasKey, true)} />
      </Field>
    </Section>
  );
}

function NtfySection({ state, patch }: { state: NtfyState; patch: Patch<NtfyState> }) {
  return (
    <Section
      title="ntfy"
      subtitle="Push notifications to your phone via ntfy.sh or a self-hosted server."
      enabled={state.on}
      onToggle={(v) => patch({ on: v })}
      channel="ntfy"
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

function EmailSection({ state, patch }: { state: EmailState; patch: Patch<EmailState> }) {
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
      channel="email"
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

function WebhookSection({ state, patch }: { state: WebhookState; patch: Patch<WebhookState> }) {
  return (
    <Section
      title="Webhook / Discord"
      subtitle="POST a JSON payload to any endpoint. Works as a Discord webhook URL out of the box."
      enabled={state.on}
      onToggle={(v) => patch({ on: v })}
      channel="webhook"
    >
      <Field label="Webhook URL">
        <input className={inputCls} value={state.url} onChange={(e) => patch({ url: e.target.value })} placeholder="https://discord.com/api/webhooks/…" />
      </Field>
    </Section>
  );
}
