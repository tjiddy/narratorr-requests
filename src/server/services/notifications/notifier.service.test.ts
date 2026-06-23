import { describe, it, expect, vi } from 'vitest';
import { Notifier } from './notifier.service.js';
import type { NotificationChannel, NotificationPayload, NotifierLogger, SendContext } from './types.js';

const silentLog: NotifierLogger = { info() {}, warn() {}, error() {}, debug() {} };

function fakeChannel(
  name: string,
  impl?: (ctx: SendContext) => Promise<void>,
): NotificationChannel & { calls: SendContext[] } {
  const calls: SendContext[] = [];
  return {
    name,
    calls,
    async send(ctx) {
      calls.push(ctx);
      if (impl) await impl(ctx);
    },
  };
}

const payload: NotificationPayload = {
  event: 'request.created',
  request: { publicId: 'rq_1', title: 'Dune', author: 'Frank Herbert', asin: 'B1', coverUrl: 'https://x/c.jpg' },
  requester: { username: 'todd' },
};

const userPending: NotificationPayload = {
  event: 'user.pending',
  user: { publicId: 'us_1', username: 'newbie', email: 'newbie@x.com', authProvider: 'authelia' },
};

describe('Notifier', () => {
  it('fans the event out to every channel with a rendered message', async () => {
    const a = fakeChannel('a');
    const b = fakeChannel('b');
    const n = new Notifier([a, b], 'https://req.example.com', silentLog);

    await n.notify(payload);

    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
    expect(a.calls[0]!.message.title).toBe('New audiobook request');
    expect(a.calls[0]!.message.body).toContain('todd');
    expect(a.calls[0]!.message.body).toContain('Dune');
    expect(a.calls[0]!.message.url).toBe('https://req.example.com/admin');
  });

  it('renders a user.pending event and deep-links to the Users page', async () => {
    const a = fakeChannel('a');
    const n = new Notifier([a], 'https://req.example.com', silentLog);

    await n.notify(userPending);

    expect(a.calls[0]!.message.title).toBe('New user awaiting approval');
    expect(a.calls[0]!.message.body).toContain('newbie');
    expect(a.calls[0]!.message.body).toContain('authelia');
    // Approving a user happens on /users, not the request queue.
    expect(a.calls[0]!.message.url).toBe('https://req.example.com/users');
  });

  it('isolates a failing channel — the others still fire and notify resolves', async () => {
    const boom = fakeChannel('boom', async () => {
      throw new Error('down');
    });
    const ok = fakeChannel('ok');
    const warn = vi.fn();
    const n = new Notifier([boom, ok], null, { ...silentLog, warn });

    await expect(n.notify(payload)).resolves.toBeUndefined();
    expect(ok.calls).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('redacts a secret-bearing adapter error before logging it (dispatcher log sink)', async () => {
    // A network error from a capability-URL adapter can embed the full webhook URL — the
    // dispatcher must pass it through redact() so the secret never reaches the log line.
    const leaky = fakeChannel('slack', async () => {
      throw new Error('request to https://hooks.slack.com/services/T0/B0/XXXXSECRETXXXX failed');
    });
    const warn = vi.fn();
    const n = new Notifier([leaky], null, { ...silentLog, warn });

    await n.notify(payload);

    expect(warn).toHaveBeenCalledOnce();
    const logged = JSON.stringify(warn.mock.calls[0]![0]);
    expect(logged).not.toContain('XXXXSECRETXXXX');
    expect(logged).not.toContain('T0/B0');
  });

  it('renders no deep link when no base URL is configured', async () => {
    const a = fakeChannel('a');
    const n = new Notifier([a], null, silentLog);

    await n.notify(payload);

    expect(a.calls[0]!.message.url).toBeNull();
  });

  it('is a no-op when no channels are configured', async () => {
    const n = new Notifier([], null, silentLog);
    expect(n.enabled).toBe(false);
    await expect(n.notify(payload)).resolves.toBeUndefined();
  });
});
