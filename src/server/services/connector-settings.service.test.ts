import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../test-support/db.js';
import { SettingsService } from './settings.service.js';
import { ConnectorSettingsService } from './connector-settings.service.js';
import { SecretCodec, deriveSettingsKey } from '../util/secret-codec.js';
import { appSettings } from '../../db/schema.js';
import type { Db } from '../../db/client.js';
import type { CreateNotifierBody, KnownNotifierDto, StoredConnectors } from '../../shared/schemas/connectors.js';

const codec = new SecretCodec(deriveSettingsKey({ sessionSecret: 'test' }));
let db: Db;
let svc: ConnectorSettingsService;

beforeEach(async () => {
  db = await createTestDb();
  await new SettingsService(db).ensure(10); // create the singleton row update() targets
  svc = new ConnectorSettingsService(db, codec);
});

const ntfyBody = (over: Partial<CreateNotifierBody> = {}): CreateNotifierBody => ({
  name: 'Phone',
  type: 'ntfy',
  enabled: true,
  events: ['request.created'],
  config: { url: 'https://ntfy.sh', topic: 'reqs' },
  ...over,
});

describe('ConnectorSettingsService — narratorr (unchanged behavior)', () => {
  it('starts empty — no env seeding, empty notifier list', async () => {
    const dto = await svc.getDto();
    expect(dto.narratorr).toBeNull();
    expect(dto.notifiers).toEqual([]);
    expect(await svc.getNarratorrConfig()).toBeNull();
  });

  it('stores the key encrypted, exposes it decrypted, composes the URL', async () => {
    await svc.update({ narratorr: { host: 'n.example.com', port: 443, useSsl: true, apiKey: 'secret-key' } });
    const stored = await svc.getStored();
    expect(codec.isEncrypted(stored.narratorr!.apiKey)).toBe(true);
    expect(stored.narratorr!.apiKey).not.toContain('secret-key');
    expect(await svc.getNarratorrConfig()).toEqual({ url: 'https://n.example.com:443', apiKey: 'secret-key' });
  });

  it('brackets a bare IPv6 host', async () => {
    await svc.update({ narratorr: { host: '::1', port: 3000, useSsl: false, apiKey: 'k' } });
    expect((await svc.getNarratorrConfig())?.url).toBe('http://[::1]:3000');
  });

  it('omit-to-keep apiKey; rejects clearing the required key; null clears the connection', async () => {
    await svc.update({ narratorr: { host: 'n', port: 3000, useSsl: false, apiKey: 'orig' } });
    await svc.update({ narratorr: { host: 'n2', port: 9000, useSsl: true } });
    expect(await svc.getNarratorrConfig()).toEqual({ url: 'https://n2:9000', apiKey: 'orig' });

    await expect(svc.update({ narratorr: { host: 'n2', port: 9000, useSsl: true, apiKey: '' } })).rejects.toMatchObject({ statusCode: 400 });

    await svc.update({ narratorr: null });
    expect(await svc.getNarratorrConfig()).toBeNull();
  });

  it('leaves the notifier list untouched on a narratorr PUT', async () => {
    await svc.createNotifier(ntfyBody());
    await svc.update({ publicUrl: 'https://app.example.com' });
    expect((await svc.getStored()).notifiers).toHaveLength(1);
  });
});

describe('ConnectorSettingsService — notifier CRUD + secret discipline', () => {
  it('creates an ntfy notifier; getNotificationsConfig reveals the decrypted token at runtime', async () => {
    const nf = await svc.createNotifier(ntfyBody({ config: { url: 'https://ntfy.sh', topic: 'reqs', token: 'super-secret' } }));
    expect(nf.id).toMatch(/^nf_/);
    const stored = (await svc.getStored()).notifiers[0]!;
    expect(codec.isEncrypted(stored.config.token as string)).toBe(true);

    const runtime = (await svc.getNotificationsConfig()).notifiers[0]!;
    expect(runtime.config).toMatchObject({ url: 'https://ntfy.sh', topic: 'reqs', token: 'super-secret' });
    expect(runtime.events).toEqual(['request.created']);
    expect(runtime.enabled).toBe(true);
  });

  it('masks secrets in the DTO — neither the plaintext nor an enc blob ever appears', async () => {
    await svc.createNotifier(ntfyBody({ config: { url: 'https://ntfy.sh', topic: 'reqs', token: 'super-secret-token' } }));
    const dto = await svc.getDto();
    const known = dto.notifiers[0]!;
    expect(known).toMatchObject({ type: 'ntfy', config: { hasToken: true } });
    const json = JSON.stringify(dto);
    expect(json).not.toContain('super-secret-token');
    expect(json).not.toContain('enc:v1:');
  });

  it('create requires a required secret (webhook url) — 400 when missing', async () => {
    await expect(
      svc.createNotifier({ name: 'Discord', type: 'webhook', enabled: true, events: ['request.created'], config: {} }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'NOTIFIER_SECRET_REQUIRED' });
  });

  it('capability URL (webhook) is encrypted at rest and masked to a host hint, never the full URL', async () => {
    await svc.createNotifier({
      name: 'Discord',
      type: 'webhook',
      enabled: true,
      events: ['request.created'],
      config: { url: 'https://discord.com/api/webhooks/123/abcdef' },
    });
    const stored = (await svc.getStored()).notifiers[0]!;
    expect(codec.isEncrypted(stored.config.url as string)).toBe(true);

    const dto = await svc.getDto();
    const config = (dto.notifiers[0] as KnownNotifierDto).config;
    expect(config).toEqual({ hasUrl: true, urlHint: 'discord.com/…' });
    expect(JSON.stringify(dto)).not.toContain('/abcdef');
  });

  it('edit is omit-to-keep by id; "" clears; a new value replaces — all by notifier id', async () => {
    const a = await svc.createNotifier(ntfyBody({ name: 'A', config: { url: 'https://ntfy.sh', topic: 'a', token: 'tok-a' } }));
    const b = await svc.createNotifier(ntfyBody({ name: 'B', config: { url: 'https://ntfy.sh', topic: 'b', token: 'tok-b' } }));

    // Edit A's name only (token omitted) → A keeps tok-a, B untouched.
    await svc.updateNotifier(a.id, ntfyBody({ name: 'A2', config: { url: 'https://ntfy.sh', topic: 'a' } }));
    const cfgA = (await svc.getNotificationsConfig()).notifiers.find((n) => n.id === a.id)!;
    expect(cfgA.name).toBe('A2');
    expect(cfgA.config.token).toBe('tok-a');
    const cfgB = (await svc.getNotificationsConfig()).notifiers.find((n) => n.id === b.id)!;
    expect(cfgB.config.token).toBe('tok-b');

    // '' clears A's token; a new value replaces.
    await svc.updateNotifier(a.id, ntfyBody({ name: 'A2', config: { url: 'https://ntfy.sh', topic: 'a', token: '' } }));
    expect((await svc.getNotificationsConfig()).notifiers.find((n) => n.id === a.id)!.config.token).toBeNull();
    await svc.updateNotifier(a.id, ntfyBody({ name: 'A2', config: { url: 'https://ntfy.sh', topic: 'a', token: 'tok-a3' } }));
    expect((await svc.getNotificationsConfig()).notifiers.find((n) => n.id === a.id)!.config.token).toBe('tok-a3');
  });

  it('updateNotifier / deleteNotifier 404 on a missing id; delete removes by id', async () => {
    await expect(svc.updateNotifier('nf_missing', ntfyBody())).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.deleteNotifier('nf_missing')).rejects.toMatchObject({ statusCode: 404 });

    const nf = await svc.createNotifier(ntfyBody());
    await svc.deleteNotifier(nf.id);
    expect((await svc.getStored()).notifiers).toHaveLength(0);
  });

  it('rejects an invalid type-specific config with a 400 (NOTIFIER_CONFIG_INVALID)', async () => {
    await expect(
      svc.createNotifier(ntfyBody({ config: { url: 'not-a-url', topic: 't' } })),
    ).rejects.toMatchObject({ statusCode: 400, code: 'NOTIFIER_CONFIG_INVALID' });
  });
});

describe('ConnectorSettingsService — never-brick (undecryptable) + unknown type', () => {
  it('a notifier with an undecryptable secret still lists, GET never throws, runtime token degrades to null', async () => {
    await svc.createNotifier(ntfyBody({ config: { url: 'https://ntfy.sh', topic: 'reqs', token: 'tok' } }));
    // A fresh service with a DIFFERENT key (SESSION_SECRET rotation).
    const warn = vi.fn();
    const stranded = new ConnectorSettingsService(db, new SecretCodec(deriveSettingsKey({ sessionSecret: 'rotated' })), { warn });

    const dto = await stranded.getDto(); // must not throw
    expect(dto.notifiers).toHaveLength(1);
    expect(dto.notifiers[0]).toMatchObject({ type: 'ntfy', config: { hasToken: true } }); // still listed + editable

    const runtime = (await stranded.getNotificationsConfig()).notifiers[0]!;
    expect(runtime.config.token).toBeNull(); // decrypt failed → degraded
    expect(warn).toHaveBeenCalled();
  });

  it('an undecryptable webhook capability URL masks to "configured" (host unknown), never throws', async () => {
    await svc.createNotifier({ name: 'D', type: 'webhook', enabled: true, events: ['request.created'], config: { url: 'https://discord.com/api/webhooks/x/y' } });
    const stranded = new ConnectorSettingsService(db, new SecretCodec(deriveSettingsKey({ sessionSecret: 'rotated' })), { warn() {} });
    const config = ((await stranded.getDto()).notifiers[0] as KnownNotifierDto).config;
    expect(config).toEqual({ hasUrl: true, urlHint: 'configured' });
  });

  // Directly seed an arbitrary stored notifier list (type-lenient persistence) so a row can be
  // malformed in ways the write path would normally reject — the GET must survive it.
  async function seedNotifiers(notifiers: unknown[]): Promise<void> {
    // Type-lenient persistence: cast to bypass the StoredNotifier shape so a row can be malformed
    // in ways the write path would reject (bad events/config) — exactly what the GET must survive.
    const connectors = { publicUrl: null, narratorr: null, notifiers } as unknown as StoredConnectors;
    await db.update(appSettings).set({ connectors }).where(eq(appSettings.id, 1));
  }

  it('a known notifier with a malformed config degrades to a disabled, deletable unknown DTO (GET never throws, warns)', async () => {
    // ntfy row missing its required `url`/`priority` → masked config fails the schema.
    await seedNotifiers([{ id: 'nf_bad', name: 'Broken', type: 'ntfy', enabled: true, events: ['request.created'], config: { topic: 'x' } }]);
    const warn = vi.fn();
    const logged = new ConnectorSettingsService(db, codec, { warn });

    const dto = await logged.getDto(); // must not throw
    expect(dto.notifiers[0]).toEqual({ id: 'nf_bad', name: 'Broken', type: 'ntfy', enabled: false, events: ['request.created'], unknown: true });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ notifier: 'nf_bad' }), expect.any(String));
  });

  it('a known notifier with malformed events degrades to events: [] (GET returns, warns; valid events preserved)', async () => {
    await seedNotifiers([
      { id: 'nf_evt', name: 'BadEvents', type: 'ntfy', enabled: true, events: ['nope.invalid'], config: { url: 'https://ntfy.sh', topic: 't', priority: null } },
    ]);
    const warn = vi.fn();
    const logged = new ConnectorSettingsService(db, codec, { warn });

    const dto = await logged.getDto(); // must not throw
    const row = dto.notifiers[0] as KnownNotifierDto;
    expect(row).toMatchObject({ id: 'nf_evt', type: 'ntfy', events: [] }); // bad events degraded, config still masked
    expect(row.config).toMatchObject({ hasToken: false, topic: 't' });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ notifier: 'nf_evt' }), expect.any(String));
  });

  it('a well-formed notifier alongside a broken one still returns its normal masked DTO with events intact', async () => {
    await seedNotifiers([
      { id: 'nf_bad', name: 'Broken', type: 'ntfy', enabled: true, events: ['request.created'], config: { topic: 'x' } },
      { id: 'nf_ok', name: 'Good', type: 'ntfy', enabled: true, events: ['request.created'], config: { url: 'https://ntfy.sh', topic: 'ok', priority: null } },
    ]);
    const dto = await new ConnectorSettingsService(db, codec, { warn() {} }).getDto();
    expect(dto.notifiers[0]).toMatchObject({ id: 'nf_bad', unknown: true });
    const ok = dto.notifiers[1] as KnownNotifierDto;
    expect(ok).toMatchObject({ id: 'nf_ok', type: 'ntfy', enabled: true, events: ['request.created'], config: { hasToken: false, topic: 'ok' } });
  });

  it('a stored notifier whose type is an inherited prototype key degrades to a disabled, deletable unknown DTO (no 500)', async () => {
    // `constructor`/`__proto__` would be `type in NOTIFIER_REGISTRY` === true (inherited), then
    // resolve a prototype member as a "def" and throw on `def.fields` → 500 on the Settings GET.
    // The own-property guard classifies them as unknown → never-brick degraded row.
    for (const type of ['constructor', '__proto__']) {
      await seedNotifiers([{ id: 'nf_proto', name: 'Proto', type, enabled: true, events: ['request.created'], config: {} }]);
      const dto = await new ConnectorSettingsService(db, codec, { warn() {} }).getDto(); // must not throw
      expect(dto.notifiers[0], type).toEqual({
        id: 'nf_proto',
        name: 'Proto',
        type,
        enabled: false,
        events: ['request.created'],
        unknown: true,
      });
    }
  });

  it('a stored notifier whose type is not in the registry is preserved as a disabled, deletable UnknownNotifierDto', async () => {
    // Inject a stored row directly with an out-of-registry type (type-lenient persistence).
    await db
      .update(appSettings)
      .set({
        connectors: {
          publicUrl: null,
          narratorr: null,
          notifiers: [{ id: 'nf_legacy', name: 'Legacy', type: 'apprise', enabled: true, events: ['user.pending'], config: { token: 'enc:v1:x' } }],
        },
      })
      .where(eq(appSettings.id, 1));

    const dto = await svc.getDto();
    expect(dto.notifiers[0]).toEqual({ id: 'nf_legacy', name: 'Legacy', type: 'apprise', enabled: false, events: ['user.pending'], unknown: true });

    // It can still be deleted (delete works from stored metadata, no decrypt needed).
    await svc.deleteNotifier('nf_legacy');
    expect((await svc.getStored()).notifiers).toHaveLength(0);
  });
});

describe('ConnectorSettingsService — updateNotifier type change', () => {
  it('rejects changing the type AWAY from an unknown (out-of-registry) stored type; row left untouched', async () => {
    const before = { id: 'nf_legacy', name: 'Legacy', type: 'apprise', enabled: true, events: ['user.pending'], config: { token: 'enc:v1:x' } };
    const connectors = { publicUrl: null, narratorr: null, notifiers: [before] } as unknown as StoredConnectors;
    await db.update(appSettings).set({ connectors }).where(eq(appSettings.id, 1));

    await expect(
      svc.updateNotifier('nf_legacy', ntfyBody({ name: 'Hijacked' })),
    ).rejects.toMatchObject({ statusCode: 400, code: 'NOTIFIER_TYPE_LOCKED' });

    // No .set() side effect — the stored row is byte-for-byte unchanged.
    expect((await svc.getStored()).notifiers).toEqual([before]);
  });

  it('known→known type change re-requires the new type’s required secret (omit webhook url → 400)', async () => {
    const nf = await svc.createNotifier(ntfyBody());
    await expect(
      svc.updateNotifier(nf.id, { name: nf.name, type: 'webhook', enabled: true, events: ['request.created'], config: {} }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'NOTIFIER_SECRET_REQUIRED' });
  });

  it('known→known type change persists when the new required secret is supplied', async () => {
    const nf = await svc.createNotifier(ntfyBody());
    const updated = await svc.updateNotifier(nf.id, {
      name: nf.name,
      type: 'webhook',
      enabled: true,
      events: ['request.created'],
      config: { url: 'https://discord.com/api/webhooks/1/abc' },
    });
    expect(updated.type).toBe('webhook');
    const stored = (await svc.getStored()).notifiers[0]!;
    expect(stored.type).toBe('webhook');
    expect(codec.isEncrypted(stored.config.url as string)).toBe(true);
    // The new config is live (decrypts to the supplied URL); no ntfy keys linger.
    const runtime = (await svc.getNotificationsConfig()).notifiers[0]!;
    expect(runtime.config.url).toBe('https://discord.com/api/webhooks/1/abc');
    expect(runtime.config.topic).toBeUndefined();
  });
});

describe('ConnectorSettingsService — required-secret symmetry on update', () => {
  it('rejects clearing a required capability-URL secret on update (webhook url → "" → 400)', async () => {
    const nf = await svc.createNotifier({
      name: 'W',
      type: 'webhook',
      enabled: true,
      events: ['request.created'],
      config: { url: 'https://discord.com/api/webhooks/1/abc' },
    });
    await expect(
      svc.updateNotifier(nf.id, { name: 'W', type: 'webhook', enabled: true, events: ['request.created'], config: { url: '' } }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'NOTIFIER_SECRET_REQUIRED' });
  });

  it('rejects clearing a required token secret on update (pushover appToken → "" → 400)', async () => {
    const nf = await svc.createNotifier({
      name: 'P',
      type: 'pushover',
      enabled: true,
      events: ['request.created'],
      config: { appToken: 'a-tok', userKey: 'u-key' },
    });
    await expect(
      svc.updateNotifier(nf.id, { name: 'P', type: 'pushover', enabled: true, events: ['request.created'], config: { appToken: '', userKey: 'u-key' } }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'NOTIFIER_SECRET_REQUIRED' });
  });

  it('omitting a required secret on update keeps the stored secret (round-trips; has* stays true)', async () => {
    const nf = await svc.createNotifier({
      name: 'W',
      type: 'webhook',
      enabled: true,
      events: ['request.created'],
      config: { url: 'https://discord.com/api/webhooks/1/abc' },
    });
    // url omitted → keep the stored, encrypted secret.
    await svc.updateNotifier(nf.id, { name: 'W2', type: 'webhook', enabled: true, events: ['request.created'], config: {} });
    const stored = (await svc.getStored()).notifiers[0]!;
    expect(codec.isEncrypted(stored.config.url as string)).toBe(true);
    expect(((await svc.getDto()).notifiers[0] as KnownNotifierDto).config).toMatchObject({ hasUrl: true });
    const runtime = (await svc.getNotificationsConfig()).notifiers[0]!;
    expect(runtime.config.url).toBe('https://discord.com/api/webhooks/1/abc'); // round-trips
  });
});

describe('ConnectorSettingsService — Discord/Slack create-time required secret', () => {
  for (const type of ['discord', 'slack'] as const) {
    it(`create ${type} with no webhookUrl → 400 NOTIFIER_SECRET_REQUIRED`, async () => {
      await expect(
        svc.createNotifier({ name: type, type, enabled: true, events: ['request.created'], config: {} }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'NOTIFIER_SECRET_REQUIRED' });
    });

    it(`create ${type} with an explicit blank webhookUrl ('') → 400 NOTIFIER_SECRET_REQUIRED`, async () => {
      // The registry schema intentionally ACCEPTS '' (httpUrl.or(z.literal('')).optional()) — the
      // blank rejection lives in resolveNotifierConfig (resolveSecret('') → null → required). This
      // pins that branch: an omitted-only test would still pass if the resolver guard were removed.
      await expect(
        svc.createNotifier({ name: type, type, enabled: true, events: ['request.created'], config: { webhookUrl: '' } }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'NOTIFIER_SECRET_REQUIRED' });
    });
  }

  it('create discord with includeCover but no webhookUrl → 400 NOTIFIER_SECRET_REQUIRED', async () => {
    await expect(
      svc.createNotifier({ name: 'discord', type: 'discord', enabled: true, events: ['request.created'], config: { includeCover: true } }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'NOTIFIER_SECRET_REQUIRED' });
  });
});

describe('ConnectorSettingsService — candidate test build (no DB write)', () => {
  it('omit-to-keep against the stored notifier by id → plaintext for the probe', async () => {
    const nf = await svc.createNotifier(ntfyBody({ config: { url: 'https://ntfy.sh', topic: 'reqs', token: 'stored-tok' } }));
    const candidate = await svc.buildCandidateNotifier({ type: 'ntfy', id: nf.id, config: { url: 'https://ntfy.sh', topic: 'reqs' } });
    expect(candidate.config.token).toBe('stored-tok'); // omitted → stored, decrypted in-memory
  });

  it('a freshly-typed secret overrides the stored one; no id → as-given', async () => {
    const candidate = await svc.buildCandidateNotifier({ type: 'ntfy', config: { url: 'https://ntfy.sh', topic: 'reqs', token: 'typed' } });
    expect(candidate.config.token).toBe('typed');
  });
});
