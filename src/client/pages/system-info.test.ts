import { describe, it, expect } from 'vitest';
import { formatDatabaseSize, formatNarratorrLine } from './system-info.js';

describe('formatDatabaseSize', () => {
  it('renders null as "unavailable"', () => {
    expect(formatDatabaseSize(null)).toBe('unavailable');
  });

  it('renders 0 bytes as "0 B"', () => {
    expect(formatDatabaseSize(0)).toBe('0 B');
  });

  it('renders sub-KB byte counts whole', () => {
    expect(formatDatabaseSize(512)).toBe('512 B');
  });

  it('renders 1536 as "1.5 KB"', () => {
    expect(formatDatabaseSize(1536)).toBe('1.5 KB');
  });

  it('steps up through MB and GB', () => {
    expect(formatDatabaseSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatDatabaseSize(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });
});

describe('formatNarratorrLine', () => {
  it('maps connected + version → "<version> · connected"', () => {
    expect(formatNarratorrLine({ state: 'connected', version: 'v1.0.0' })).toBe('v1.0.0 · connected');
  });

  it('falls back to bare "connected" when version is absent', () => {
    expect(formatNarratorrLine({ state: 'connected' })).toBe('connected');
  });

  it('maps not_configured → "not configured"', () => {
    expect(formatNarratorrLine({ state: 'not_configured' })).toBe('not configured');
  });

  it('maps unreachable and unavailable → "unreachable"', () => {
    expect(formatNarratorrLine({ state: 'unreachable' })).toBe('unreachable');
    expect(formatNarratorrLine({ state: 'unavailable' })).toBe('unreachable');
  });
});
