import type { RequestStatus } from '@shared/schemas/request';
import { Badge } from './Badge';
import { REQUEST_STATUS_LABELS, REQUEST_STATUS_VARIANT } from './status';

export function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <Badge variant={REQUEST_STATUS_VARIANT[status]}>
      {status === 'acquiring' && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />
      )}
      {REQUEST_STATUS_LABELS[status]}
    </Badge>
  );
}
