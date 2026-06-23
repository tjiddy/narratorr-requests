import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// EmailChannel's constructor builds a nodemailer transport — mock it so the email
// notifier constructs without opening a real SMTP connection.
const { createTransport } = vi.hoisted(() => ({ createTransport: vi.fn(() => ({ sendMail: vi.fn() })) }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));

import { buildNotifier, buildNotifierChannel } from './index.js';
import type { NotificationsConfig, NotifierLogger, RuntimeNotifier, NotificationPayload } from './types.js';

function fakeLog(): { log: NotifierLogger; info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } {
  const info = vi.fn();
  const warn = vi.fn();
  return { log: { info, warn, error() {}, debug() {} }, info, warn };
}

const ntfyRuntime = (over: Partial<RuntimeNotifier> = {}): RuntimeNotifier => ({
  id: 'nf_ntfy',
  name: 'phone',
  type: 'ntfy',
  enabled: true,
  events: ['request.created', 'user.pending'],
  config: { url: 'https://ntfy.sh', topic: 'narr', token: null, priority: null },
  ...over,
});

const requestEvent: NotificationPayload = {
  event: 'request.created',
  request: { publicId: 'rq_1', title: 'Dune', author: null, asin: 'B1', coverUrl: null },
  requester: { username: 'todd' },
};
const userEvent: NotificationPayload = {
  event: 'user.pending',
  user: { publicId: 'us_1', username: 'newbie', email: null, authProvider: 'local' },
};

describe('buildNotifierChannel (adapter map)', () => {
  it('builds a live channel for each known type from runtime config', () => {
    expect(buildNotifierChannel('ntfy', { url: 'https://ntfy.sh', topic: 't', token: null, priority: null })?.name).toBe('ntfy');
    expect(buildNotifierChannel('email', { host: 'smtp.x', port: 587, secure: false, user: null, pass: null, from: 'a@x', to: 'b@x' })?.name).toBe('email');
    expect(buildNotifierChannel('webhook', { url: 'https://x/hook' })?.name).toBe('webhook');
  });

  it('returns null for an unknown type', () => {
    expect(buildNotifierChannel('telegram', {})).toBeNull();
  });

  it('throws when the runtime config fails the type schema (e.g. an undecryptable required secret)', () => {
    // webhook url revealed to null (decrypt failed) → runtime schema requires a string.
    expect(() => buildNotifierChannel('webhook', { url: null })).toThrow();
  });
});

describe('buildNotifier', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('includes one channel per enabled, known notifier and logs the set once', () => {
    const { log, info } = fakeLog();
    const cfg: NotificationsConfig = {
      publicUrl: 'https://req.example.com',
      notifiers: [ntfyRuntime({ id: 'a', name: 'one' }), ntfyRuntime({ id: 'b', name: 'two' })],
    };
    const n = buildNotifier(cfg, log);
    expect(n.enabled).toBe(true);
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0]![0]).toEqual({ channels: ['ntfy:one', 'ntfy:two'] });
  });

  it('skips disabled notifiers', () => {
    const { log } = fakeLog();
    const n = buildNotifier({ publicUrl: null, notifiers: [ntfyRuntime({ enabled: false })] }, log);
    expect(n.enabled).toBe(false);
  });

  it('skips an unknown type with a warn, never throwing', () => {
    const { log, warn } = fakeLog();
    const n = buildNotifier({ publicUrl: null, notifiers: [ntfyRuntime({ type: 'telegram', config: {} })] }, log);
    expect(n.enabled).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('skips an unbuildable notifier (bad runtime config) with a warn, keeping the others', () => {
    const { log, warn } = fakeLog();
    const n = buildNotifier(
      { publicUrl: null, notifiers: [{ ...ntfyRuntime({ id: 'bad', type: 'webhook', config: { url: null } }) }, ntfyRuntime({ id: 'ok' })] },
      log,
    );
    expect(n.enabled).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it('event filter: a notifier only fires on events in its list', async () => {
    const { log } = fakeLog();
    const n = buildNotifier({ publicUrl: null, notifiers: [ntfyRuntime({ events: ['user.pending'] })] }, log);

    await n.notify(requestEvent);
    expect(fetchMock).not.toHaveBeenCalled(); // request.created not subscribed

    await n.notify(userEvent);
    expect(fetchMock).toHaveBeenCalledOnce(); // user.pending subscribed
  });

  it('two notifiers of the same type each receive a subscribed event', async () => {
    const { log } = fakeLog();
    const n = buildNotifier(
      { publicUrl: null, notifiers: [ntfyRuntime({ id: 'a', name: 'one' }), ntfyRuntime({ id: 'b', name: 'two' })] },
      log,
    );
    await n.notify(requestEvent);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('an empty notifier list is a no-op dispatcher', () => {
    const { log, info } = fakeLog();
    const n = buildNotifier({ publicUrl: null, notifiers: [] }, log);
    expect(n.enabled).toBe(false);
    expect(info).not.toHaveBeenCalled();
  });
});
