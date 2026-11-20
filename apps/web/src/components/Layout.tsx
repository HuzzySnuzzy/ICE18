import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../lib/auth';
import { Button, Logo, cx } from './ui';

function NavItem({ to, children }: { to: string; children: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cx(
          'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-ink-700 text-ink-100' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100',
        )
      }
    >
      {children}
    </NavLink>
  );
}

export function Layout() {
  const { user, meta, logout } = useAuth();
  if (!user) return null;

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      {/* Phones: one slim sticky row (logo + menu). Larger screens: sidebar. */}
      <aside className="sticky top-0 z-30 flex shrink-0 items-center border-b border-ink-800 bg-ink-900/95 backdrop-blur md:h-screen md:w-60 md:flex-col md:items-stretch md:border-r md:border-b-0 md:bg-ink-900">
        <div className="flex items-center gap-2.5 py-2 pr-1 pl-4 md:px-5 md:py-5">
          <Logo className="size-7 md:size-8" />
          <div className="hidden md:block">
            <div className="text-sm font-bold tracking-wide text-ink-100">ICE18</div>
            <div className="text-[11px] text-ink-400">Server panel</div>
          </div>
        </div>
        <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto px-2 py-2 md:flex-none md:flex-col md:px-3 md:py-0">
          <NavItem to="/servers">Servers</NavItem>
          <NavItem to="/databases">Databases</NavItem>
          <NavItem to="/account">Account</NavItem>
          {user.isAdmin && <NavItem to="/admin">Admin</NavItem>}
        </nav>
        <div className="mt-auto hidden border-t border-ink-800 p-4 md:block">
          <div className="truncate text-sm font-medium text-ink-100">{user.username}</div>
          <div className="truncate text-xs text-ink-400">{user.email}</div>
          <Button variant="ghost" className="mt-3 w-full justify-start px-2" onClick={() => void logout()}>
            Log out
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8">
        <div className="mx-auto max-w-7xl">
          {user.isAdmin && meta && !meta.pterodactylConfigured && (
            <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              Pterodactyl isn't connected yet. Set <code className="font-mono">PTERODACTYL_URL</code>,{' '}
              <code className="font-mono">PTERODACTYL_APP_KEY</code> and{' '}
              <code className="font-mono">PTERODACTYL_CLIENT_KEY</code>, then restart the panel.
            </div>
          )}
          <Outlet />
        </div>
        <div className="mt-10 md:hidden">
          <Button variant="ghost" onClick={() => void logout()}>
            Log out ({user.username})
          </Button>
        </div>
      </main>
    </div>
  );
}
