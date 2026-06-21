import { describe, it, expect } from 'vitest';
import { updateConnectorSettingsBodySchema } from './connectors';

// `httpUrl` and `ntfyPriority` are private constants; their behavior is exercised
// through the exported `updateConnectorSettingsBodySchema` (the PUT body), the same
// way the API contract is reached through its public surface.
const parse = (body: unknown) => updateConnectorSettingsBodySchema.parse(body);
const accepts = (body: unknown) => updateConnectorSettingsBodySchema.safeParse(body).success;

describe('httpUrl (via publicUrl)', () => {
  it('strips trailing slashes', () => {
    expect(parse({ publicUrl: 'https://x.com/' }).publicUrl).toBe('https://x.com');
    expect(parse({ publicUrl: 'https://x.com///' }).publicUrl).toBe('https://x.com');
  });

  it('trims surrounding whitespace before normalizing', () => {
    expect(parse({ publicUrl: '  https://x.com  ' }).publicUrl).toBe('https://x.com');
  });

  it('accepts http and https', () => {
    expect(parse({ publicUrl: 'http://x.com/' }).publicUrl).toBe('http://x.com');
  });

  it('rejects non-http(s) schemes and scheme-less values', () => {
    expect(accepts({ publicUrl: 'ftp://x.com' })).toBe(false);
    expect(accepts({ publicUrl: 'x.com' })).toBe(false);
  });
});

describe('ntfyPriority (via ntfy.priority)', () => {
  const ntfy = (priority: string) => ({ ntfy: { url: 'https://ntfy.sh', topic: 't', priority } });

  it('accepts the documented words and 1-5 digits', () => {
    for (const p of ['min', 'low', 'default', 'high', 'max', '1', '2', '3', '4', '5']) {
      expect(parse(ntfy(p)).ntfy?.priority).toBe(p);
    }
  });

  it('trims surrounding whitespace', () => {
    expect(parse(ntfy('  high  ')).ntfy?.priority).toBe('high');
  });

  it('rejects out-of-range digits, unknown words, wrong case, and empty', () => {
    for (const p of ['0', '6', '12', 'urgent', 'MIN', '']) {
      expect(accepts(ntfy(p))).toBe(false);
    }
  });
});

describe('email.port', () => {
  const email = (port: unknown) => ({ email: { host: 'h', from: 'f@x', to: 't@x', port } });

  it('coerces a numeric string to a number', () => {
    expect(parse(email('3306')).email?.port).toBe(3306);
  });

  it('accepts the inclusive bounds 1 and 65535', () => {
    expect(parse(email(1)).email?.port).toBe(1);
    expect(parse(email(65535)).email?.port).toBe(65535);
  });

  it('rejects out-of-range, non-integer, and non-numeric ports', () => {
    expect(accepts(email(0))).toBe(false);
    expect(accepts(email(65536))).toBe(false);
    expect(accepts(email(1.5))).toBe(false);
    expect(accepts(email('abc'))).toBe(false);
  });
});
