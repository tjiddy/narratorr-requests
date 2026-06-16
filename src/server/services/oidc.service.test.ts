import { describe, it, expect } from 'vitest';
import {
  mapAutheliaClaims,
  autheliaAdminGate,
  mapPlexClaims,
  plexAllowlistGate,
} from './oidc.service.js';

describe('mapAutheliaClaims', () => {
  it('maps sub + preferred_username + email', () => {
    expect(mapAutheliaClaims({ sub: 'abc', preferred_username: 'todd', email: 't@x.com' }, null)).toEqual({
      subject: 'abc',
      username: 'todd',
      email: 't@x.com',
    });
  });
  it('falls back through userinfo, then to the subject for the username', () => {
    expect(mapAutheliaClaims({ sub: 'abc' }, { preferred_username: 'todd' })).toMatchObject({ username: 'todd' });
    expect(mapAutheliaClaims({ sub: 'abc' }, null)).toEqual({ subject: 'abc', username: 'abc', email: null });
  });
  it('throws when there is no usable subject', () => {
    expect(() => mapAutheliaClaims({}, null)).toThrow();
  });
});

describe('autheliaAdminGate', () => {
  it('allows any subject when no pin is configured', () => {
    expect(() => autheliaAdminGate(null)({ subject: 'x', username: 'x', email: null })).not.toThrow();
  });
  it('allows only the pinned subject', () => {
    const gate = autheliaAdminGate('todd-sub');
    expect(() => gate({ subject: 'todd-sub', username: 'todd', email: null })).not.toThrow();
    expect(() => gate({ subject: 'someone-else', username: 'x', email: null })).toThrow();
  });
});

describe('plexAllowlistGate (refactored out of the service)', () => {
  it('allows anyone when empty, enforces membership when set', () => {
    expect(() => plexAllowlistGate([])({ plexId: '1', plexUsername: 'a' })).not.toThrow();
    const gated = plexAllowlistGate(['todd']);
    expect(() => gated({ plexId: '1', plexUsername: 'todd' })).not.toThrow();
    expect(() => gated({ plexId: '1', plexUsername: 'stranger' })).toThrow();
  });
  it('matches on plexId too', () => {
    expect(() => plexAllowlistGate(['plex-123'])({ plexId: 'plex-123', plexUsername: 'x' })).not.toThrow();
  });
});

describe('mapPlexClaims (unchanged behavior)', () => {
  it('pulls subject + username from common keys', () => {
    expect(mapPlexClaims({ sub: '42', preferred_username: 'todd', email: 'e' }, null)).toMatchObject({
      plexId: '42',
      plexUsername: 'todd',
      email: 'e',
    });
  });
});
