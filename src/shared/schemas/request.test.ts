import { describe, it, expect } from 'vitest';
import { createRequestBodySchema, decisionBodySchema } from './request.js';

describe('createRequestBodySchema', () => {
  const valid = { asin: 'B08GB58KD5', title: 'Project Hail Mary' };

  describe('coverUrl — https-only SSRF guard', () => {
    it('accepts an https url', () => {
      expect(createRequestBodySchema.safeParse({ ...valid, coverUrl: 'https://x' }).success).toBe(true);
    });

    it('rejects non-https schemes (http, javascript, data)', () => {
      for (const coverUrl of ['http://x', 'javascript:alert(1)', 'data:text/html,<script>1</script>']) {
        expect(createRequestBodySchema.safeParse({ ...valid, coverUrl }).success).toBe(false);
      }
    });

    it('rejects after trim — surrounding whitespace cannot smuggle an http url past the regex', () => {
      // .trim() runs before the /^https:\/\// regex, so this trims to 'http://evil' and must fail.
      expect(createRequestBodySchema.safeParse({ ...valid, coverUrl: '  http://evil  ' }).success).toBe(false);
    });

    it('accepts null and absent (.nullish())', () => {
      expect(createRequestBodySchema.safeParse({ ...valid, coverUrl: null }).success).toBe(true);
      expect(createRequestBodySchema.safeParse(valid).success).toBe(true);
    });
  });

  describe('asin / title — trim + min(1)', () => {
    it('rejects empty and whitespace-only values', () => {
      expect(createRequestBodySchema.safeParse({ ...valid, asin: '' }).success).toBe(false);
      expect(createRequestBodySchema.safeParse({ ...valid, asin: '   ' }).success).toBe(false);
      expect(createRequestBodySchema.safeParse({ ...valid, title: '' }).success).toBe(false);
      expect(createRequestBodySchema.safeParse({ ...valid, title: '   ' }).success).toBe(false);
    });

    it('trims surrounding whitespace on a valid value', () => {
      const parsed = createRequestBodySchema.parse({ asin: '  B08GB58KD5  ', title: '  Project Hail Mary  ' });
      expect(parsed.asin).toBe('B08GB58KD5');
      expect(parsed.title).toBe('Project Hail Mary');
    });
  });

  describe('note — max(500)', () => {
    it('accepts a 500-char note and rejects 501', () => {
      expect(createRequestBodySchema.safeParse({ ...valid, note: 'x'.repeat(500) }).success).toBe(true);
      expect(createRequestBodySchema.safeParse({ ...valid, note: 'x'.repeat(501) }).success).toBe(false);
    });

    it('accepts null and absent (.nullish())', () => {
      expect(createRequestBodySchema.safeParse({ ...valid, note: null }).success).toBe(true);
      expect(createRequestBodySchema.safeParse(valid).success).toBe(true);
    });
  });

  describe('.strict()', () => {
    it('rejects an unknown key', () => {
      expect(createRequestBodySchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    });
  });
});

describe('decisionBodySchema', () => {
  describe('action enum', () => {
    it('accepts approve and deny', () => {
      expect(decisionBodySchema.safeParse({ action: 'approve' }).success).toBe(true);
      expect(decisionBodySchema.safeParse({ action: 'deny' }).success).toBe(true);
    });

    it('rejects anything else (case-sensitive, empty, missing)', () => {
      expect(decisionBodySchema.safeParse({ action: 'reject' }).success).toBe(false);
      expect(decisionBodySchema.safeParse({ action: 'APPROVE' }).success).toBe(false);
      expect(decisionBodySchema.safeParse({ action: '' }).success).toBe(false);
      expect(decisionBodySchema.safeParse({}).success).toBe(false);
    });
  });

  describe('note — max(500)', () => {
    it('accepts a 500-char note and rejects 501', () => {
      expect(decisionBodySchema.safeParse({ action: 'approve', note: 'x'.repeat(500) }).success).toBe(true);
      expect(decisionBodySchema.safeParse({ action: 'approve', note: 'x'.repeat(501) }).success).toBe(false);
    });
  });

  describe('.strict()', () => {
    it('rejects an unknown key', () => {
      expect(decisionBodySchema.safeParse({ action: 'approve', extra: 1 }).success).toBe(false);
    });
  });
});
