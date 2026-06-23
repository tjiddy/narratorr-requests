import type {
  ConnectorSettingsDto,
  UpdateConnectorSettingsBody,
  TestConnectorBody,
} from '@shared/schemas/connectors';
import type { ConnectorChannel } from '../api';

// Notification-channel form state + init/build helpers (ntfy / email / webhook). Pulled
// out of SettingsPage as pure logic so they can be unit-tested without a DOM (vitest node
// env), matching settings-narratorr.ts. The `??`/`?.` defaulting and the omit-to-keep
// secret encoding live here, not in the form body.

export type NtfyState = { on: boolean; url: string; topic: string; token: string; priority: string; hasToken: boolean };
export type EmailState = {
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
export type WebhookState = { on: boolean; url: string };

export const initNtfy = (c: ConnectorSettingsDto['ntfy']): NtfyState => ({
  on: c !== null,
  url: c?.url ?? 'https://ntfy.sh',
  topic: c?.topic ?? '',
  token: '',
  priority: c?.priority ?? '',
  hasToken: c?.hasToken ?? false,
});
export const initEmail = (c: ConnectorSettingsDto['email']): EmailState => ({
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
export const initWebhook = (c: ConnectorSettingsDto['webhook']): WebhookState => ({ on: c !== null, url: c?.url ?? '' });

// Each build* emits the PUT/Test candidate for its connector: `on: false` → null (disabled),
// secret omitted when blank (keep the masked/stored one), included when freshly typed.
export const buildNtfy = (s: NtfyState): UpdateConnectorSettingsBody['ntfy'] =>
  s.on
    ? {
        url: s.url.trim(),
        topic: s.topic.trim(),
        ...(s.token.trim() ? { token: s.token.trim() } : {}),
        priority: s.priority.trim() || null,
      }
    : null;
export const buildEmail = (s: EmailState): UpdateConnectorSettingsBody['email'] =>
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
export const buildWebhook = (s: WebhookState): UpdateConnectorSettingsBody['webhook'] =>
  s.on ? { url: s.url.trim() } : null;

/** The candidate connector payloads the form holds — the same objects a save (PUT) sends. */
export type ConnectorCandidates = {
  narratorr: UpdateConnectorSettingsBody['narratorr'];
  ntfy: UpdateConnectorSettingsBody['ntfy'];
  email: UpdateConnectorSettingsBody['email'];
  webhook: UpdateConnectorSettingsBody['webhook'];
};

/**
 * Build the Test request body from the CURRENT form values for one connector, so Test
 * validates unsaved input. The candidate's secrets are already omit-to-keep (see build*),
 * which the server resolves against the stored secret. Notification channels also carry the
 * form's `publicUrl` so the test notification renders with the unsaved Public URL; narratorr
 * has no notification to render, so it omits `publicUrl`.
 */
export function buildTestBody(
  channel: ConnectorChannel,
  candidates: ConnectorCandidates,
  publicUrl: string | null,
): TestConnectorBody {
  switch (channel) {
    case 'narratorr':
      return { channel, narratorr: candidates.narratorr };
    case 'ntfy':
      return { channel, ntfy: candidates.ntfy, publicUrl };
    case 'email':
      return { channel, email: candidates.email, publicUrl };
    case 'webhook':
      return { channel, webhook: candidates.webhook, publicUrl };
  }
}
