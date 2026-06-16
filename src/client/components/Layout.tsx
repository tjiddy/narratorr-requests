import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MeDto } from '@shared/schemas/user';
import { logout } from '../api';
import { useTheme } from '../hooks';
import { Button } from './Button';
import { SunIcon, MoonIcon } from './icons';

const linkBase = 'rounded-md px-3 py-1.5 text-sm font-medium transition-colors';
const linkClass = ({ isActive }: { isActive: boolean }) =>
  `${linkBase} ${isActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`;

export function Layout({ me }: { me: MeDto }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { theme, toggleTheme } = useTheme();

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
    <div className="min-h-screen gradient-bg noise-overlay">
      <header className="sticky top-0 z-10 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <span className="mr-2 font-display text-lg font-semibold tracking-tight">
            <span className="text-primary">narrator</span>request
          </span>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={linkClass}>
              Discover
            </NavLink>
            <NavLink to="/requests" className={linkClass}>
              My Requests
            </NavLink>
            {me.role === 'admin' && (
              <>
                <NavLink to="/admin" className={linkClass}>
                  Queue
                </NavLink>
                <NavLink to="/users" className={linkClass}>
                  Users
                </NavLink>
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {me.plexUsername}
              {me.role === 'admin' && <span className="ml-1 text-primary">★</span>}
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon={theme === 'dark' ? SunIcon : MoonIcon}
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            />
            <Button variant="ghost" size="sm" onClick={onLogout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
