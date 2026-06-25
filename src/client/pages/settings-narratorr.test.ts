import { describe, it, expect } from 'vitest';
import { initNarratorr, buildNarratorr, isNarratorrDirty, isPublicUrlDirty, type NarratorrState } from './settings-narratorr';
import type { ConnectorSettingsDto } from '@shared/schemas/connectors';

const dto = (over: Partial<NonNullable<ConnectorSettingsDto['narratorr']>>): ConnectorSettingsDto['narratorr'] => ({
  url: 'http://narratorr:3000',
  hasApiKey: false,
  ...over,
});

const state = (over: Partial<NarratorrState>): NarratorrState => ({
  url: 'http://narratorr:3000',
  key: '',
  hasKey: false,
  ...over,
});

describe('initNarratorr', () => {
  it('hydrates url from the DTO (key always blank, hasKey from hasApiKey)', () => {
    expect(initNarratorr(dto({ url: 'https://books.example.com/lib', hasApiKey: true }))).toEqual({
      url: 'https://books.example.com/lib',
      key: '',
      hasKey: true,
    });
  });

  it('defaults to an empty/unconfigured form when the connector is null', () => {
    expect(initNarratorr(null)).toEqual({ url: '', key: '', hasKey: false });
  });
});

describe('buildNarratorr', () => {
  it('returns null when url is blank (the clear signal)', () => {
    expect(buildNarratorr(state({ url: '' }))).toBeNull();
    expect(buildNarratorr(state({ url: '   ' }))).toBeNull();
  });

  it('emits { url }, omitting apiKey when the key input is blank (keep masked key)', () => {
    expect(buildNarratorr(state({ url: 'http://narratorr:3000', key: '' }))).toEqual({
      url: 'http://narratorr:3000',
    });
  });

  it('includes apiKey (trimmed) when the admin typed a new one', () => {
    expect(buildNarratorr(state({ url: 'http://narratorr:3000', key: '  k  ' }))).toMatchObject({ apiKey: 'k' });
  });

  it('trims the url before emitting it', () => {
    expect(buildNarratorr(state({ url: '  https://books.example.com/lib  ' }))).toMatchObject({
      url: 'https://books.example.com/lib',
    });
  });
});

describe('isNarratorrDirty — drives the Narratorr card Save button', () => {
  const initial = state({ url: 'http://narratorr:3000', key: '' });

  it('is clean when the url matches and no key was typed', () => {
    expect(isNarratorrDirty(state({ url: 'http://narratorr:3000', key: '' }), initial)).toBe(false);
  });

  it('ignores surrounding whitespace on the url (trim before compare)', () => {
    expect(isNarratorrDirty(state({ url: '  http://narratorr:3000  ' }), initial)).toBe(false);
  });

  it('is dirty when the url changed', () => {
    expect(isNarratorrDirty(state({ url: 'http://narratorr:9999' }), initial)).toBe(true);
  });

  it('is dirty when a new api key was typed even if the url is unchanged', () => {
    expect(isNarratorrDirty(state({ url: 'http://narratorr:3000', key: 'newkey' }), initial)).toBe(true);
  });
});

describe('isPublicUrlDirty — drives the General card Save button', () => {
  it('is clean when an empty input matches a null saved value', () => {
    expect(isPublicUrlDirty('', null)).toBe(false);
    expect(isPublicUrlDirty('   ', null)).toBe(false);
  });

  it('is clean when the input matches the saved value (trimmed)', () => {
    expect(isPublicUrlDirty('https://app.example.com', 'https://app.example.com')).toBe(false);
    expect(isPublicUrlDirty('  https://app.example.com  ', 'https://app.example.com')).toBe(false);
  });

  it('is dirty when the input differs from the saved value', () => {
    expect(isPublicUrlDirty('https://moved.example.com', 'https://app.example.com')).toBe(true);
  });

  it('is dirty when clearing a previously-set url (input blank, saved set)', () => {
    expect(isPublicUrlDirty('', 'https://app.example.com')).toBe(true);
  });

  it('is dirty when setting a url that had no saved value', () => {
    expect(isPublicUrlDirty('https://app.example.com', null)).toBe(true);
  });
});
