import { useMe, useUsers, useSetUserRole } from '../hooks';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { InboxIcon } from '../components/icons';

export function UsersPage() {
  const me = useMe();
  const users = useUsers();
  const setRole = useSetUserRole();

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Promote or demote admins. Admins approve requests and manage users — you can&rsquo;t change your own role.
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
            const pending = setRole.isPending && setRole.variables?.publicId === u.publicId;
            return (
              <li key={u.publicId} className="glass-card flex items-center gap-4 rounded-xl p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {u.plexUsername}
                    {isSelf && <span className="ml-1 text-xs text-muted-foreground/70">(you)</span>}
                  </p>
                  {u.email && <p className="truncate text-sm text-muted-foreground">{u.email}</p>}
                </div>
                <Badge variant={isAdmin ? 'info' : 'muted'}>{isAdmin ? 'Admin' : 'User'}</Badge>
                <Button
                  variant={isAdmin ? 'secondary' : 'success'}
                  size="sm"
                  disabled={isSelf}
                  loading={pending}
                  title={isSelf ? "You can't change your own role" : undefined}
                  onClick={() => setRole.mutate({ publicId: u.publicId, role: isAdmin ? 'user' : 'admin' })}
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
