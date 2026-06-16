import type { RequestDto } from '@shared/schemas/request';
import { useMyRequests } from '../hooks';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';
import { InboxIcon } from '../components/icons';

function RequestRow({ r }: { r: RequestDto }) {
  return (
    <li className="glass-card flex items-center gap-4 rounded-xl p-3">
      {r.coverUrl ? (
        <img src={r.coverUrl} alt="" className="h-16 w-11 shrink-0 rounded object-cover" />
      ) : (
        <div className="h-16 w-11 shrink-0 rounded bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{r.title}</p>
        {r.author && <p className="truncate text-sm text-muted-foreground">{r.author}</p>}
        <p className="text-xs text-muted-foreground/70">
          Requested {new Date(r.requestedAt).toLocaleDateString()}
        </p>
      </div>
      <StatusBadge status={r.status} />
    </li>
  );
}

export function MyRequestsPage() {
  const { data, isLoading, error } = useMyRequests();

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-semibold tracking-tight sm:text-3xl">My requests</h1>
      {isLoading && <p className="text-sm text-muted-foreground/70">Loading…</p>}
      {error && <p className="text-sm text-destructive">Could not load your requests.</p>}
      {data && data.data.length === 0 && (
        <EmptyState
          icon={InboxIcon}
          title="No requests yet"
          subtitle="You haven’t requested anything yet — head to Discover to find your next listen."
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
