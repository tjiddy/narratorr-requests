import { describe, it, expect } from 'vitest';
import {
  v1BookSchema,
  v1BookListSchema,
  v1AcquisitionSchema,
  v1CreateAcquisitionBodySchema,
  v1AudibleResultSchema,
} from './narratorr-v1.js';
import {
  paginationQuerySchema,
  errorEnvelopeSchema,
  listEnvelope,
  prefixedId,
} from './v1/common.js';
import { z } from 'zod';

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
  it('accepts a well-formed list envelope and rejects a bare array', () => {
    expect(v1BookListSchema.safeParse({ data: [book], total: 1 }).success).toBe(true);
    expect(v1BookListSchema.safeParse([book]).success).toBe(false);
  });

  it('rejects a negative total', () => {
    expect(v1BookListSchema.safeParse({ data: [], total: -1 }).success).toBe(false);
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
});

describe('v1Book', () => {
  it('accepts a real book with nullable cover/asin', () => {
    expect(v1BookSchema.safeParse(book).success).toBe(true);
    expect(v1BookSchema.safeParse({ ...book, coverUrl: null, asin: null }).success).toBe(true);
  });
  it('rejects an unknown status and a numeric id', () => {
    expect(v1BookSchema.safeParse({ ...book, status: 'bogus' }).success).toBe(false);
    expect(v1BookSchema.safeParse({ ...book, id: 7 }).success).toBe(false);
  });
  it('rejects a non-ISO createdAt', () => {
    expect(v1BookSchema.safeParse({ ...book, createdAt: 'yesterday' }).success).toBe(false);
    expect(v1BookSchema.safeParse({ ...book, createdAt: '2026-06-13' }).success).toBe(true);
  });
});

describe('v1 acquisition', () => {
  it('accepts the synthetic queued status and a null bookId', () => {
    const acq = { id: 'aq_xyz', bookId: null, asin: 'B08GB58KD5', status: 'queued', updatedAt: '2026-06-13T12:00:00.000Z' };
    expect(v1AcquisitionSchema.safeParse(acq).success).toBe(true);
  });
  it('create body is strict (rejects extra keys)', () => {
    expect(v1CreateAcquisitionBodySchema.safeParse({ asin: 'B08GB58KD5' }).success).toBe(true);
    expect(v1CreateAcquisitionBodySchema.safeParse({ asin: 'x', extra: 1 }).success).toBe(false);
    expect(v1CreateAcquisitionBodySchema.safeParse({ asin: '' }).success).toBe(false);
  });
});

describe('v1 audible result', () => {
  it('accepts a minimal result and a fully-populated one', () => {
    expect(v1AudibleResultSchema.safeParse({ asin: 'B0', title: 't', authors: [], narrators: [], coverUrl: null }).success).toBe(true);
    const full = { asin: 'B0', title: 't', authors: [{ name: 'a', asin: 'X' }], narrators: [{ name: 'n' }], coverUrl: 'u', duration: 3600, publishedDate: '2020', seriesName: 's', seriesPosition: 1, language: 'english' };
    expect(v1AudibleResultSchema.safeParse(full).success).toBe(true);
  });
});

describe('listEnvelope helper', () => {
  it('parameterizes over an arbitrary item schema', () => {
    const env = listEnvelope(z.object({ n: z.number() }));
    expect(env.safeParse({ data: [{ n: 1 }], total: 1 }).success).toBe(true);
    expect(env.safeParse({ data: [{ n: 'x' }], total: 1 }).success).toBe(false);
  });
});
