import type { SystemInfoDto } from '@shared/schemas/system';

// Pure display logic for the System Information card. Per the repo's frontend-testing
// convention, the format/decision logic lives here (co-located .test.ts) rather than inline
// JSX — the card component just renders the strings these return.

const SIZE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const;

/**
 * Humanize a raw byte count into a label: `0` → "0 B", `1536` → "1.5 KB", and `null`
 * (any stat failure / non-regular-file path) → "unavailable". Larger units carry one
 * decimal; bytes are shown whole.
 */
export function formatDatabaseSize(bytes: number | null): string {
  if (bytes === null) return 'unavailable';
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${SIZE_UNITS[unit]}`;
}

/**
 * Compose the narratorr line from its `{ state, version }`:
 * - connected     → "v1.0.0 · connected" (or bare "connected" if version is somehow absent)
 * - not_configured → "not configured"
 * - unreachable / unavailable → "unreachable"
 */
export function formatNarratorrLine(narratorr: SystemInfoDto['narratorr']): string {
  switch (narratorr.state) {
    case 'connected':
      return narratorr.version ? `${narratorr.version} · connected` : 'connected';
    case 'not_configured':
      return 'not configured';
    default:
      return 'unreachable';
  }
}
