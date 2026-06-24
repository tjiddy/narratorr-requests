import { describe, it, expect } from 'vitest';
import {
  connectorSettingsDtoSchema,
  notifierDtoSchema,
  storedNotifierSchema,
  testConnectorBodySchema,
  testConnectorResultSchema,
  updateConnectorSettingsBodySchema,
  createNotifierBodySchema,
  notifierTestBodySchema,
} from './connectors';

// `httpUrl` is a private constant; its behavior is exercised through the exported
// `updateConnectorSettingsBodySchema` (the PUT body) — the same way the API contract is
// reached through its public surface. The notification-channel field validators moved to
// the notifier registry (see notifier-registry.test.ts).
const parse = (body: unknown) => updateConnectorSettingsBodySchema.parse(body);
const accepts = (body: unknown) => updateConnectorSettingsBodySchema.safeParse(body).success;
const issues = (body: unknown) => updateConnectorSettingsBodySchema.safeParse(body).error?.issues ?? [];

describe('httpUrl (via publicUrl)', () => {
  it('strips trailing slashes and trims', () => {
    expect(parse({ publicUrl: 'https://x.com/' }).publicUrl).toBe('https://x.com');
    expect(parse({ publicUrl: '  https://x.com///  ' }).publicUrl).toBe('https://x.com');
  });

  it('rejects non-http(s) schemes and scheme-less values', () => {
    expect(accepts({ publicUrl: 'ftp://x.com' })).toBe(false);
    expect(accepts({ publicUrl: 'x.com' })).toBe(false);
  });
});

describe('updateConnectorSettingsBodySchema — narratorr + publicUrl only', () => {
  const narr = (over: Record<string, unknown>) => ({
    narratorr: { url: 'http://narratorr:3000', ...over },
  });

  it('accepts a narratorr object with url + apiKey', () => {
    const parsed = parse({ narratorr: { url: 'http://books.example.com:443/lib', apiKey: 'k' } });
    expect(parsed.narratorr).toEqual({ url: 'http://books.example.com:443/lib', apiKey: 'k' });
  });

  it('accepts plain, private, IPv6-literal and subpath URLs; strips the trailing slash', () => {
    for (const url of [
      'http://host:3000',
      'http://192.168.1.10:3000',
      'http://[::1]:3000',
      'https://localhost',
      'http://host:3000/lib',
    ]) {
      expect(parse(narr({ url, apiKey: 'k' })).narratorr?.url).toBe(url);
    }
    expect(parse(narr({ url: 'http://host:3000/', apiKey: 'k' })).narratorr?.url).toBe('http://host:3000');
  });

  it('rejects a scheme-less value and a bare http:// with no host', () => {
    expect(accepts(narr({ url: 'narratorr:3000', apiKey: 'k' }))).toBe(false);
    expect(accepts(narr({ url: 'http://', apiKey: 'k' }))).toBe(false);
  });

  it('apiKey is optional (omit-to-keep still parses)', () => {
    expect(accepts(narr({}))).toBe(true);
    expect(parse(narr({})).narratorr).toEqual({ url: 'http://narratorr:3000' });
  });

  it('is .strict() at the top level — the old ntfy/email/webhook slots are now rejected', () => {
    expect(issues({ ntfy: { url: 'https://ntfy.sh', topic: 't' } })[0]?.code).toBe('unrecognized_keys');
    expect(accepts({ email: { host: 'h', from: 'f@x', to: 't@x' } })).toBe(false);
    expect(accepts({ webhook: { url: 'https://x/hook' } })).toBe(false);
    expect(accepts({ bogus: 1 })).toBe(false);
  });
});

describe('testConnectorBodySchema — narratorr only', () => {
  it('accepts a narratorr candidate', () => {
    expect(testConnectorBodySchema.parse({ channel: 'narratorr' }).channel).toBe('narratorr');
    expect(
      testConnectorBodySchema.safeParse({ channel: 'narratorr', narratorr: { url: 'http://n:3000' } }).success,
    ).toBe(true);
  });

  it('rejects a non-narratorr channel and unknown top-level keys (.strict)', () => {
    expect(testConnectorBodySchema.safeParse({ channel: 'ntfy' }).success).toBe(false);
    expect(testConnectorBodySchema.safeParse({ channel: 'narratorr', extra: 1 }).success).toBe(false);
  });
});

describe('testConnectorResultSchema', () => {
  it('accepts { success, message } and rejects wrong types', () => {
    expect(testConnectorResultSchema.parse({ success: true, message: 'ok' })).toEqual({ success: true, message: 'ok' });
    expect(testConnectorResultSchema.safeParse({ success: 'yes', message: 'ok' }).success).toBe(false);
  });
});

describe('createNotifierBodySchema / notifierTestBodySchema', () => {
  const base = { name: 'My phone', type: 'ntfy', events: ['request.created'], config: {} };

  it('accepts a valid envelope (config validated server-side, opaque here)', () => {
    expect(createNotifierBodySchema.safeParse(base).success).toBe(true);
  });

  it('rejects an out-of-registry type, empty events, whitespace-only name, and unknown keys', () => {
    expect(createNotifierBodySchema.safeParse({ ...base, type: 'apprise' }).success).toBe(false);
    expect(createNotifierBodySchema.safeParse({ ...base, events: [] }).success).toBe(false);
    expect(createNotifierBodySchema.safeParse({ ...base, name: '   ' }).success).toBe(false);
    expect(createNotifierBodySchema.safeParse({ ...base, bogus: 1 }).success).toBe(false);
  });

  it('rejects an unknown event key in events', () => {
    expect(createNotifierBodySchema.safeParse({ ...base, events: ['request.bogus'] }).success).toBe(false);
  });

  it('accepts request.failed as a known event key (#60)', () => {
    expect(createNotifierBodySchema.safeParse({ ...base, events: ['request.failed'] }).success).toBe(true);
  });

  it('notifier test body carries type + config, optional id + publicUrl', () => {
    expect(notifierTestBodySchema.parse({ type: 'webhook', config: { url: 'https://x/h' }, id: 'nf_1', publicUrl: 'https://a.com' })).toMatchObject({
      type: 'webhook',
      id: 'nf_1',
    });
    expect(notifierTestBodySchema.safeParse({ type: 'webhook', config: {} }).success).toBe(true);
  });

  it('notifier test body event: accepts the known events, defaults to request.created, rejects unknown', () => {
    expect(notifierTestBodySchema.parse({ type: 'ntfy', config: {}, event: 'user.pending' }).event).toBe('user.pending');
    expect(notifierTestBodySchema.parse({ type: 'ntfy', config: {}, event: 'request.created' }).event).toBe('request.created');
    // Omitted → legacy request.created sample, preserving today's probe.
    expect(notifierTestBodySchema.parse({ type: 'ntfy', config: {} }).event).toBe('request.created');
    // request.failed is now a known event (#60); a still-unknown key is rejected.
    expect(notifierTestBodySchema.parse({ type: 'ntfy', config: {}, event: 'request.failed' }).event).toBe('request.failed');
    expect(notifierTestBodySchema.safeParse({ type: 'ntfy', config: {}, event: 'request.bogus' }).success).toBe(false);
  });
});

describe('storedNotifierSchema — type-lenient persistence boundary', () => {
  it('parses a row whose type is NOT in the registry (round-trips, type: string)', () => {
    const row = { id: 'nf_x', name: 'Legacy', type: 'apprise', events: ['user.pending'], config: { token: 'enc:v1:abc' } };
    const parsed = storedNotifierSchema.parse(row);
    expect(parsed.type).toBe('apprise');
    expect(parsed.config).toEqual({ token: 'enc:v1:abc' });
  });
});

describe('notifierDtoSchema — discriminated known | unknown', () => {
  it('accepts a known (masked) notifier DTO', () => {
    const dto = {
      id: 'nf_1',
      name: 'Phone',
      type: 'ntfy',
      events: ['request.created'],
      config: { url: 'https://ntfy.sh', topic: 't', hasToken: true, priority: null },
    };
    expect(notifierDtoSchema.safeParse(dto).success).toBe(true);
  });

  it('accepts a webhook DTO masked to a host hint (no plaintext url)', () => {
    const dto = { id: 'nf_2', name: 'Discord', type: 'webhook', events: ['request.created'], config: { hasUrl: true, urlHint: 'discord.com/…' } };
    expect(notifierDtoSchema.safeParse(dto).success).toBe(true);
  });

  it('accepts an unknown-type DTO (deletable, no config)', () => {
    const dto = { id: 'nf_3', name: 'Legacy', type: 'apprise', events: ['user.pending'], unknown: true };
    expect(notifierDtoSchema.safeParse(dto).success).toBe(true);
  });
});

describe('connectorSettingsDtoSchema', () => {
  it('accepts a representative masked payload with a notifier list', () => {
    const dto = {
      publicUrl: 'https://requests.example.com',
      narratorr: { url: 'https://narratorr.example.com/lib', hasApiKey: true },
      notifiers: [
        { id: 'nf_1', name: 'Phone', type: 'ntfy', events: ['request.created'], config: { url: 'https://ntfy.sh', topic: 't', hasToken: false, priority: null } },
        { id: 'nf_2', name: 'Legacy', type: 'apprise', events: ['user.pending'], unknown: true },
      ],
    };
    expect(connectorSettingsDtoSchema.safeParse(dto).success).toBe(true);
  });

  it('accepts empty notifiers + null connections', () => {
    expect(connectorSettingsDtoSchema.parse({ publicUrl: null, narratorr: null, notifiers: [] })).toEqual({
      publicUrl: null,
      narratorr: null,
      notifiers: [],
    });
  });
});
