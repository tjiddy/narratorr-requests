import { describe, it, expect, vi } from 'vitest';

// EmailChannel's constructor builds a nodemailer transport — mock it so the email
// block constructs without opening a real SMTP connection (same shape as adapters.test.ts).
const { createTransport } = vi.hoisted(() => ({ createTransport: vi.fn(() => ({ sendMail: vi.fn() })) }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));

import { buildChannel, buildNotifier } from './index.js';
import type { NotificationsConfig, NotifierLogger } from './types.js';

const fullConfig: NotificationsConfig = {
  publicUrl: 'https://req.example.com',
  ntfy: { url: 'https://ntfy.sh', topic: 'narr', token: null, priority: null },
  email: {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    user: null,
    pass: null,
    from: 'bot@x',
    to: 'admin@x',
  },
  webhook: { url: 'https://discord/webhook' },
};

const emptyConfig: NotificationsConfig = { publicUrl: null, ntfy: null, email: null, webhook: null };

function fakeLog(): { log: NotifierLogger; info: ReturnType<typeof vi.fn> } {
  const info = vi.fn();
  return { log: { info, warn() {}, error() {}, debug() {} }, info };
}

describe('buildNotifier', () => {
  it('wires all three channels in registry order and logs the enabled set once', () => {
    const { log, info } = fakeLog();
    const notifier = buildNotifier(fullConfig, log);

    expect(notifier.enabled).toBe(true);
    expect(info).toHaveBeenCalledOnce();
    // Channel order is observable via the log payload (no private-field peek needed).
    expect(info.mock.calls[0]![0]).toEqual({ channels: ['ntfy', 'email', 'webhook'] });
  });

  it('builds a disabled no-op notifier and logs nothing when nothing is configured', () => {
    const { log, info } = fakeLog();
    const notifier = buildNotifier(emptyConfig, log);

    expect(notifier.enabled).toBe(false);
    expect(info).not.toHaveBeenCalled();
  });
});

describe('buildChannel', () => {
  it('returns a live channel for each populated block', () => {
    expect(buildChannel('ntfy', fullConfig)?.name).toBe('ntfy');
    expect(buildChannel('email', fullConfig)?.name).toBe('email');
    expect(buildChannel('webhook', fullConfig)?.name).toBe('webhook');
  });

  it('returns null for each unconfigured block', () => {
    expect(buildChannel('ntfy', emptyConfig)).toBeNull();
    expect(buildChannel('email', emptyConfig)).toBeNull();
    expect(buildChannel('webhook', emptyConfig)).toBeNull();
  });
});
