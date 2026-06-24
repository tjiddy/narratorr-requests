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

/**
 * The remount/reseed key for the connection form. It projects ONLY the connection's own
 * persisted slice (publicUrl + narratorr) — deliberately NOT the notifier list. Keying the
 * form on this means a notifier mutation's connectors refetch (which changes the notifier
 * list but not this slice) no longer remounts the form, so in-progress url/key/Public-URL
 * edits survive; a genuine connection save (which does change this slice) still reseeds it.
 */
export const connectionFormKey = (dto: ConnectorSettingsDto): string =>
  JSON.stringify({ publicUrl: dto.publicUrl, narratorr: dto.narratorr });

export const buildNarratorr = (s: NarratorrState): UpdateConnectorSettingsBody['narratorr'] =>
  s.url.trim() === ''
    ? null
    : {
        url: s.url.trim(),
        // Omit the key when blank to keep the stored one (masked); send it when typed.
        ...(s.key.trim() ? { apiKey: s.key.trim() } : {}),
      };
