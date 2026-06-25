import { describe, it, expect } from 'vitest';
import { render } from './render.js';
import type { NotificationPayload } from './types.js';

const failed = (over: Partial<{ author: string | null; reason: string | null; title: string }> = {}): NotificationPayload => ({
  event: 'request.failed',
  request: {
    publicId: 'rq_9',
    title: over.title ?? 'Dune',
    author: over.author === undefined ? 'Frank Herbert' : over.author,
    asin: 'B9',
    coverUrl: null,
  },
  requester: { username: 'todd' },
  reason: over.reason === undefined ? 'No source found upstream.' : over.reason,
});

const created: NotificationPayload = {
  event: 'request.created',
  request: { publicId: 'rq_1', title: 'Dune', author: 'Frank Herbert', asin: 'B1', coverUrl: null },
  requester: { username: 'todd' },
};

const pending: NotificationPayload = {
  event: 'user.pending',
  user: { publicId: 'us_1', username: 'newbie', email: null, authProvider: 'local' },
};

describe('render — linkLabel tracks the event destination (#62)', () => {
  it('labels request.created "Open the request queue"', () => {
    expect(render(created, 'https://req.example.com').linkLabel).toBe('Open the request queue');
  });

  it('labels request.failed "Open the request queue"', () => {
    expect(render(failed(), 'https://req.example.com').linkLabel).toBe('Open the request queue');
  });

  it('labels user.pending "Review pending users"', () => {
    expect(render(pending, 'https://req.example.com').linkLabel).toBe('Review pending users');
  });
});

describe('render — request.failed (#60)', () => {
  it('titles "Request failed" and deep-links to /admin', () => {
    const msg = render(failed(), 'https://req.example.com');
    expect(msg.title).toBe('Request failed');
    expect(msg.url).toBe('https://req.example.com/admin');
  });

  it('includes the author and reason in the body', () => {
    const msg = render(failed(), 'https://req.example.com');
    expect(msg.body).toBe('“Dune” failed to acquire by Frank Herbert: No source found upstream.');
  });

  it('omits the reason clause when reason is null', () => {
    const msg = render(failed({ reason: null }), 'https://req.example.com');
    expect(msg.body).toBe('“Dune” failed to acquire by Frank Herbert');
  });

  it('omits the "by <author>" clause when author is null (reason still rendered)', () => {
    const msg = render(failed({ author: null }), 'https://req.example.com');
    expect(msg.body).toBe('“Dune” failed to acquire: No source found upstream.');
  });

  it('renders url: null when no public base URL is configured', () => {
    expect(render(failed(), null).url).toBeNull();
  });
});
