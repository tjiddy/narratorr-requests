import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { paginationQuerySchema, errorEnvelopeSchema, listEnvelope, prefixedId } from './common.js';
import { v1BookSchema } from './books.js';

const book = {
  id: 'bk_abc123',
  title: 'Project Hail Mary',
  authors: [{ name: 'Andy Weir' }],
  narrators: [{ name: 'Ray Porter' }],
  coverUrl: 'https://example.com/cover.jpg',
  asin: 'B08GB58KD5',
  status: 'imported',
  createdAt: '2026-06-13T12:00:00.000Z',
};

describe('v1 envelopes', () => {
  const bookList = listEnvelope(v1BookSchema);

  it('accepts a well-formed list envelope and rejects a bare array', () => {
    expect(bookList.safeParse({ data: [book], total: 1 }).success).toBe(true);
    expect(bookList.safeParse([book]).success).toBe(false);
  });

  it('rejects a negative total', () => {
    expect(bookList.safeParse({ data: [], total: -1 }).success).toBe(false);
  });

  it('coerces pagination from strings and enforces bounds', () => {
    expect(paginationQuerySchema.parse({ limit: '20', offset: '40' })).toEqual({ limit: 20, offset: 40 });
    expect(paginationQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: '501' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
  });

  it('error envelope requires nested code + message', () => {
    expect(errorEnvelopeSchema.safeParse({ error: { code: 'NOT_FOUND', message: 'x' } }).success).toBe(true);
    expect(errorEnvelopeSchema.safeParse({ error: 'boom' }).success).toBe(false);
    expect(errorEnvelopeSchema.safeParse({ error: { message: 'x' } }).success).toBe(false);
  });
});

describe('prefixedId', () => {
  const bk = prefixedId('bk');
  it('accepts the right prefix and rejects others / numeric rowids', () => {
    expect(bk.safeParse('bk_abc123').success).toBe(true);
    expect(bk.safeParse('dl_abc123').success).toBe(false);
    expect(bk.safeParse('42').success).toBe(false);
    expect(bk.safeParse('bk_').success).toBe(false);
  });

  it('accepts base64url tokens — Narratorr mints ids with - and _', () => {
    // randomBytes(16).toString('base64url') routinely yields '-'/'_'; the consumer
    // must parse these or ~half of real book ids 502 as CONTRACT_MISMATCH.
    expect(bk.safeParse('bk_AbC-123_xYz').success).toBe(true);
  });
});

describe('listEnvelope helper', () => {
  it('parameterizes over an arbitrary item schema', () => {
    const env = listEnvelope(z.object({ n: z.number() }));
    expect(env.safeParse({ data: [{ n: 1 }], total: 1 }).success).toBe(true);
    expect(env.safeParse({ data: [{ n: 'x' }], total: 1 }).success).toBe(false);
  });
});
