import type { MeDto } from '@shared/schemas/user';
import type { BadgeVariant } from './Badge';

// Pure display logic for the user's request quota. Pulled out of MyRequestsPage so the mode-based
// decisions (unlimited cap, at-cap, admin block) are unit-testable without a DOM (vitest node env),
// matching the build*/init* helper pattern in settings-narratorr.ts / settings-notifiers.ts.
//
// The server owns quota semantics (RequestService.resolveQuota / quotaUsage) and reports a RESOLVED
// effective quota where `mode` is authoritative (NOT `limit === null`):
//   - mode 'unlimited' → no cap (admins or an unlimited override); limit & remaining are null
//   - mode 'limited'   → positive limit; remaining clamped at 0 server-side (Math.max(0, limit-used))
//   - mode 'blocked'   → a hard admin block; limit null, remaining 0 — rendered as "blocked"
// We only FORMAT the existing me.quota contract — never recompute it.

export type QuotaDisplay =
  | { kind: 'unlimited'; label: string }
  | { kind: 'blocked'; variant: BadgeVariant; label: string }
  | {
      kind: 'limited';
      used: number;
      limit: number;
      remaining: number;
      windowDays: number;
      windowLabel: string;
      atCap: boolean;
      variant: BadgeVariant;
      label: string;
    };

const windowLabel = (windowDays: number): string =>
  `last ${windowDays} day${windowDays === 1 ? '' : 's'}`;

// Badge tone for the capped meter. `atCap` first so an over-quota case can't slip into a
// "warning" or "success" band. Near-cap (within ~20%, or the final slot) warns; otherwise success.
const variantFor = (limit: number, remaining: number): BadgeVariant => {
  if (remaining <= 0) return 'danger';
  if (remaining <= Math.max(1, Math.ceil(limit * 0.2))) return 'warning';
  return 'success';
};

export function formatQuota(quota: MeDto['quota']): QuotaDisplay {
  // Branch on `mode` (authoritative), never `limit === null` — which would fold blocked (also
  // limit null) into the unlimited branch and render it as a free pass.
  if (quota.mode === 'unlimited') {
    return { kind: 'unlimited', label: 'Unlimited requests' };
  }
  if (quota.mode === 'blocked') {
    // Do NOT render blocked as a 0 / 0 meter — it's a policy denial, not "out of slots this window".
    return { kind: 'blocked', variant: 'danger', label: 'Requests blocked by admin' };
  }

  // mode 'limited' — the server guarantees a positive `limit`; derive remaining defensively only
  // if it's somehow absent.
  const limit = quota.limit ?? 0;
  const remaining = quota.remaining ?? Math.max(0, limit - quota.used);
  const atCap = remaining <= 0;
  const window = windowLabel(quota.windowDays);

  return {
    kind: 'limited',
    used: quota.used,
    limit,
    remaining,
    windowDays: quota.windowDays,
    windowLabel: window,
    atCap,
    variant: variantFor(limit, remaining),
    label: `${quota.used} / ${limit} requests used · ${remaining} remaining · ${window}`,
  };
}
