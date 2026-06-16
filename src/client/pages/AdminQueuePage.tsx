import { useState } from 'react';
import type { RequestDto, RequestStatus } from '@shared/schemas/request';
import { REQUEST_STATUSES } from '@shared/schemas/request';
import { useAdminQueue, useDecide } from '../hooks';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';
import { InboxIcon } from '../components/icons';
import { Button } from '../components/Button';

function QueueRow({ r }: { r: RequestDto }) {
  const decide = useDecide();
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
          by {r.requester.plexUsername} · {new Date(r.requestedAt).toLocaleDateString()}
        </p>
      </div>
      {r.status === 'pending' ? (
        <div className="flex shrink-0 gap-2">
          <Button
            variant="success"
            size="sm"
            loading={decide.isPending}
            onClick={() => decide.mutate({ publicId: r.publicId, action: 'approve' })}
          >
            Approve
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ publicId: r.publicId, action: 'deny' })}
          >
            Deny
          </Button>
        </div>
      ) : (
        <StatusBadge status={r.status} />
      )}
    </li>
  );
}

export function AdminQueuePage() {
  const [filter, setFilter] = useState<RequestStatus | 'all'>('pending');
  const { data, isLoading } = useAdminQueue(filter === 'all' ? undefined : filter);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Request queue</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as RequestStatus | 'all')}
          className="ml-auto rounded-xl border border-border bg-card px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">All</option>
          {REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground/70">Loading…</p>}
      {data && data.data.length === 0 && (
        <EmptyState
          icon={InboxIcon}
          title="Queue empty"
          subtitle={`Nothing here${filter !== 'all' ? ` (${filter})` : ''}.`}
        />
      )}
      {data && data.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {data.data.map((r) => (
            <QueueRow key={r.publicId} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
