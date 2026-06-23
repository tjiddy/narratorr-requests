import type { MeDto } from '@shared/schemas/user';
import type { BadgeVariant } from '../components/Badge';

// Pure display logic for the user's request quota. Pulled out of MyRequestsPage so
// the null-vs-zero decisions (unlimited cap, at-cap, zero limit) are unit-testable
// without a DOM (vitest node env), matching the build*/init* helper pattern in
// settings-narratorr.ts / settings-channels.ts.
//
// The server owns quota semantics (RequestService.resolveLimit / quotaUsage):
//   - limit === null      → unlimited (admins or no cap); remaining is null too
//   - remaining clamped at 0 server-side (Math.max(0, limit - used))
// We only FORMAT the existing me.quota contract — never recompute it.

export type QuotaDisplay =
  | { unlimited: true; label: string }
  | {
      unlimited: false;
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

// Badge tone for the capped meter. `atCap` first so a 0-limit / over-quota case
// can't slip into a "warning" or "success" band. Near-cap (within ~20%, or the
// final slot) warns; otherwise success.
const variantFor = (limit: number, remaining: number): BadgeVariant => {
  if (remaining <= 0) return 'danger';
  if (remaining <= Math.max(1, Math.ceil(limit * 0.2))) return 'warning';
  return 'success';
};

export function formatQuota(quota: MeDto['quota']): QuotaDisplay {
  // Explicit null check — `limit === null` is unlimited. Never `!limit`, which would
  // wrongly fold `limit === 0` (a real cap of zero) into the unlimited branch.
  if (quota.limit === null) {
    return { unlimited: true, label: 'Unlimited requests' };
  }

  const limit = quota.limit;
  // Trust the server's clamped `remaining`; derive defensively only if it's absent.
  const remaining = quota.remaining ?? Math.max(0, limit - quota.used);
  const atCap = remaining <= 0;
  const window = windowLabel(quota.windowDays);

  return {
    unlimited: false,
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
