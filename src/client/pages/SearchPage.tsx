import { useEffect, useMemo, useState } from 'react';
import type { RequestStatus } from '@shared/schemas/request';
import { useSearch, useMyRequests } from '../hooks';
import { BookCard } from '../components/BookCard';
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
        <h1 className="text-2xl font-semibold tracking-tight">Discover audiobooks</h1>
        <p className="mt-1 text-sm text-slate-400">Search the catalog and request what you want to listen to.</p>
      </div>

      <input
        autoFocus
        type="search"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Search by title, author, or series…"
        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
      />

      <div className="mt-6">
        {q.trim() === '' && <p className="text-sm text-slate-500">Start typing to search.</p>}
        {search.isFetching && <p className="text-sm text-slate-500">Searching…</p>}
        {search.error && (
          <p className="text-sm text-rose-400">
            {search.error instanceof ApiError ? search.error.message : 'Search failed'}
          </p>
        )}
        {search.data && search.data.data.length === 0 && !search.isFetching && (
          <p className="text-sm text-slate-500">No results for “{q}”.</p>
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
