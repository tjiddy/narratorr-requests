import type { ConnectorSettingsDto, UpdateConnectorSettingsBody } from '@shared/schemas/connectors';

// Narratorr connection form state + init/build helpers. Pulled out of SettingsPage
// as pure logic so they can be unit-tested without a DOM (vitest node env), matching
// the other client logic helpers (e.g. book-card-state.ts).
//
// There is no `on` flag: narratorr is the app's lifeline and is never "disabled",
// only configured or not. The Host field is the single configured signal — blank Host
// means "unconfigured" (build emits null, clearing the connector and its stored key).

export type NarratorrState = {
  host: string;
  port: string;
  useSsl: boolean;
  urlBase: string;
  key: string;
  hasKey: boolean;
};

/** narratorr's default port — the common `http://narratorr:3000` sidecar deployment. */
const DEFAULT_PORT = 3000;

export const initNarratorr = (c: ConnectorSettingsDto['narratorr']): NarratorrState => ({
  host: c?.host ?? '',
  port: String(c?.port ?? DEFAULT_PORT),
  useSsl: c?.useSsl ?? false,
  urlBase: c?.urlBase ?? '',
  key: '',
  hasKey: c?.hasApiKey ?? false,
});

export const buildNarratorr = (s: NarratorrState): UpdateConnectorSettingsBody['narratorr'] =>
  s.host.trim() === ''
    ? null
    : {
        host: s.host.trim(),
        port: Number(s.port) || DEFAULT_PORT,
        useSsl: s.useSsl,
        // Optional reverse-proxy subpath; server normalizes leading/trailing slashes.
        ...(s.urlBase.trim() ? { urlBase: s.urlBase.trim() } : {}),
        // Omit the key when blank to keep the stored one (masked); send it when typed.
        ...(s.key.trim() ? { apiKey: s.key.trim() } : {}),
      };
