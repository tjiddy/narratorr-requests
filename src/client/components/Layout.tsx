import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MeDto } from '@shared/schemas/user';
import { logout } from '../api';

const linkBase = 'rounded-md px-3 py-1.5 text-sm font-medium transition-colors';
const linkClass = ({ isActive }: { isActive: boolean }) =>
  `${linkBase} ${isActive ? 'bg-violet-600/20 text-violet-200' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'}`;

export function Layout({ me }: { me: MeDto }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function onLogout() {
    try {
      await logout();
      qc.clear();
      navigate('/');
      window.location.reload();
    } catch {
      toast.error('Logout failed');
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <span className="mr-2 text-lg font-semibold tracking-tight">
            <span className="text-violet-400">narrator</span>request
          </span>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={linkClass}>
              Discover
            </NavLink>
            <NavLink to="/requests" className={linkClass}>
              My Requests
            </NavLink>
            {me.role === 'admin' && (
              <NavLink to="/admin" className={linkClass}>
                Queue
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-400">
              {me.plexUsername}
              {me.role === 'admin' && <span className="ml-1 text-violet-400">★</span>}
            </span>
            <button onClick={onLogout} className="text-slate-500 hover:text-slate-200">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
