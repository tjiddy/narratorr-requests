import type { ConnectorSettingsDto, UpdateConnectorSettingsBody } from '@shared/schemas/connectors';

// Narratorr connection form state + init/build helpers. Pulled out of SettingsPage
// as pure logic so they can be unit-tested without a DOM (vitest node env), matching
// the other client logic helpers (e.g. book-card-state.ts).
//
// There is no `on` flag: narratorr is the app's lifeline and is never "disabled",
// only configured or not. The Server URL field is the single configured signal — blank URL
// means "unconfigured" (build emits null, clearing the connector and its stored key).

export type NarratorrState = {
  url: string;
  key: string;
  hasKey: boolean;
};

export const initNarratorr = (c: ConnectorSettingsDto['narratorr']): NarratorrState => ({
  url: c?.url ?? '',
  key: '',
  hasKey: c?.hasApiKey ?? false,
});

export const buildNarratorr = (s: NarratorrState): UpdateConnectorSettingsBody['narratorr'] =>
  s.url.trim() === ''
    ? null
    : {
        url: s.url.trim(),
        // Omit the key when blank to keep the stored one (masked); send it when typed.
        ...(s.key.trim() ? { apiKey: s.key.trim() } : {}),
      };

// ---- Per-card "dirty" checks (drive the save-when-dirty button) -------------
// Pure so the section components stay presentational; the Save button renders only
// when these return true, mirroring narratorr's `{isDirty && <Save/>}` pattern.

/**
 * The narratorr card is dirty when the URL differs from the saved value (trimmed), or a
 * new API key has been typed (the key field always seeds blank, so any non-blank entry is
 * a change). `initial` is the freshly-seeded baseline from `initNarratorr`.
 */
export const isNarratorrDirty = (s: NarratorrState, initial: NarratorrState): boolean =>
  s.url.trim() !== initial.url.trim() || s.key.trim() !== '';

/**
 * The General card (Public URL) is dirty when the normalized candidate (blank → null,
 * matching what `save` sends) differs from the saved value.
 */
export const isPublicUrlDirty = (current: string, saved: string | null): boolean =>
  (current.trim() || null) !== saved;
