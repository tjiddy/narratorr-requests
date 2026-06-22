import { describe, it, expect } from 'vitest';
import { createRequestBodySchema, decisionBodySchema } from './request.js';

describe('createRequestBodySchema', () => {
  const valid = { asin: 'B08GB58KD5', title: 'Project Hail Mary' };

  describe('coverUrl — https + non-internal-host SSRF guard', () => {
    it('accepts a normal public https url and round-trips the value', () => {
      const url = 'https://public.example.com/cover.jpg';
      const parsed = createRequestBodySchema.parse({ ...valid, coverUrl: url });
      expect(parsed.coverUrl).toBe(url);
    });

    it('accepts and trims a public https url with surrounding whitespace', () => {
      const parsed = createRequestBodySchema.parse({ ...valid, coverUrl: '  https://public.example.com/cover.jpg  ' });
      expect(parsed.coverUrl).toBe('https://public.example.com/cover.jpg');
    });

    it('rejects non-https schemes (http, javascript, data)', () => {
      for (const coverUrl of [
        'http://public.example.com',
        'javascript:alert(1)',
        'data:image/png;base64,AAAA',
      ]) {
        expect(createRequestBodySchema.safeParse({ ...valid, coverUrl }).success).toBe(false);
      }
    });

    it('rejects after trim — surrounding whitespace cannot smuggle an http url past the guard', () => {
      // .trim() runs before the refine, so this trims to 'http://evil' and must fail on scheme.
      expect(createRequestBodySchema.safeParse({ ...valid, coverUrl: '  http://evil  ' }).success).toBe(false);
    });

    it('rejects IPv4 loopback / private / link-local hosts', () => {
      for (const coverUrl of [
        'https://127.0.0.1',
        'https://0.0.0.0',
        'https://10.0.0.1',
        'https://172.16.0.1',
        'https://192.168.0.22',
        'https://169.254.169.254', // cloud-metadata
      ]) {
        expect(createRequestBodySchema.safeParse({ ...valid, coverUrl }).success).toBe(false);
      }
    });

    it('rejects an alternate IPv4 encoding the URL parser normalizes to 127.0.0.1', () => {
      // 2130706433 === 0x7f000001 === 127.0.0.1; new URL() canonicalizes .hostname.
      expect(createRequestBodySchema.safeParse({ ...valid, coverUrl: 'https://2130706433/' }).success).toBe(false);
    });

    it('rejects the localhost name family (localhost, trailing dot, *.localhost)', () => {
      for (const coverUrl of ['https://localhost', 'https://localhost./', 'https://anything.localhost/']) {
        expect(createRequestBodySchema.safeParse({ ...valid, coverUrl }).success).toBe(false);
      }
    });

    it('rejects IPv6 loopback / ULA / link-local (bracketed hostname normalization)', () => {
      for (const coverUrl of ['https://[::1]', 'https://[fd00::1]', 'https://[fe80::1]']) {
        expect(createRequestBodySchema.safeParse({ ...valid, coverUrl }).success).toBe(false);
      }
    });

    it('rejects IPv4-embedded IPv6 literals carrying an internal IPv4', () => {
      for (const coverUrl of [
        'https://[::ffff:127.0.0.1]/', // IPv4-mapped → [::ffff:7f00:1]
        'https://[::ffff:192.168.0.22]/',
        'https://[::ffff:169.254.169.254]/',
        'https://[::127.0.0.1]/', // deprecated IPv4-compatible → [::7f00:1]
      ]) {
        expect(createRequestBodySchema.safeParse({ ...valid, coverUrl }).success).toBe(false);
      }
    });

    it('accepts a public IPv6 literal', () => {
      expect(createRequestBodySchema.safeParse({ ...valid, coverUrl: 'https://[2606:4700:4700::1111]/' }).success).toBe(true);
    });

    it('rejects a non-empty but unparseable url instead of throwing', () => {
      expect(createRequestBodySchema.safeParse({ ...valid, coverUrl: 'https://' }).success).toBe(false);
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
