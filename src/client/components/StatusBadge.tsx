import type { RequestStatus } from '@shared/schemas/request';
import { Badge, type BadgeVariant } from './Badge';

// Domain badge built on the shared Badge primitive — maps request lifecycle
// states onto the design system's semantic badge variants.
const STATUS: Record<RequestStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Pending', variant: 'warning' },
  approved: { label: 'Approved', variant: 'info' },
  acquiring: { label: 'Acquiring', variant: 'info' },
  available: { label: 'Available', variant: 'success' },
  denied: { label: 'Denied', variant: 'muted' },
  failed: { label: 'Failed', variant: 'danger' },
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const s = STATUS[status];
  return (
    <Badge variant={s.variant}>
      {status === 'acquiring' && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />
      )}
      {s.label}
    </Badge>
  );
}
