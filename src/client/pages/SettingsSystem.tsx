import type { ReactNode } from 'react';
import { useSystemInfo } from '../hooks';
import { ActivityIcon } from '../components/icons';
import { SectionHeader, SettingsCard } from './settings-ui';
import { formatDatabaseSize, formatNarratorrLine } from './system-info';

// Read-only System Information section: a lift of narratorr's own card, minus the
// narratorr-specific fields (Library Path / Free Space). All format/decision logic lives
// in the pure helpers in system-info.ts (co-located tests); this file is render-only.

/** One label/value row in the read-only info list. */
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/40 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-sm font-mono text-foreground">{children}</span>
    </div>
  );
}

export function SystemSection() {
  const { data, isLoading, error } = useSystemInfo();

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={ActivityIcon}
        title="System Information"
        subtitle="Server, environment, and the connected narratorr at a glance."
      />
      <SettingsCard delay="60ms">
        <div className="px-5 py-2">
          {isLoading && <p className="py-3 text-sm text-muted-foreground/70">Loading…</p>}
          {error && <p className="py-3 text-sm text-destructive">Could not load system information.</p>}
          {data && (
            <dl>
              <InfoRow label="Version">{data.version}</InfoRow>
              <InfoRow label="Built">{data.builtAt ?? '—'}</InfoRow>
              <InfoRow label="Node.js">{data.node}</InfoRow>
              <InfoRow label="OS">{data.os}</InfoRow>
              <InfoRow label="Database Size">{formatDatabaseSize(data.databaseSizeBytes)}</InfoRow>
              <InfoRow label="narratorr">{formatNarratorrLine(data.narratorr)}</InfoRow>
            </dl>
          )}
        </div>
      </SettingsCard>
    </div>
  );
}
