import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../test-support/db.js';
import { SettingsService } from './settings.service.js';
import { ConnectorSettingsService } from './connector-settings.service.js';
import { SecretCodec, deriveSettingsKey } from '../util/secret-codec.js';
import type { Db } from '../../db/client.js';

const codec = new SecretCodec(deriveSettingsKey({ sessionSecret: 'test' }));
let db: Db;
let svc: ConnectorSettingsService;

beforeEach(async () => {
  db = await createTestDb();
  await new SettingsService(db).ensure(10); // create the singleton row update() targets
  svc = new ConnectorSettingsService(db, codec);
});

describe('ConnectorSettingsService', () => {
  it('starts empty — no env seeding', async () => {
    const dto = await svc.getDto();
    expect(dto.narratorr).toBeNull();
    expect(dto.ntfy).toBeNull();
    expect(await svc.getNarratorrConfig()).toBeNull();
  });

  it('stores the narratorr key encrypted, exposes it decrypted for runtime', async () => {
    await svc.update({ narratorr: { host: 'n.example.com', port: 443, useSsl: true, apiKey: 'secret-key' } });
    const stored = await svc.getStored();
    expect(stored.narratorr?.apiKey).toBeDefined();
    expect(codec.isEncrypted(stored.narratorr!.apiKey)).toBe(true);
    expect(stored.narratorr!.apiKey).not.toContain('secret-key');
    expect(await svc.getNarratorrConfig()).toEqual({ url: 'https://n.example.com:443', apiKey: 'secret-key' });
  });

  it('composes the effective base URL from the discrete fields', async () => {
    // http, no urlBase → host:port; private/internal hosts compose and are returned.
    await svc.update({ narratorr: { host: 'narratorr', port: 3000, useSsl: false, apiKey: 'k' } });
    expect((await svc.getNarratorrConfig())?.url).toBe('http://narratorr:3000');

    await svc.update({ narratorr: { host: '192.168.1.10', port: 8080, useSsl: false, apiKey: 'k' } });
    expect((await svc.getNarratorrConfig())?.url).toBe('http://192.168.1.10:8080');

    await svc.update({ narratorr: { host: 'localhost', port: 3000, useSsl: false, apiKey: 'k' } });
    expect((await svc.getNarratorrConfig())?.url).toBe('http://localhost:3000');

    // https + urlBase subpath, no trailing slash.
    await svc.update({ narratorr: { host: 'books.example.com', port: 443, useSsl: true, urlBase: '/lib', apiKey: 'k' } });
    expect((await svc.getNarratorrConfig())?.url).toBe('https://books.example.com:443/lib');
  });

  it('masks secrets in the DTO', async () => {
    await svc.update({
      narratorr: { host: 'n', port: 3000, useSsl: false, apiKey: 'abc' },
      ntfy: { url: 'https://ntfy.sh', topic: 't', token: 'super-secret-token' },
    });
    const dto = await svc.getDto();
    expect(dto.narratorr).toEqual({ host: 'n', port: 3000, useSsl: false, urlBase: null, hasApiKey: true });
    expect(dto.ntfy).toEqual({ url: 'https://ntfy.sh', topic: 't', hasToken: true, priority: null });
    expect(JSON.stringify(dto)).not.toContain('super-secret-token');
    expect(JSON.stringify(dto)).not.toContain('abc');
  });

  it('keeps the existing secret when the update omits it', async () => {
    await svc.update({ narratorr: { host: 'n', port: 3000, useSsl: false, apiKey: 'orig-key' } });
    // host/port/SSL changed, apiKey omitted → existing key preserved (omit-to-keep).
    await svc.update({ narratorr: { host: 'n2', port: 9000, useSsl: true } });
    expect(await svc.getNarratorrConfig()).toEqual({ url: 'https://n2:9000', apiKey: 'orig-key' });
  });

  it('rejects apiKey: "" on a non-null narratorr object (empty key never clears or persists keyless)', async () => {
    await svc.update({ narratorr: { host: 'n', port: 3000, useSsl: false, apiKey: 'orig' } });
    await expect(
      svc.update({ narratorr: { host: 'n', port: 3000, useSsl: false, apiKey: '' } }),
    ).rejects.toMatchObject({ statusCode: 400 });
    // The prior config is untouched — the rejected update did not persist a keyless record.
    expect((await svc.getNarratorrConfig())?.apiKey).toBe('orig');
  });

  it('clears narratorr (and drops the key) when set to null', async () => {
    await svc.update({ narratorr: { host: 'n', port: 3000, useSsl: false, apiKey: 'k' } });
    await svc.update({ narratorr: null });
    expect((await svc.getDto()).narratorr).toBeNull();
    expect(await svc.getNarratorrConfig()).toBeNull();
  });

  it('clears a notification secret when an empty string is sent', async () => {
    await svc.update({ ntfy: { url: 'https://ntfy.sh', topic: 't', token: 'tok' } });
    await svc.update({ ntfy: { url: 'https://ntfy.sh', topic: 't', token: '' } });
    expect((await svc.getNotificationsConfig()).ntfy?.token).toBeNull();
  });

  it('rejects enabling narratorr without an API key', async () => {
    await expect(
      svc.update({ narratorr: { host: 'n', port: 3000, useSsl: false } }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('disables a connector when set to null', async () => {
    await svc.update({ ntfy: { url: 'https://ntfy.sh', topic: 't', token: 'tok' } });
    await svc.update({ ntfy: null });
    expect((await svc.getDto()).ntfy).toBeNull();
  });

  it('keeps the email username when the update omits it', async () => {
    await svc.update({ email: { host: 'smtp.x', from: 'a@x', to: 'b@x', user: 'bob' } });
    await svc.update({ email: { host: 'smtp.x', from: 'a@x', to: 'b@x' } }); // user omitted
    expect((await svc.getNotificationsConfig()).email?.user).toBe('bob');
  });

  it('treats a secret encrypted under a different key as unconfigured, and warns', async () => {
    await svc.update({ narratorr: { host: 'n', port: 3000, useSsl: false, apiKey: 'k' } });
    // A fresh service with a DIFFERENT key (simulates SESSION_SECRET rotation).
    const otherCodec = new SecretCodec(deriveSettingsKey({ sessionSecret: 'rotated' }));
    const warn = vi.fn();
    const stranded = new ConnectorSettingsService(db, otherCodec, { warn });
    expect(await stranded.getNarratorrConfig()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('update() throws (not silent no-op) when the singleton row is missing', async () => {
    const bare = await createTestDb(); // no SettingsService.ensure()
    const svc2 = new ConnectorSettingsService(bare, codec);
    await expect(svc2.update({ webhook: { url: 'https://x/hook' } })).rejects.toThrow();
  });
});
