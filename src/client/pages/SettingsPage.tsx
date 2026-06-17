import { useState, type ReactNode } from 'react';
import type { ConnectorSettingsDto, UpdateConnectorSettingsBody } from '@shared/schemas/connectors';
import { useConnectorSettings, useUpdateConnectors, useTestConnector } from '../hooks';
import { Button } from '../components/Button';
import type { ConnectorChannel } from '../api';

const inputCls =
  'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50';

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

function SettingsForm({ initial }: { initial: ConnectorSettingsDto }) {
  const update = useUpdateConnectors();

  const [publicUrl, setPublicUrl] = useState(initial.publicUrl ?? '');

  const [narrOn, setNarrOn] = useState(initial.narratorr !== null);
  const [narrUrl, setNarrUrl] = useState(initial.narratorr?.url ?? '');
  const [narrKey, setNarrKey] = useState('');
  const narrHasKey = initial.narratorr?.hasApiKey ?? false;

  const [ntfyOn, setNtfyOn] = useState(initial.ntfy !== null);
  const [ntfyUrl, setNtfyUrl] = useState(initial.ntfy?.url ?? 'https://ntfy.sh');
  const [ntfyTopic, setNtfyTopic] = useState(initial.ntfy?.topic ?? '');
  const [ntfyToken, setNtfyToken] = useState('');
  const [ntfyPriority, setNtfyPriority] = useState(initial.ntfy?.priority ?? '');
  const ntfyHasToken = initial.ntfy?.hasToken ?? false;

  const [emailOn, setEmailOn] = useState(initial.email !== null);
  const [emailHost, setEmailHost] = useState(initial.email?.host ?? '');
  const [emailPort, setEmailPort] = useState(String(initial.email?.port ?? 587));
  const [emailSecure, setEmailSecure] = useState(initial.email?.secure ?? false);
  const [emailUser, setEmailUser] = useState(initial.email?.user ?? '');
  const [emailPass, setEmailPass] = useState('');
  const [emailFrom, setEmailFrom] = useState(initial.email?.from ?? '');
  const [emailTo, setEmailTo] = useState(initial.email?.to ?? '');
  const emailHasPass = initial.email?.hasPassword ?? false;

  const [webhookOn, setWebhookOn] = useState(initial.webhook !== null);
  const [webhookUrl, setWebhookUrl] = useState(initial.webhook?.url ?? '');

  const secretPlaceholder = (has: boolean, required = false) =>
    has ? '•••••••• (unchanged)' : required ? 'required' : 'optional';

  function save() {
    const body: UpdateConnectorSettingsBody = {
      publicUrl: publicUrl.trim() || null,
      narratorr: narrOn
        ? { url: narrUrl.trim(), ...(narrKey.trim() ? { apiKey: narrKey.trim() } : {}) }
        : null,
      ntfy: ntfyOn
        ? {
            url: ntfyUrl.trim(),
            topic: ntfyTopic.trim(),
            ...(ntfyToken.trim() ? { token: ntfyToken.trim() } : {}),
            priority: ntfyPriority.trim() || null,
          }
        : null,
      email: emailOn
        ? {
            host: emailHost.trim(),
            port: Number(emailPort) || 587,
            secure: emailSecure,
            user: emailUser.trim() || null,
            ...(emailPass ? { pass: emailPass } : {}),
            from: emailFrom.trim(),
            to: emailTo.trim(),
          }
        : null,
      webhook: webhookOn ? { url: webhookUrl.trim() } : null,
    };
    update.mutate(body);
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

      {/* Narratorr */}
      <Section
        title="Narratorr connection"
        subtitle="The library this app sends approved requests to. Required for search and requests to work."
        enabled={narrOn}
        onToggle={setNarrOn}
        channel="narratorr"
      >
        <Field label="Narratorr URL" hint="Base URL of your narratorr instance.">
          <input className={inputCls} value={narrUrl} onChange={(e) => setNarrUrl(e.target.value)} placeholder="https://narratorr.example.com" />
        </Field>
        <Field label="API key" hint={narrHasKey ? 'Leave blank to keep the current key.' : 'From narratorr → Settings → API.'}>
          <input className={inputCls} type="password" autoComplete="off" value={narrKey} onChange={(e) => setNarrKey(e.target.value)} placeholder={secretPlaceholder(narrHasKey, true)} />
        </Field>
      </Section>

      {/* ntfy */}
      <Section
        title="ntfy"
        subtitle="Push notifications to your phone via ntfy.sh or a self-hosted server."
        enabled={ntfyOn}
        onToggle={setNtfyOn}
        channel="ntfy"
      >
        <Field label="Server URL">
          <input className={inputCls} value={ntfyUrl} onChange={(e) => setNtfyUrl(e.target.value)} placeholder="https://ntfy.sh" />
        </Field>
        <Field label="Topic">
          <input className={inputCls} value={ntfyTopic} onChange={(e) => setNtfyTopic(e.target.value)} placeholder="my-narrator-requests" />
        </Field>
        <Field label="Access token" hint={ntfyHasToken ? 'Leave blank to keep the current token.' : 'Only needed for protected topics.'}>
          <input className={inputCls} type="password" autoComplete="off" value={ntfyToken} onChange={(e) => setNtfyToken(e.target.value)} placeholder={secretPlaceholder(ntfyHasToken)} />
        </Field>
        <Field label="Priority" hint="Optional: min, low, default, high, or max.">
          <input className={inputCls} value={ntfyPriority} onChange={(e) => setNtfyPriority(e.target.value)} placeholder="default" />
        </Field>
      </Section>

      {/* Email */}
      <Section
        title="Email (SMTP)"
        subtitle="Send request notifications to an email address."
        enabled={emailOn}
        onToggle={setEmailOn}
        channel="email"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="SMTP host">
            <input className={inputCls} value={emailHost} onChange={(e) => setEmailHost(e.target.value)} placeholder="smtp.example.com" />
          </Field>
          <Field label="Port">
            <input className={inputCls} type="number" value={emailPort} onChange={(e) => setEmailPort(e.target.value)} placeholder="587" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={emailSecure}
            onChange={(e) => {
              const on = e.target.checked;
              setEmailSecure(on);
              // Keep the port consistent with the TLS mode unless a custom port is set.
              setEmailPort((p) => (on && (p === '' || p === '587') ? '465' : !on && p === '465' ? '587' : p));
            }}
          />
          <span>Implicit TLS (port 465) — leave off for STARTTLS (e.g. 587)</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Username" hint="Optional for open relays.">
            <input className={inputCls} autoComplete="off" value={emailUser} onChange={(e) => setEmailUser(e.target.value)} placeholder="optional" />
          </Field>
          <Field label="Password" hint={emailHasPass ? 'Leave blank to keep.' : 'Optional.'}>
            <input className={inputCls} type="password" autoComplete="off" value={emailPass} onChange={(e) => setEmailPass(e.target.value)} placeholder={secretPlaceholder(emailHasPass)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <input className={inputCls} value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} placeholder="narrator-request@example.com" />
          </Field>
          <Field label="To (admin)">
            <input className={inputCls} value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="you@example.com" />
          </Field>
        </div>
      </Section>

      {/* Webhook */}
      <Section
        title="Webhook / Discord"
        subtitle="POST a JSON payload to any endpoint. Works as a Discord webhook URL out of the box."
        enabled={webhookOn}
        onToggle={setWebhookOn}
        channel="webhook"
      >
        <Field label="Webhook URL">
          <input className={inputCls} value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/…" />
        </Field>
      </Section>

      <div className="sticky bottom-4 flex justify-end">
        <Button variant="primary" loading={update.isPending} onClick={save}>
          Save settings
        </Button>
      </div>
    </div>
  );
}
