import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { Role } from '../../api/types';
import { cx } from '../../lib/cx';
import { ROLE_LABELS } from '../../lib/roles';
import { Button } from './Button';

export const APP_NAME = 'Plataforma de Proyectos de Investigación';

export interface AppShellNavItem {
  to: string;
  label: string;
  end?: boolean;
}

export interface AppShellProps {
  /** Signed-in user; omit on public screens (login) to show the bare top bar. */
  user?: { fullName: string; role: Role } | null;
  onLogout?: () => void;
  /** Per-role navigation links; the backend still authorizes every call. */
  nav?: AppShellNavItem[];
  children: ReactNode;
}

export function AppShell({ user, onLogout, nav, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Saltar al contenido
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <span className="text-base font-semibold text-brand-700">{APP_NAME}</span>
          {user && (
            <div className="flex items-center gap-3">
              <div className="text-right leading-tight">
                <p className="text-sm font-medium">{user.fullName}</p>
                <p className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
              </div>
              {onLogout && (
                <Button variant="secondary" size="sm" onClick={onLogout}>
                  Cerrar sesión
                </Button>
              )}
            </div>
          )}
        </div>
        {nav && nav.length > 0 && (
          <nav aria-label="Principal" className="mx-auto max-w-5xl px-4 pb-2 sm:px-6">
            <ul className="flex flex-wrap gap-1">
              {nav.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cx(
                        'block rounded-md px-3 py-1.5 text-sm font-medium',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
                        isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100',
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>
      <main id="contenido" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
