import { Link } from 'react-router-dom';
import type { UserDto } from '@shared/schemas/user';
import { useMe, useUsers, useUpdateUser } from '../hooks';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { InboxIcon } from '../components/icons';

// Surface pending users first (the admin's action list), then active, then rejected.
const STATUS_ORDER: Record<UserDto['status'], number> = { pending: 0, active: 1, rejected: 2 };

export function UsersPage() {
  const me = useMe();
  const users = useUsers();
  const update = useUpdateUser();

  const rows = users.data ? [...users.data.data].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) : [];
  const pendingCount = rows.filter((u) => u.status === 'pending').length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Approve who can request, manage roles, and adjust quota or auto-approve. You can&rsquo;t change your own role.
        </p>
        {pendingCount > 0 && (
          <p className="mt-2 text-sm text-amber-400">
            {pendingCount} {pendingCount === 1 ? 'user is' : 'users are'} awaiting approval.
          </p>
        )}
      </div>

      {users.isLoading && <p className="text-sm text-muted-foreground/70">Loading…</p>}
      {users.data && rows.length === 0 && (
        <EmptyState icon={InboxIcon} title="No users yet" subtitle="Users appear here after they first sign in." />
      )}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-3">
          {rows.map((u) => {
            const isSelf = me.data?.publicId === u.publicId;
            const isAdmin = u.role === 'admin';
            const busy = update.isPending && update.variables?.publicId === u.publicId;
            const set = (patch: Parameters<typeof update.mutate>[0]['patch']) =>
              update.mutate({ publicId: u.publicId, patch });
            return (
              <li key={u.publicId} className="glass-card flex items-center gap-3 rounded-xl p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    <Link to={`/users/${u.publicId}`} className="underline-offset-4 hover:text-primary hover:underline">
                      {u.username}
                    </Link>
                    {isSelf && <span className="ml-1 text-xs text-muted-foreground/70">(you)</span>}
                    <span className="ml-2 text-xs font-normal text-muted-foreground/60">{u.authProvider}</span>
                  </p>
                  {u.email && <p className="truncate text-sm text-muted-foreground">{u.email}</p>}
                </div>

                {u.status === 'pending' && <Badge variant="warning">Pending</Badge>}
                {u.status === 'rejected' && <Badge variant="danger">Rejected</Badge>}
                {u.status === 'active' && u.autoApprove && !isAdmin && <Badge variant="success">Auto-approve</Badge>}
                {u.status === 'active' && <Badge variant={isAdmin ? 'info' : 'muted'}>{isAdmin ? 'Admin' : 'User'}</Badge>}

                <div className="flex shrink-0 gap-2">
                  {u.status === 'pending' && (
                    <>
                      <Button variant="success" size="sm" loading={busy} onClick={() => set({ status: 'active' })}>
                        Approve
                      </Button>
                      <Button variant="secondary" size="sm" disabled={busy} onClick={() => set({ status: 'rejected' })}>
                        Reject
                      </Button>
                    </>
                  )}
                  {u.status === 'rejected' && (
                    <Button variant="success" size="sm" loading={busy} onClick={() => set({ status: 'active' })}>
                      Approve
                    </Button>
                  )}
                  {u.status === 'active' && (
                    <Button
                      variant={isAdmin ? 'secondary' : 'success'}
                      size="sm"
                      disabled={isSelf}
                      loading={busy}
                      title={isSelf ? "You can't change your own role" : undefined}
                      onClick={() => set({ role: isAdmin ? 'user' : 'admin' })}
                    >
                      {isAdmin ? 'Demote' : 'Make admin'}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
