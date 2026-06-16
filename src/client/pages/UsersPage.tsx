import { Link } from 'react-router-dom';
import { useMe, useUsers, useUpdateUser } from '../hooks';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { InboxIcon } from '../components/icons';

export function UsersPage() {
  const me = useMe();
  const users = useUsers();
  const update = useUpdateUser();

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Click a user to see their requests and adjust quota or auto-approve. You can&rsquo;t change your own role.
        </p>
      </div>

      {users.isLoading && <p className="text-sm text-muted-foreground/70">Loading…</p>}
      {users.data && users.data.data.length === 0 && (
        <EmptyState icon={InboxIcon} title="No users yet" subtitle="Users appear here after they first sign in." />
      )}
      {users.data && users.data.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {users.data.data.map((u) => {
            const isSelf = me.data?.publicId === u.publicId;
            const isAdmin = u.role === 'admin';
            const pending = update.isPending && update.variables?.publicId === u.publicId;
            return (
              <li key={u.publicId} className="glass-card flex items-center gap-4 rounded-xl p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    <Link
                      to={`/users/${u.publicId}`}
                      className="underline-offset-4 hover:text-primary hover:underline"
                    >
                      {u.plexUsername}
                    </Link>
                    {isSelf && <span className="ml-1 text-xs text-muted-foreground/70">(you)</span>}
                  </p>
                  {u.email && <p className="truncate text-sm text-muted-foreground">{u.email}</p>}
                </div>
                {u.autoApprove && !isAdmin && <Badge variant="success">Auto-approve</Badge>}
                <Badge variant={isAdmin ? 'info' : 'muted'}>{isAdmin ? 'Admin' : 'User'}</Badge>
                <Button
                  variant={isAdmin ? 'secondary' : 'success'}
                  size="sm"
                  disabled={isSelf}
                  loading={pending}
                  title={isSelf ? "You can't change your own role" : undefined}
                  onClick={() => update.mutate({ publicId: u.publicId, patch: { role: isAdmin ? 'user' : 'admin' } })}
                >
                  {isAdmin ? 'Demote' : 'Make admin'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
