import { useState } from 'react';
import type { RequestDto, RequestStatus } from '@shared/schemas/request';
import { REQUEST_STATUSES } from '@shared/schemas/request';
import { useAdminQueue, useDecide } from '../hooks';
import { StatusBadge } from '../components/StatusBadge';

function QueueRow({ r }: { r: RequestDto }) {
  const decide = useDecide();
  return (
    <li className="flex items-center gap-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      {r.coverUrl ? (
        <img src={r.coverUrl} alt="" className="h-16 w-11 shrink-0 rounded object-cover" />
      ) : (
        <div className="h-16 w-11 shrink-0 rounded bg-slate-800" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{r.title}</p>
        {r.author && <p className="truncate text-sm text-slate-400">{r.author}</p>}
        <p className="text-xs text-slate-500">
          by {r.requester.plexUsername} · {new Date(r.requestedAt).toLocaleDateString()}
        </p>
      </div>
      {r.status === 'pending' ? (
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => decide.mutate({ publicId: r.publicId, action: 'approve' })}
            disabled={decide.isPending}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => decide.mutate({ publicId: r.publicId, action: 'deny' })}
            disabled={decide.isPending}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            Deny
          </button>
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
        <h1 className="text-2xl font-semibold tracking-tight">Request queue</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as RequestStatus | 'all')}
          className="ml-auto rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-sm"
        >
          <option value="all">All</option>
          {REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {data && data.data.length === 0 && (
        <p className="text-sm text-slate-500">Nothing here{filter !== 'all' ? ` (${filter})` : ''}.</p>
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
