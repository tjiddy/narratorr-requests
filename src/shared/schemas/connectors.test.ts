import { describe, it, expect } from 'vitest';
import {
  CONNECTOR_KEYS,
  connectorSettingsDtoSchema,
  testConnectorBodySchema,
  testConnectorResultSchema,
  updateConnectorSettingsBodySchema,
} from './connectors';

// `httpUrl` and `ntfyPriority` are private constants; their behavior is exercised
// through the exported `updateConnectorSettingsBodySchema` (the PUT body), the same
// way the API contract is reached through its public surface.
const parse = (body: unknown) => updateConnectorSettingsBodySchema.parse(body);
const accepts = (body: unknown) => updateConnectorSettingsBodySchema.safeParse(body).success;
const issues = (body: unknown) => updateConnectorSettingsBodySchema.safeParse(body).error?.issues ?? [];

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

  it('coerces a numeric string to a number (string-coercion behavior)', () => {
    // Belt-and-suspenders alongside the `'3306'` case above: in-bounds numeric
    // strings coerce and pass, confirming z.coerce.number() runs on string input.
    expect(parse(email('1')).email?.port).toBe(1);
    expect(parse(email('65535')).email?.port).toBe(65535);
  });

  it('accepts a valid email block with port omitted (.optional())', () => {
    const parsed = parse({ email: { host: 'h', from: 'f@x', to: 't@x' } });
    expect(parsed.email?.port).toBeUndefined();
  });

  it('rejects port: null and port: "" — z.coerce.number() turns both into 0, which fails min(1)', () => {
    // Pinning current behavior: coercion runs before .optional() short-circuits, and
    // only `undefined` is treated as absent. null and '' both coerce to 0 → too_small.
    for (const port of [null, '']) {
      const i = issues(email(port));
      expect(i[0]?.code).toBe('too_small');
      expect(i[0]?.path).toEqual(['email', 'port']);
    }
  });
});

describe('email.pass — secret semantics (.trim().optional())', () => {
  // The three documented secret states (header comment connectors.ts:70):
  // omitted → keep existing, '' → clear, non-empty → replace. All three must parse.
  const email = (pass: unknown) => ({ email: { host: 'h', from: 'f@x', to: 't@x', ...(pass !== undefined && { pass }) } });

  it('accepts omitted, empty-string, and non-empty pass', () => {
    expect(parse(email(undefined)).email?.pass).toBeUndefined();
    expect(parse(email('')).email?.pass).toBe('');
    expect(parse(email('hunter2')).email?.pass).toBe('hunter2');
  });
});

describe('whitespace-only rejection — every .trim().min(1) field (ZOD-1)', () => {
  // A regression from `.trim().min(1)` to a bare `.min(1)` would accept '   ' and
  // pass every existing positive test; these inputs trim to '' and must reject.
  const WHITESPACE = ['   ', '\t', '\n'];
  const cases = [
    { field: 'ntfy.topic', path: ['ntfy', 'topic'], body: (v: string) => ({ ntfy: { url: 'https://ntfy.sh', topic: v } }) },
    { field: 'email.host', path: ['email', 'host'], body: (v: string) => ({ email: { host: v, from: 'f@x', to: 't@x' } }) },
    { field: 'email.from', path: ['email', 'from'], body: (v: string) => ({ email: { host: 'h', from: v, to: 't@x' } }) },
    { field: 'email.to', path: ['email', 'to'], body: (v: string) => ({ email: { host: 'h', from: 'f@x', to: v } }) },
  ];

  for (const { field, path, body } of cases) {
    it(`rejects whitespace-only ${field} and points the issue at the field`, () => {
      for (const v of WHITESPACE) {
        const result = updateConnectorSettingsBodySchema.safeParse(body(v));
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(path);
      }
    });
  }
});

describe('unknown-key handling — strict top-level, lenient nested', () => {
  it('rejects an unknown TOP-LEVEL key (.strict()) with an unrecognized-key issue', () => {
    const i = issues({ bogus: 1 });
    expect(i[0]?.code).toBe('unrecognized_keys');
    expect(i[0]?.path).toEqual([]);
  });

  it('ACCEPTS an unknown key nested under email — nested objects are lenient by design (not .strict())', () => {
    // Intentional: only the top-level body is .strict(). Nested connector objects
    // tolerate provider/UI drift. Adding .strict() here would be a behavior change
    // (out of scope for this test-hardening chore — see issue #29).
    expect(accepts({ email: { host: 'h', from: 'f@x', to: 't@x', futureField: 'x' } })).toBe(true);
  });
});

describe('testConnectorBodySchema — channel enum + .strict()', () => {
  for (const channel of CONNECTOR_KEYS) {
    it(`accepts the valid channel "${channel}"`, () => {
      expect(testConnectorBodySchema.parse({ channel }).channel).toBe(channel);
    });
  }

  it('rejects an out-of-enum channel (path points at channel)', () => {
    const result = testConnectorBodySchema.safeParse({ channel: 'invalid' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('invalid_value');
    expect(result.error?.issues[0]?.path).toEqual(['channel']);
  });

  it('rejects an unknown extra key (.strict())', () => {
    const result = testConnectorBodySchema.safeParse({ channel: 'narratorr', extra: 1 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });
});

describe('testConnectorResultSchema', () => {
  it('accepts { success: boolean, message: string }', () => {
    expect(testConnectorResultSchema.parse({ success: true, message: 'ok' })).toEqual({ success: true, message: 'ok' });
  });

  it('rejects a non-boolean success (path points at success)', () => {
    const result = testConnectorResultSchema.safeParse({ success: 'true', message: 'ok' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['success']);
  });

  it('rejects a non-string message (path points at message)', () => {
    const result = testConnectorResultSchema.safeParse({ success: true, message: 1 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['message']);
  });
});

describe('connectorSettingsDtoSchema — masked GET payload', () => {
  it('accepts a representative masked DTO (secrets surfaced as has* booleans)', () => {
    const dto = {
      publicUrl: 'https://requests.example.com',
      narratorr: { url: 'https://narratorr.example.com', hasApiKey: true },
      ntfy: { url: 'https://ntfy.sh', topic: 'books', hasToken: false, priority: 'high' },
      email: {
        host: 'smtp.example.com',
        port: 587,
        secure: true,
        user: 'mailer@example.com',
        from: 'noreply@example.com',
        to: 'admin@example.com',
        hasPassword: true,
      },
      webhook: { url: 'https://hooks.example.com/abc' },
    };
    expect(connectorSettingsDtoSchema.parse(dto)).toEqual(dto);
  });

  it('accepts plain url/host/topic/from/to strings with no trim/min constraints (e.g. empty or untrimmed)', () => {
    // The DTO is a read-only projection — its string fields are plain z.string()
    // with no .trim()/.min(1), unlike the write-path update body.
    const dto = {
      publicUrl: '',
      narratorr: { url: '  not-normalized  ', hasApiKey: false },
      ntfy: { url: '', topic: '', hasToken: false, priority: null },
      email: { host: '', port: 0, secure: false, user: null, from: '', to: '', hasPassword: false },
      webhook: { url: '' },
    };
    expect(connectorSettingsDtoSchema.safeParse(dto).success).toBe(true);
  });

  it('accepts all connectors null (every block is .nullable())', () => {
    expect(
      connectorSettingsDtoSchema.parse({ publicUrl: null, narratorr: null, ntfy: null, email: null, webhook: null }),
    ).toEqual({ publicUrl: null, narratorr: null, ntfy: null, email: null, webhook: null });
  });
});
