import { useEffect, useMemo, useState } from 'react';
import type { RequestStatus } from '@shared/schemas/request';
import { useSearch, useMyRequests } from '../hooks';
import { BookCard } from '../components/BookCard';
import { EmptyState } from '../components/EmptyState';
import { SearchIcon } from '../components/icons';
import { ApiError } from '../api';

export function SearchPage() {
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');

  // Debounce the query so we don't fire (throttled) searches on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(input), 350);
    return () => clearTimeout(t);
  }, [input]);

  const search = useSearch(q);
  const mine = useMyRequests();

  const statusByAsin = useMemo(() => {
    const map = new Map<string, RequestStatus>();
    for (const r of mine.data?.data ?? []) map.set(r.asin, r.status);
    return map;
  }, [mine.data]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Discover audiobooks
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search the catalog and request what you want to listen to.
        </p>
      </div>

      <input
        autoFocus
        type="search"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Search by title, author, or series…"
        className="w-full rounded-xl border border-border bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />

      <div className="mt-6">
        {q.trim() === '' && <p className="text-sm text-muted-foreground/70">Start typing to search.</p>}
        {search.isFetching && <p className="text-sm text-muted-foreground/70">Searching…</p>}
        {search.error && (
          <p className="text-sm text-destructive">
            {search.error instanceof ApiError ? search.error.message : 'Search failed'}
          </p>
        )}
        {search.data && search.data.data.length === 0 && !search.isFetching && (
          <EmptyState
            icon={SearchIcon}
            title="No results"
            subtitle={`Nothing matched “${q}”. Try a different title, author, or series.`}
          />
        )}
        {search.data && search.data.data.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {search.data.data.map((r) => (
              <BookCard key={r.asin} result={r} requestedStatus={statusByAsin.get(r.asin)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
