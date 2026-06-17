import { describe, it, expect, vi } from 'vitest';
import { Notifier } from './notifier.service.js';
import type { NotificationChannel, NotifierLogger, SendContext } from './types.js';

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

const payload = {
  request: { publicId: 'rq_1', title: 'Dune', author: 'Frank Herbert', asin: 'B1', coverUrl: 'https://x/c.jpg' },
  requester: { plexUsername: 'todd' },
};

describe('Notifier', () => {
  it('fans the event out to every channel with a rendered message', async () => {
    const a = fakeChannel('a');
    const b = fakeChannel('b');
    const n = new Notifier([a, b], 'https://req.example.com', silentLog);

    await n.notify('request.created', payload);

    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
    expect(a.calls[0]!.message.title).toBe('New audiobook request');
    expect(a.calls[0]!.message.body).toContain('todd');
    expect(a.calls[0]!.message.body).toContain('Dune');
    expect(a.calls[0]!.message.url).toBe('https://req.example.com/admin');
  });

  it('isolates a failing channel — the others still fire and notify resolves', async () => {
    const boom = fakeChannel('boom', async () => {
      throw new Error('down');
    });
    const ok = fakeChannel('ok');
    const warn = vi.fn();
    const n = new Notifier([boom, ok], null, { ...silentLog, warn });

    await expect(n.notify('request.created', payload)).resolves.toBeUndefined();
    expect(ok.calls).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('renders no deep link when no base URL is configured', async () => {
    const a = fakeChannel('a');
    const n = new Notifier([a], null, silentLog);

    await n.notify('request.created', payload);

    expect(a.calls[0]!.message.url).toBeNull();
  });

  it('is a no-op when no channels are configured', async () => {
    const n = new Notifier([], null, silentLog);
    expect(n.enabled).toBe(false);
    await expect(n.notify('request.created', payload)).resolves.toBeUndefined();
  });
});
