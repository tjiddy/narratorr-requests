import type { RequestDto } from '@shared/schemas/request';
import { useMyRequests } from '../hooks';
import { StatusBadge } from '../components/StatusBadge';

function RequestRow({ r }: { r: RequestDto }) {
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
        <p className="text-xs text-slate-500">Requested {new Date(r.requestedAt).toLocaleDateString()}</p>
      </div>
      <StatusBadge status={r.status} />
    </li>
  );
}

export function MyRequestsPage() {
  const { data, isLoading, error } = useMyRequests();

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">My requests</h1>
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <p className="text-sm text-rose-400">Could not load your requests.</p>}
      {data && data.data.length === 0 && (
        <p className="text-sm text-slate-500">You haven’t requested anything yet — head to Discover.</p>
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
