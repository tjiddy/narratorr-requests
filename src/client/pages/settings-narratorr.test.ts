import { describe, it, expect } from 'vitest';
import { initNarratorr, buildNarratorr, connectionFormKey, type NarratorrState } from './settings-narratorr';
import type { ConnectorSettingsDto, NotifierDto } from '@shared/schemas/connectors';

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

describe('connectionFormKey — keyed on the connection slice, not the notifier list', () => {
  const notifier = (id: string): NotifierDto => ({
    id,
    name: id,
    type: 'ntfy',
    events: ['request.created'],
    config: { url: 'https://ntfy.sh', topic: 't', hasToken: false, priority: null },
  });
  const settings = (over: Partial<ConnectorSettingsDto> = {}): ConnectorSettingsDto => ({
    publicUrl: 'https://app.example.com',
    narratorr: dto({ url: 'http://narratorr:3000' }),
    notifiers: [],
    ...over,
  });

  it('is unchanged when only the notifier list differs (no remount → unsaved edits survive)', () => {
    const before = settings({ notifiers: [notifier('nf_1')] });
    const after = settings({ notifiers: [notifier('nf_1'), notifier('nf_2')] });
    expect(connectionFormKey(after)).toBe(connectionFormKey(before));
  });

  it('changes when the connection slice genuinely changes (real save → reseed)', () => {
    const before = settings();
    expect(connectionFormKey(settings({ publicUrl: 'https://moved.example.com' }))).not.toBe(connectionFormKey(before));
    expect(connectionFormKey(settings({ narratorr: dto({ url: 'http://narratorr:3000', hasApiKey: true }) }))).not.toBe(
      connectionFormKey(before),
    );
  });
});
