import type { ReactNode } from 'react';

// Shared Settings form primitive — used by both the Narratorr connection section and the
// notifier add/edit modal (SettingsPage.tsx). Component-only (react-refresh): the className
// string + secret placeholder helper stay in SettingsPage.

/** A labelled form field — shows an error in place of the hint when one is present. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-destructive">{error}</span>
      ) : (
        hint && <span className="text-xs text-muted-foreground/70">{hint}</span>
      )}
    </label>
  );
}
