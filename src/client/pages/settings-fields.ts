// Shared Settings field constants/helpers. Lives in its own non-component module so the
// presentational primitives (settings-ui.tsx) stay component-only for react-refresh, and
// so the connection sections + notifier modal share one source of truth (DRY).

/** Input styling shared by every Settings text/secret field. Darker `bg-background` fill
 *  (inset look matching narratorr), chunky padding, rounded-xl. */
export const inputCls =
  'w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50';

/** Placeholder for a secret field: "unchanged" when one is stored, else required/optional. */
export const secretPlaceholder = (has: boolean, required = false): string =>
  has ? '•••••••• (unchanged)' : required ? 'required' : 'optional';
