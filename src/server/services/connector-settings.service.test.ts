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
    await svc.update({ narratorr: { url: 'https://n.example.com', apiKey: 'secret-key' } });
    const stored = await svc.getStored();
    expect(stored.narratorr?.apiKey).toBeDefined();
    expect(codec.isEncrypted(stored.narratorr!.apiKey)).toBe(true);
    expect(stored.narratorr!.apiKey).not.toContain('secret-key');
    expect(await svc.getNarratorrConfig()).toEqual({ url: 'https://n.example.com', apiKey: 'secret-key' });
  });

  it('masks secrets in the DTO', async () => {
    await svc.update({
      narratorr: { url: 'https://n', apiKey: 'abc' },
      ntfy: { url: 'https://ntfy.sh', topic: 't', token: 'super-secret-token' },
    });
    const dto = await svc.getDto();
    expect(dto.narratorr).toEqual({ url: 'https://n', hasApiKey: true });
    expect(dto.ntfy).toEqual({ url: 'https://ntfy.sh', topic: 't', hasToken: true, priority: null });
    expect(JSON.stringify(dto)).not.toContain('super-secret-token');
  });

  it('keeps the existing secret when the update omits it', async () => {
    await svc.update({ narratorr: { url: 'https://n', apiKey: 'orig-key' } });
    await svc.update({ narratorr: { url: 'https://n2' } }); // url only, apiKey omitted
    expect(await svc.getNarratorrConfig()).toEqual({ url: 'https://n2', apiKey: 'orig-key' });
  });

  it('clears a notification secret when an empty string is sent', async () => {
    await svc.update({ ntfy: { url: 'https://ntfy.sh', topic: 't', token: 'tok' } });
    await svc.update({ ntfy: { url: 'https://ntfy.sh', topic: 't', token: '' } });
    expect((await svc.getNotificationsConfig()).ntfy?.token).toBeNull();
  });

  it('rejects enabling narratorr without an API key', async () => {
    await expect(svc.update({ narratorr: { url: 'https://n' } })).rejects.toMatchObject({ statusCode: 400 });
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
    await svc.update({ narratorr: { url: 'https://n', apiKey: 'k' } });
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
