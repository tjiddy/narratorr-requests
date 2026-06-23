import { describe, it, expect } from 'vitest';
import {
  buildNtfy,
  buildEmail,
  buildWebhook,
  buildTestBody,
  type NtfyState,
  type EmailState,
  type WebhookState,
  type ConnectorCandidates,
} from './settings-channels';

const ntfyState = (over: Partial<NtfyState>): NtfyState => ({
  on: true,
  url: 'https://ntfy.sh',
  topic: 'reqs',
  token: '',
  priority: '',
  hasToken: false,
  ...over,
});
const emailState = (over: Partial<EmailState>): EmailState => ({
  on: true,
  host: 'smtp.example.com',
  port: '587',
  secure: false,
  user: '',
  pass: '',
  from: 'a@b.c',
  to: 'd@e.f',
  hasPass: false,
  ...over,
});
const webhookState = (over: Partial<WebhookState>): WebhookState => ({ on: true, url: 'https://x/hook', ...over });

describe('buildNtfy / buildEmail / buildWebhook', () => {
  it('return null when the channel is toggled off', () => {
    expect(buildNtfy(ntfyState({ on: false }))).toBeNull();
    expect(buildEmail(emailState({ on: false }))).toBeNull();
    expect(buildWebhook(webhookState({ on: false }))).toBeNull();
  });

  it('omit the secret when the input is blank (keep the stored/masked one)', () => {
    expect(buildNtfy(ntfyState({ token: '' }))).not.toHaveProperty('token');
    expect(buildEmail(emailState({ pass: '' }))).not.toHaveProperty('pass');
  });

  it('include the secret (trimmed where applicable) when freshly typed', () => {
    expect(buildNtfy(ntfyState({ token: '  tok  ' }))).toMatchObject({ token: 'tok' });
    // Email pass is sent verbatim (no trim) — matches the PUT builder.
    expect(buildEmail(emailState({ pass: 'pw' }))).toMatchObject({ pass: 'pw' });
  });
});

describe('buildTestBody', () => {
  const candidates: ConnectorCandidates = {
    narratorr: { host: 'n', port: 3000, useSsl: false },
    ntfy: { url: 'https://ntfy.sh', topic: 'reqs' },
    email: { host: 'smtp.example.com', port: 587, secure: false, user: null, from: 'a@b.c', to: 'd@e.f' },
    webhook: { url: 'https://x/hook' },
  };

  it('carries the narratorr candidate and omits publicUrl (narratorr renders no notification)', () => {
    const body = buildTestBody('narratorr', candidates, 'https://app.example.com');
    expect(body).toEqual({ channel: 'narratorr', narratorr: candidates.narratorr });
    expect(body).not.toHaveProperty('publicUrl');
  });

  it('carries the channel candidate and the form publicUrl for notification channels', () => {
    expect(buildTestBody('ntfy', candidates, 'https://app.example.com')).toEqual({
      channel: 'ntfy',
      ntfy: candidates.ntfy,
      publicUrl: 'https://app.example.com',
    });
    expect(buildTestBody('email', candidates, null)).toEqual({
      channel: 'email',
      email: candidates.email,
      publicUrl: null,
    });
    expect(buildTestBody('webhook', candidates, 'https://app.example.com')).toMatchObject({
      channel: 'webhook',
      webhook: candidates.webhook,
      publicUrl: 'https://app.example.com',
    });
  });

  it('propagates the omit-to-keep secret encoding into the test body', () => {
    const candidatesUnchanged: ConnectorCandidates = { ...candidates, ntfy: buildNtfy(ntfyState({ token: '' })) };
    expect(buildTestBody('ntfy', candidatesUnchanged, null).ntfy).not.toHaveProperty('token');

    const candidatesTyped: ConnectorCandidates = { ...candidates, ntfy: buildNtfy(ntfyState({ token: 'new' })) };
    expect(buildTestBody('ntfy', candidatesTyped, null).ntfy).toMatchObject({ token: 'new' });
  });
});
