import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted so the mock factory can reference them (vi.mock is hoisted above imports).
const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { sendMail, createTransport: vi.fn((_opts?: unknown) => ({ sendMail })) };
});
vi.mock('nodemailer', () => ({
  default: { createTransport },
}));

import { NtfyChannel } from './adapters/ntfy.js';
import { WebhookChannel } from './adapters/webhook.js';
import { EmailChannel } from './adapters/email.js';
import type { SendContext } from './types.js';

const ctx: SendContext = {
  payload: {
    event: 'request.created',
    request: { publicId: 'rq_1', title: 'Dune', author: 'Frank Herbert', asin: 'B1', coverUrl: 'https://x/c.jpg' },
    requester: { username: 'todd' },
  },
  message: {
    title: 'New audiobook request',
    body: 'todd requested “Dune” by Frank Herbert.',
    url: 'https://req.example.com/admin',
  },
};

// A user.pending event carries no request/cover — adapters that read the payload
// directly must narrow on `event` instead of assuming a request is present.
const userCtx: SendContext = {
  payload: {
    event: 'user.pending',
    user: { publicId: 'us_1', username: 'newbie', email: 'newbie@x.com', authProvider: 'authelia' },
  },
  message: {
    title: 'New user awaiting approval',
    body: 'newbie (newbie@x.com) signed up via authelia and is waiting for your approval.',
    url: 'https://req.example.com/users',
  },
};

describe('NtfyChannel', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs the body to <url>/<topic> with title/click/icon headers + bearer', async () => {
    const ch = new NtfyChannel({ url: 'https://ntfy.sh', topic: 'narr', token: 'tok', priority: 'high' });
    await ch.send(ctx);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://ntfy.sh/narr');
    expect(init.method).toBe('POST');
    expect(init.body).toContain('Dune');
    expect(init.headers.Title).toBe('New audiobook request');
    expect(init.headers.Click).toBe('https://req.example.com/admin');
    expect(init.headers.Icon).toBe('https://x/c.jpg');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers.Priority).toBe('high');
  });

  it('throws on a non-2xx response so the dispatcher logs it', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const ch = new NtfyChannel({ url: 'https://ntfy.sh', topic: 'narr', token: null, priority: null });
    await expect(ch.send(ctx)).rejects.toThrow(/500/);
  });

  it('omits the Icon header for an event with no cover (user.pending)', async () => {
    const ch = new NtfyChannel({ url: 'https://ntfy.sh', topic: 'narr', token: null, priority: null });
    await ch.send(userCtx);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers.Icon).toBeUndefined();
    expect(init.headers.Click).toBe('https://req.example.com/users');
  });
});

describe('WebhookChannel', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs JSON with a Discord-compatible content string plus structured fields', async () => {
    const ch = new WebhookChannel({ url: 'https://discord/webhook' });
    await ch.send(ctx);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://discord/webhook');
    expect(init.headers['content-type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.content).toContain('Dune');
    expect(body.content).toContain('https://req.example.com/admin');
    expect(body.event).toBe('request.created');
    expect(body.request.asin).toBe('B1');
    expect(body.requester.username).toBe('todd');
  });

  it('carries the user (not a request) for a user.pending event', async () => {
    const ch = new WebhookChannel({ url: 'https://discord/webhook' });
    await ch.send(userCtx);

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.event).toBe('user.pending');
    expect(body.user.username).toBe('newbie');
    expect(body.request).toBeUndefined();
  });
});

describe('EmailChannel', () => {
  beforeEach(() => {
    sendMail.mockReset();
    sendMail.mockResolvedValue({});
  });

  it('sends mail with subject/to/from and a text+html body carrying the link', async () => {
    const ch = new EmailChannel({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'u',
      pass: 'p',
      from: 'bot@x',
      to: 'admin@x',
    });
    await ch.send(ctx);

    expect(sendMail).toHaveBeenCalledOnce();
    const mail = sendMail.mock.calls[0]![0];
    expect(mail.to).toBe('admin@x');
    expect(mail.from).toBe('bot@x');
    expect(mail.subject).toBe('New audiobook request');
    expect(mail.text).toContain('https://req.example.com/admin');
    expect(mail.html).toContain('Open the request queue');
  });

  it('omits the link and uses the plain body as text when message.url is null', async () => {
    const ch = new EmailChannel({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'u',
      pass: 'p',
      from: 'bot@x',
      to: 'admin@x',
    });
    await ch.send({ payload: ctx.payload, message: { ...ctx.message, url: null } });

    const mail = sendMail.mock.calls[0]![0];
    expect(mail.html).not.toContain('<a');
    expect(mail.text).toBe(ctx.message.body);
  });

  it('propagates a sendMail rejection so the dispatcher can log it', async () => {
    sendMail.mockRejectedValueOnce(new Error('smtp down'));
    const ch = new EmailChannel({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'u',
      pass: 'p',
      from: 'bot@x',
      to: 'admin@x',
    });
    await expect(ch.send(ctx)).rejects.toThrow(/smtp down/);
  });

  it('builds the transport without an auth block when user/pass are absent', () => {
    createTransport.mockClear();
    new EmailChannel({
      host: 'smtp.example.com',
      port: 25,
      secure: false,
      user: null,
      pass: null,
      from: 'bot@x',
      to: 'admin@x',
    });

    expect(createTransport).toHaveBeenCalledOnce();
    const opts = createTransport.mock.calls[0]![0];
    expect(opts).not.toHaveProperty('auth');
  });
});
