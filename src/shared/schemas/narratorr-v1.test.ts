import { describe, it, expect } from 'vitest';
import { v1BookSchema, v1AddBookBodySchema, v1AudibleResultSchema } from './narratorr-v1.js';
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

describe('v1Book (the bare resource we poll)', () => {
  it('accepts a real book with nullable/absent cover/asin/series', () => {
    expect(v1BookSchema.safeParse(book).success).toBe(true);
    expect(v1BookSchema.safeParse({ ...book, coverUrl: null, asin: null }).success).toBe(true);
    // series is an optional nested object; absent is fine, present must shape-match.
    expect(v1BookSchema.safeParse({ ...book, series: { name: 'Mistborn', position: 1 } }).success).toBe(true);
    expect(v1BookSchema.safeParse({ ...book, series: null }).success).toBe(true);
  });
  it('rejects an unknown status and a numeric id', () => {
    expect(v1BookSchema.safeParse({ ...book, status: 'bogus' }).success).toBe(false);
    expect(v1BookSchema.safeParse({ ...book, id: 7 }).success).toBe(false);
  });
  it('tolerates library people carrying an id (non-strict refs)', () => {
    const withIds = { ...book, authors: [{ id: 'au_1', name: 'Andy Weir' }] };
    expect(v1BookSchema.safeParse(withIds).success).toBe(true);
  });
  it('rejects a non-ISO createdAt but allows it to be absent', () => {
    expect(v1BookSchema.safeParse({ ...book, createdAt: 'yesterday' }).success).toBe(false);
    const { createdAt: _omit, ...noDate } = book;
    expect(v1BookSchema.safeParse(noDate).success).toBe(true);
  });
});

describe('v1AddBookBody (POST /books command)', () => {
  it('requires a non-empty asin and is strict (rejects extra keys)', () => {
    expect(v1AddBookBodySchema.safeParse({ asin: 'B08GB58KD5' }).success).toBe(true);
    expect(v1AddBookBodySchema.safeParse({ asin: '' }).success).toBe(false);
    expect(v1AddBookBodySchema.safeParse({ asin: 'x', extra: 1 }).success).toBe(false);
  });
});

describe('v1 audible result', () => {
  it('accepts a minimal result and a fully-populated one (cover + nested series)', () => {
    expect(v1AudibleResultSchema.safeParse({ asin: 'B0', title: 't', authors: [], narrators: [], cover: null }).success).toBe(true);
    const full = { asin: 'B0', title: 't', authors: [{ name: 'a', asin: 'X' }], narrators: [{ name: 'n' }], cover: 'u', series: { name: 's', position: 2.5 }, publishedDate: '2020', language: 'english' };
    expect(v1AudibleResultSchema.safeParse(full).success).toBe(true);
  });
  it('requires the live `cover` field (rejects the old coverUrl shape)', () => {
    expect(v1AudibleResultSchema.safeParse({ asin: 'B0', title: 't', authors: [], narrators: [], coverUrl: 'x' }).success).toBe(false);
  });

  describe('library cross-reference (#1537)', () => {
    const base = { asin: 'B0', title: 't', authors: [], narrators: [], cover: null };

    it('parses a result carrying a valid library annotation', () => {
      const r = v1AudibleResultSchema.parse({ ...base, library: { bookId: 'bk_x', status: 'imported' } });
      expect(r.library).toEqual({ bookId: 'bk_x', status: 'imported' });
    });

    it('accepts library absent or explicitly null (the "not owned" signals)', () => {
      expect(v1AudibleResultSchema.parse(base).library).toBeUndefined();
      expect(v1AudibleResultSchema.parse({ ...base, library: null }).library).toBeNull();
    });

    it('degrades a malformed/unknown-status annotation to undefined instead of failing the whole result', () => {
      // Best-effort decoration: provider drift on this field must never 502 a search.
      expect(v1AudibleResultSchema.parse({ ...base, library: { bookId: 'bk_x', status: 'bogus' } }).library).toBeUndefined();
      expect(v1AudibleResultSchema.parse({ ...base, library: { status: 'imported' } }).library).toBeUndefined();
      // ...but the rest of the result still parses cleanly.
      expect(v1AudibleResultSchema.parse({ ...base, library: 'garbage' }).title).toBe('t');
    });
  });
});

describe('listEnvelope helper', () => {
  it('parameterizes over an arbitrary item schema', () => {
    const env = listEnvelope(z.object({ n: z.number() }));
    expect(env.safeParse({ data: [{ n: 1 }], total: 1 }).success).toBe(true);
    expect(env.safeParse({ data: [{ n: 'x' }], total: 1 }).success).toBe(false);
  });
});
