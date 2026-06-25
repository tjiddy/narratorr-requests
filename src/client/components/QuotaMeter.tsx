import { useMe } from '../hooks';
import { Badge } from './Badge';
import { formatQuota } from './quota-display';

/**
 * The current user's rolling-window request-quota badge. Rendered in BOTH the Search and
 * My Requests page headers so the cap is visible where people actually request — not only
 * discovered after a request is rejected. Renders nothing until `me` loads.
 */
export function QuotaMeter() {
  const { data: me } = useMe();
  if (!me) return null;
  const q = formatQuota(me.quota);
  return (
    <Badge variant={q.kind === 'unlimited' ? 'info' : q.variant} className="text-xs">
      {q.label}
    </Badge>
  );
}
