import type { RequestDto } from '@shared/schemas/request';
import { useMe, useMyRequests } from '../hooks';
import { Badge } from '../components/Badge';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';
import { InboxIcon } from '../components/icons';
import { requestFailureReason } from '../components/request-failure';
import { formatQuota } from './quota-display';

function RequestRow({ r }: { r: RequestDto }) {
  const failureReason = requestFailureReason(r);
  return (
    <li className="glass-card flex items-center gap-4 rounded-xl p-3">
      {r.coverUrl ? (
        <img src={r.coverUrl} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
      ) : (
        <div className="h-16 w-16 shrink-0 rounded bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{r.title}</p>
        {r.author && <p className="truncate text-sm text-muted-foreground">{r.author}</p>}
        <p className="text-xs text-muted-foreground/70">
          Requested {new Date(r.requestedAt).toLocaleDateString()}
        </p>
        {r.note && (
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="text-muted-foreground/70">{r.status === 'denied' ? 'Reason: ' : 'Note: '}</span>
            {r.note}
          </p>
        )}
        {failureReason && (
          <p className="mt-1 text-xs text-destructive">
            <span className="text-destructive/70">Failed: </span>
            {failureReason}
          </p>
        )}
      </div>
      <StatusBadge status={r.status} />
    </li>
  );
}

function QuotaMeter() {
  const { data: me } = useMe();
  if (!me) return null;
  const q = formatQuota(me.quota);

  if (q.unlimited) {
    return (
      <Badge variant="info" className="text-xs">
        {q.label}
      </Badge>
    );
  }

  return (
    <Badge variant={q.variant} className="text-xs">
      {q.label}
    </Badge>
  );
}

export function MyRequestsPage() {
  const { data, isLoading, error } = useMyRequests();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">My requests</h1>
        <QuotaMeter />
      </div>
      {isLoading && <p className="text-sm text-muted-foreground/70">Loading…</p>}
      {error && <p className="text-sm text-destructive">Could not load your requests.</p>}
      {data && data.data.length === 0 && (
        <EmptyState
          icon={InboxIcon}
          title="No requests yet"
          subtitle="You haven’t requested anything yet — find your next listen and request it."
        />
      )}
      {data && data.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {data.data.map((r) => (
            <RequestRow key={r.publicId} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
