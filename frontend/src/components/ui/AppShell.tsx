import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { Role } from '../../api/types';
import { cx } from '../../lib/cx';
import { ROLE_LABELS } from '../../lib/roles';
import { Icon, type IconName } from './Icon';

export const APP_NAME = 'Plataforma de Proyectos de Investigación';

export interface AppShellNavItem {
  to: string;
  label: string;
  end?: boolean;
  icon?: IconName;
  /** Unread/pending counter shown next to the label. */
  badge?: number;
}

export interface AppShellProps {
  /** Signed-in user; omit on public screens (login) to show the bare top bar. */
  user?: { fullName: string; role: Role } | null;
  onLogout?: () => void;
  /** Per-role navigation links; the backend still authorizes every call. */
  nav?: AppShellNavItem[];
  children: ReactNode;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function BrandMark({ light = false }: { light?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent-500 to-brand-500 text-sm font-bold text-white shadow-sm"
      >
        UP
      </span>
      <span className={cx('text-sm font-semibold leading-tight', light ? 'text-white' : 'text-brand-700')}>
        {APP_NAME}
      </span>
    </span>
  );
}

export function AppShell({ user, onLogout, nav, children }: AppShellProps) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);

  const skip = (
    <a
      href="#contenido"
      className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow"
    >
      Saltar al contenido
    </a>
  );

  // Public screens (no session): a slim branded bar, no sidebar.
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
        {skip}
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center px-4 py-3 sm:px-6">
            <BrandMark />
          </div>
        </header>
        <main id="contenido" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 lg:flex">
      {skip}

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-brand-700 px-4 py-2.5 text-white lg:hidden">
        <BrandMark light />
        <button
          type="button"
          aria-expanded={open}
          aria-controls="menu-lateral"
          onClick={() => setOpen((o) => !o)}
          className="rounded-md p-2 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <Icon name={open ? 'close' : 'menu'} />
          <span className="sr-only">{open ? 'Cerrar menú' : 'Abrir menú'}</span>
        </button>
      </header>

      <aside
        id="menu-lateral"
        className={cx(
          'flex-col bg-gradient-to-b from-brand-700 to-brand-900 text-white',
          'lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0',
          open ? 'flex' : 'hidden',
        )}
      >
        <div className="hidden px-5 pb-4 pt-6 lg:block">
          <BrandMark light />
        </div>
        <div className="mx-5 hidden h-1 rounded-full bg-gradient-to-r from-accent-500 via-lime-brand to-brand-200 lg:block" />

        {nav && nav.length > 0 && (
          <nav aria-label="Principal" className="flex-1 px-3 py-4">
            <ul className="space-y-1">
              {nav.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cx(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                        isActive
                          ? 'bg-white text-brand-700 shadow-sm'
                          : 'text-brand-100 hover:bg-white/10 hover:text-white',
                      )
                    }
                  >
                    {item.icon && <Icon name={item.icon} />}
                    {item.label}
                    {!!item.badge && (
                      <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-accent-500 px-1.5 text-xs font-bold text-white">
                        {item.badge > 99 ? '99+' : item.badge}
                        <span className="sr-only"> sin leer</span>
                      </span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-500 text-sm font-semibold text-white"
            >
              {initials(user.fullName)}
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold">{user.fullName}</p>
              <p className="text-xs text-brand-100">{ROLE_LABELS[user.role]}</p>
            </div>
          </div>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Icon name="logout" className="size-4" />
              Cerrar sesión
            </button>
          )}
        </div>
      </aside>

      <main id="contenido" className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-10">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
