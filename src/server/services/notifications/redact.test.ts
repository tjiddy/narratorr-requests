import { describe, it, expect } from 'vitest';
import { redact } from './redact.js';

describe('redact — URL-class secrets (pattern-based, no caller-supplied values)', () => {
  it('scrubs a Telegram bot token embedded in a sendMessage URL', () => {
    const err = new Error('fetch failed: request to https://api.telegram.org/bot123456:ABC-def_GHI/sendMessage failed');
    const out = redact(err);
    expect(out).not.toContain('123456:ABC-def_GHI');
    expect(out).toContain('api.telegram.org'); // host preserved, only the token gone
  });

  it('scrubs the token segment of a Discord webhook URL (keeps the host + numeric id)', () => {
    const out = redact('connect ECONNREFUSED https://discord.com/api/webhooks/12345/SuperSecretToken-xyz');
    expect(out).not.toContain('SuperSecretToken-xyz');
    expect(out).toContain('discord.com/api/webhooks/12345');
  });

  it('scrubs the services path of a Slack webhook URL', () => {
    const out = redact('error posting to https://hooks.slack.com/services/T000/B000/XXXXSECRETXXXX now');
    expect(out).not.toContain('XXXXSECRETXXXX');
    expect(out).not.toContain('T000/B000');
    expect(out).toContain('hooks.slack.com/services');
  });

  it('leaves a non-secret message untouched', () => {
    expect(redact('Discord responded 401')).toBe('Discord responded 401');
  });
});

describe('redact — value-class secrets (Pushover keys, Gotify token) by exact match', () => {
  it('scrubs a Pushover app token and user key passed as known values', () => {
    const msg = 'Pushover rejected token=abcdefAPP30charTOKENvalue00000 user=zyxwvUSER30charKEYvalue000000';
    const out = redact(msg, ['abcdefAPP30charTOKENvalue00000', 'zyxwvUSER30charKEYvalue000000']);
    expect(out).not.toContain('abcdefAPP30charTOKENvalue00000');
    expect(out).not.toContain('zyxwvUSER30charKEYvalue000000');
  });

  it('scrubs a Gotify app token passed as a known value', () => {
    const out = redact('Gotify auth failed for key gotifyAppToken12345', ['gotifyAppToken12345']);
    expect(out).not.toContain('gotifyAppToken12345');
  });

  it('ignores empty / trivially short secret values (no over-redaction)', () => {
    expect(redact('all good here', ['', 'ab'])).toBe('all good here');
  });
});

describe('redact — input coercion', () => {
  it('stringifies a non-Error, non-string value', () => {
    expect(redact({ toString: () => 'plain object' })).toBe('plain object');
  });
});
