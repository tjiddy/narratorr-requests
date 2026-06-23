import { describe, it, expect } from 'vitest';
import { initNarratorr, buildNarratorr, connectionFormKey, type NarratorrState } from './settings-narratorr';
import type { ConnectorSettingsDto, NotifierDto } from '@shared/schemas/connectors';

const dto = (over: Partial<NonNullable<ConnectorSettingsDto['narratorr']>>): ConnectorSettingsDto['narratorr'] => ({
  host: 'narratorr',
  port: 3000,
  useSsl: false,
  urlBase: null,
  hasApiKey: false,
  ...over,
});

const state = (over: Partial<NarratorrState>): NarratorrState => ({
  host: 'narratorr',
  port: '3000',
  useSsl: false,
  urlBase: '',
  key: '',
  hasKey: false,
  ...over,
});

describe('initNarratorr', () => {
  it('hydrates discrete fields from the DTO (key always blank, hasKey from hasApiKey)', () => {
    expect(initNarratorr(dto({ host: 'books.example.com', port: 443, useSsl: true, urlBase: '/lib', hasApiKey: true }))).toEqual({
      host: 'books.example.com',
      port: '443',
      useSsl: true,
      urlBase: '/lib',
      key: '',
      hasKey: true,
    });
  });

  it('defaults to an empty/unconfigured form when the connector is null', () => {
    expect(initNarratorr(null)).toEqual({ host: '', port: '3000', useSsl: false, urlBase: '', key: '', hasKey: false });
  });
});

describe('buildNarratorr', () => {
  it('returns null when host is blank (the clear signal)', () => {
    expect(buildNarratorr(state({ host: '' }))).toBeNull();
    expect(buildNarratorr(state({ host: '   ' }))).toBeNull();
  });

  it('emits the discrete object, omitting apiKey when the key input is blank (keep masked key)', () => {
    expect(buildNarratorr(state({ host: 'narratorr', port: '3000', useSsl: false, key: '' }))).toEqual({
      host: 'narratorr',
      port: 3000,
      useSsl: false,
    });
  });

  it('includes apiKey (trimmed) when the admin typed a new one', () => {
    expect(buildNarratorr(state({ host: 'narratorr', key: '  k  ' }))).toMatchObject({ apiKey: 'k' });
  });

  it('includes urlBase only when non-blank', () => {
    expect(buildNarratorr(state({ host: 'n', urlBase: '/lib' }))).toMatchObject({ urlBase: '/lib' });
    expect(buildNarratorr(state({ host: 'n', urlBase: '' }))).not.toHaveProperty('urlBase');
  });

  it('falls back to the default port when the port input is non-numeric', () => {
    expect(buildNarratorr(state({ host: 'n', port: '' }))).toMatchObject({ port: 3000 });
  });

  it('carries a non-default port and useSsl: true into the payload (not hardcoded defaults)', () => {
    // Guards against buildNarratorr ignoring the parsed port or always sending useSsl:false —
    // an admin saving 443 + SSL must persist exactly those, not the 3000/http defaults.
    expect(buildNarratorr(state({ host: 'books.example.com', port: '443', useSsl: true }))).toMatchObject({
      host: 'books.example.com',
      port: 443,
      useSsl: true,
    });
  });
});

describe('connectionFormKey — keyed on the connection slice, not the notifier list', () => {
  const notifier = (id: string): NotifierDto => ({
    id,
    name: id,
    type: 'ntfy',
    enabled: true,
    events: ['request.created'],
    config: { url: 'https://ntfy.sh', topic: 't', hasToken: false, priority: null },
  });
  const settings = (over: Partial<ConnectorSettingsDto> = {}): ConnectorSettingsDto => ({
    publicUrl: 'https://app.example.com',
    narratorr: dto({ host: 'narratorr', port: 3000 }),
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
    expect(connectionFormKey(settings({ narratorr: dto({ host: 'narratorr', port: 3000, hasApiKey: true }) }))).not.toBe(
      connectionFormKey(before),
    );
  });
});
