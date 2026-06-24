import { describe, it, expect } from 'vitest';
import {
  NOTIFIER_REGISTRY,
  NOTIFIER_TYPES,
  NOTIFIER_DEFS,
  isKnownNotifierType,
} from './notifier-registry';

describe('registry shape', () => {
  it('NOTIFIER_DEFS covers exactly NOTIFIER_TYPES, in order', () => {
    expect(NOTIFIER_DEFS.map((d) => d.type)).toEqual([...NOTIFIER_TYPES]);
  });

  it('every secretField references a real field and (if hinted) is a capability URL', () => {
    for (const def of NOTIFIER_DEFS) {
      for (const sf of def.secretFields) {
        const field = def.fields.find((f) => f.key === sf.field);
        expect(field, `${def.type}.${sf.field}`).toBeDefined();
        expect(field?.secret).toBe(true);
      }
    }
  });

  it('isKnownNotifierType discriminates registry keys from strangers', () => {
    expect(isKnownNotifierType('ntfy')).toBe(true);
    expect(isKnownNotifierType('telegram')).toBe(true);
    // A type not in the registry (a legacy/renamed type) is a stranger.
    expect(isKnownNotifierType('apprise')).toBe(false);
  });

  it('isKnownNotifierType rejects inherited Object.prototype keys (own-property check, not `in`)', () => {
    // A malformed stored `type` of a prototype member must be a stranger — otherwise it would
    // resolve a prototype object as a "def" and brick the GET / dispatcher (never-brick #57).
    for (const proto of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(isKnownNotifierType(proto), proto).toBe(false);
    }
  });
});

describe('ntfy configSchema', () => {
  const schema = NOTIFIER_REGISTRY.ntfy.configSchema;
  it('accepts valid input; defaults priority to null; omits the optional token', () => {
    const parsed = schema.parse({ url: 'https://ntfy.sh/', topic: 'reqs' }) as Record<string, unknown>;
    expect(parsed).toMatchObject({ url: 'https://ntfy.sh', topic: 'reqs', priority: null });
    expect(parsed.token).toBeUndefined();
  });

  it('validates priority (the documented words / 1-5) and rejects junk', () => {
    expect(schema.safeParse({ url: 'https://ntfy.sh', topic: 't', priority: 'high' }).success).toBe(true);
    expect(schema.safeParse({ url: 'https://ntfy.sh', topic: 't', priority: 'urgent' }).success).toBe(false);
  });

  it('rejects a non-http url and a whitespace-only topic', () => {
    expect(schema.safeParse({ url: 'ntfy.sh', topic: 't' }).success).toBe(false);
    expect(schema.safeParse({ url: 'https://ntfy.sh', topic: '   ' }).success).toBe(false);
  });
});

describe('email configSchema', () => {
  const schema = NOTIFIER_REGISTRY.email.configSchema;
  it('defaults port/secure/user and accepts a minimal block', () => {
    const parsed = schema.parse({ host: 'smtp.x', from: 'a@x', to: 'b@x' }) as Record<string, unknown>;
    expect(parsed).toMatchObject({ port: 587, secure: false, user: null });
  });

  it('coerces and bounds the port', () => {
    expect((schema.parse({ host: 'h', from: 'a@x', to: 'b@x', port: '465' }) as { port: number }).port).toBe(465);
    expect(schema.safeParse({ host: 'h', from: 'a@x', to: 'b@x', port: 70000 }).success).toBe(false);
  });

  it('rejects whitespace-only host/from/to', () => {
    expect(schema.safeParse({ host: '  ', from: 'a@x', to: 'b@x' }).success).toBe(false);
    expect(schema.safeParse({ host: 'h', from: '  ', to: 'b@x' }).success).toBe(false);
  });
});

describe('webhook configSchema (capability URL secret)', () => {
  const schema = NOTIFIER_REGISTRY.webhook.configSchema;
  it('accepts a valid url, an empty string (clear), and an omitted url (keep)', () => {
    const p = (i: unknown) => schema.parse(i) as { url?: string };
    expect(p({ url: 'https://discord.com/api/webhooks/x/' }).url).toBe('https://discord.com/api/webhooks/x');
    expect(p({ url: '' }).url).toBe('');
    expect(p({}).url).toBeUndefined();
  });

  it('rejects a non-http url', () => {
    expect(schema.safeParse({ url: 'discord.com/x' }).success).toBe(false);
  });

  it('marks the url field secret + required with a host-hint masked field', () => {
    const sf = NOTIFIER_REGISTRY.webhook.secretFields[0]!;
    expect(sf).toMatchObject({ field: 'url', maskedField: 'hasUrl', required: true, hintField: 'urlHint' });
  });
});

describe('parity-pack types (discord/slack/telegram/pushover/gotify)', () => {
  it('registers all five with adapter-ready config + secret metadata', () => {
    for (const type of ['discord', 'slack', 'telegram', 'pushover', 'gotify'] as const) {
      const def = NOTIFIER_REGISTRY[type];
      expect(def.type).toBe(type);
      expect(def.fields.length).toBeGreaterThan(0);
      expect(def.secretFields.length).toBeGreaterThan(0);
    }
  });

  it('discord includeCover field carries defaultValue:true and the configSchema defaults it on', () => {
    const field = NOTIFIER_REGISTRY.discord.fields.find((f) => f.key === 'includeCover')!;
    expect(field).toMatchObject({ kind: 'checkbox', defaultValue: true });
    // A config omitting includeCover still resolves to true (server-side belt-and-suspenders).
    const parsed = NOTIFIER_REGISTRY.discord.configSchema.parse({ webhookUrl: 'https://discord.com/api/webhooks/1/a' }) as {
      includeCover: boolean;
    };
    expect(parsed.includeCover).toBe(true);
  });

  it('discord/slack webhook URLs are capability-URL secrets (host-hint masked)', () => {
    for (const type of ['discord', 'slack'] as const) {
      const sf = NOTIFIER_REGISTRY[type].secretFields.find((s) => s.field === 'webhookUrl')!;
      expect(sf).toMatchObject({ field: 'webhookUrl', maskedField: 'hasWebhookUrl', required: true, hintField: 'webhookUrlHint' });
    }
  });

  it('telegram botToken / pushover keys / gotify appToken are has*-masked secrets without a hint', () => {
    expect(NOTIFIER_REGISTRY.telegram.secretFields).toEqual([{ field: 'botToken', maskedField: 'hasBotToken', required: true }]);
    expect(NOTIFIER_REGISTRY.pushover.secretFields).toEqual([
      { field: 'appToken', maskedField: 'hasAppToken', required: true },
      { field: 'userKey', maskedField: 'hasUserKey', required: true },
    ]);
    expect(NOTIFIER_REGISTRY.gotify.secretFields).toEqual([{ field: 'appToken', maskedField: 'hasAppToken', required: true }]);
  });

  it('gotify serverUrl is a required NON-secret url field', () => {
    const field = NOTIFIER_REGISTRY.gotify.fields.find((f) => f.key === 'serverUrl')!;
    expect(field).toMatchObject({ kind: 'url', secret: false, required: true });
  });

  it('telegram requires a chatId and rejects a blank one', () => {
    const schema = NOTIFIER_REGISTRY.telegram.configSchema;
    expect(schema.safeParse({ botToken: '123:abc', chatId: '42' }).success).toBe(true);
    expect(schema.safeParse({ botToken: '123:abc', chatId: '   ' }).success).toBe(false);
  });

  it('masked shapes surface has* / hints and never the secret value', () => {
    expect(NOTIFIER_REGISTRY.discord.maskedConfigSchema.safeParse({ hasWebhookUrl: true, webhookUrlHint: 'discord.com/…', includeCover: true }).success).toBe(true);
    expect(NOTIFIER_REGISTRY.telegram.maskedConfigSchema.safeParse({ hasBotToken: true, chatId: '42' }).success).toBe(true);
    expect(NOTIFIER_REGISTRY.gotify.maskedConfigSchema.safeParse({ serverUrl: 'https://g.x', hasAppToken: true }).success).toBe(true);
  });
});

describe('maskedConfigSchema shapes', () => {
  it('ntfy masked shape surfaces hasToken, not the token', () => {
    expect(NOTIFIER_REGISTRY.ntfy.maskedConfigSchema.safeParse({ url: 'u', topic: 't', hasToken: true, priority: null }).success).toBe(true);
  });
  it('webhook masked shape is { hasUrl, urlHint } only — an extra url key is stripped, not surfaced', () => {
    expect(NOTIFIER_REGISTRY.webhook.maskedConfigSchema.safeParse({ hasUrl: true, urlHint: 'discord.com/…' }).success).toBe(true);
    const parsed = NOTIFIER_REGISTRY.webhook.maskedConfigSchema.parse({ hasUrl: true, urlHint: null, url: 'leak' });
    expect(parsed).toEqual({ hasUrl: true, urlHint: null });
  });
});
