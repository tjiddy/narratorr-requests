import type { RequestStatus } from '@shared/schemas/request';

const STYLES: Record<RequestStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
  approved: { label: 'Approved', className: 'bg-sky-500/15 text-sky-300 ring-sky-500/30' },
  acquiring: { label: 'Acquiring', className: 'bg-violet-500/15 text-violet-300 ring-violet-500/30' },
  available: { label: 'Available', className: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' },
  denied: { label: 'Denied', className: 'bg-slate-500/15 text-slate-300 ring-slate-500/30' },
  failed: { label: 'Failed', className: 'bg-rose-500/15 text-rose-300 ring-rose-500/30' },
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const s = STYLES[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.className}`}>
      {status === 'acquiring' && (
        <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />
      )}
      {s.label}
    </span>
  );
}
