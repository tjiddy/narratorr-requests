import { useState } from 'react';
import type { V1AudibleResult } from '@shared/schemas/narratorr-v1';
import type { RequestStatus } from '@shared/schemas/request';
import { useRequestBook } from '../hooks';
import { StatusBadge } from './StatusBadge';
import { Badge } from './Badge';
import { Button } from './Button';
import { resolveBookCardState } from './book-card-state';

function Cover({ url, title }: { url: string | null; title: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <div className="flex aspect-square w-full items-center justify-center bg-gradient-to-br from-muted to-card p-3 text-center text-sm font-medium text-muted-foreground">
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
      className="aspect-square w-full object-cover"
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
  const state = resolveBookCardState(result.library, requestedStatus);

  return (
    <div className="glass-card flex flex-col overflow-hidden rounded-xl transition-all hover:-translate-y-0.5 hover:shadow-card-hover">
      <Cover url={result.cover} title={result.title} />
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 font-medium leading-snug" title={result.title}>
          {result.title}
        </h3>
        {author && <p className="truncate text-sm text-muted-foreground">{author}</p>}
        {narrator && <p className="truncate text-xs text-muted-foreground/70">Narrated by {narrator}</p>}
        {result.series && (
          <p className="truncate text-xs text-muted-foreground/70">
            {result.series.name}
            {result.series.position != null && ` #${result.series.position}`}
          </p>
        )}
        <div className="mt-auto pt-2">
          {state.kind === 'request-status' ? (
            <StatusBadge status={state.status} />
          ) : state.kind === 'library' ? (
            <Badge variant={state.variant}>
              {state.pulse && (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />
              )}
              {state.label}
            </Badge>
          ) : (
            <Button
              variant="primary"
              size="sm"
              loading={request.isPending}
              onClick={() => request.mutate(result)}
              className="w-full justify-center"
            >
              {request.isPending ? 'Requesting…' : 'Request'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
