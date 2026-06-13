import { useState } from 'react';
import type { V1AudibleResult } from '@shared/schemas/narratorr-v1';
import type { RequestStatus } from '@shared/schemas/request';
import { useRequestBook } from '../hooks';
import { StatusBadge } from './StatusBadge';

function Cover({ url, title }: { url: string | null; title: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <div className="flex aspect-2/3 w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 p-3 text-center text-sm font-medium text-slate-400">
        {title}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={`Cover of ${title}`}
      loading="lazy"
      onError={() => setBroken(true)}
      className="aspect-2/3 w-full object-cover"
    />
  );
}

export function BookCard({
  result,
  requestedStatus,
}: {
  result: V1AudibleResult;
  requestedStatus?: RequestStatus | undefined;
}) {
  const request = useRequestBook();
  const author = result.authors.map((a) => a.name).join(', ');
  const narrator = result.narrators.map((n) => n.name).join(', ');

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40 transition-colors hover:border-slate-700">
      <Cover url={result.coverUrl} title={result.title} />
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 font-medium leading-snug" title={result.title}>
          {result.title}
        </h3>
        {author && <p className="truncate text-sm text-slate-400">{author}</p>}
        {narrator && <p className="truncate text-xs text-slate-500">Narrated by {narrator}</p>}
        {result.seriesName && (
          <p className="truncate text-xs text-slate-500">
            {result.seriesName}
            {result.seriesPosition != null && ` #${result.seriesPosition}`}
          </p>
        )}
        <div className="mt-auto pt-2">
          {requestedStatus ? (
            <StatusBadge status={requestedStatus} />
          ) : (
            <button
              onClick={() => request.mutate(result)}
              disabled={request.isPending}
              className="w-full rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
            >
              {request.isPending ? 'Requesting…' : 'Request'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
