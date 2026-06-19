import { describe, it, expect } from 'vitest';
import { makeOidcMapper } from './oidc.service.js';

const map = makeOidcMapper('Test');

describe('makeOidcMapper', () => {
  it('maps sub + preferred_username + email + picture', () => {
    expect(map({ sub: 'abc', preferred_username: 'todd', email: 't@x.com', picture: 'p.jpg' }, null)).toEqual({
      subject: 'abc',
      username: 'todd',
      email: 't@x.com',
      thumb: 'p.jpg',
    });
  });

  it('falls back through username/name/userinfo, then to the subject for the username', () => {
    expect(map({ sub: 'abc' }, { preferred_username: 'todd' })).toMatchObject({ username: 'todd' });
    expect(map({ sub: 'abc', name: 'Todd J' }, null)).toMatchObject({ username: 'Todd J' });
    expect(map({ sub: 'abc' }, null)).toEqual({ subject: 'abc', username: 'abc', email: null, thumb: null });
  });

  it('throws OIDC_CLAIMS when there is no usable subject', () => {
    expect(() => map({}, null)).toThrow(/usable subject/);
  });

  it('ignores non-string claims (array/object/number) rather than coercing them', () => {
    // A provider that returns sub as a number/array must not yield a bogus subject.
    expect(() => map({ sub: 12345 }, null)).toThrow(/usable subject/);
    expect(() => map({ sub: ['a', 'b'] }, null)).toThrow(/usable subject/);
  });

  it('rejects an oversized subject/username (bounds provider-controlled identity keys)', () => {
    const huge = 'x'.repeat(300);
    expect(() => map({ sub: huge }, null)).toThrow(/exceeds/);
    expect(() => map({ sub: 'ok', preferred_username: huge }, null)).toThrow(/exceeds/);
  });

  it('honors per-provider claim overrides', () => {
    const custom = makeOidcMapper('Custom', {
      subjectClaim: 'oid',
      usernameClaim: 'login',
      emailClaim: 'mail',
    });
    expect(custom({ oid: 'X1', login: 'gamer', mail: 'g@x.com', sub: 'ignored' }, null)).toEqual({
      subject: 'X1',
      username: 'gamer',
      email: 'g@x.com',
      thumb: null,
    });
  });

  it('reads an override claim from userinfo when absent from id-token claims', () => {
    const custom = makeOidcMapper('Custom', { usernameClaim: 'login' });
    expect(custom({ sub: 'X1' }, { login: 'fromUserinfo' })).toMatchObject({ username: 'fromUserinfo' });
  });
});
