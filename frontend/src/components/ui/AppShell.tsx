import type { ReactNode } from 'react';
import type { Role } from '../../api/types';
import { ROLE_LABELS } from '../../lib/roles';
import { Button } from './Button';

export const APP_NAME = 'Research Projects Platform';

export interface AppShellProps {
  /** Signed-in user; omit on public screens (login) to show the bare top bar. */
  user?: { fullName: string; role: Role } | null;
  onLogout?: () => void;
  children: ReactNode;
}

export function AppShell({ user, onLogout, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6"
        >
          <span className="text-base font-semibold text-brand-700">{APP_NAME}</span>
          {user && (
            <div className="flex items-center gap-3">
              <div className="text-right leading-tight">
                <p className="text-sm font-medium">{user.fullName}</p>
                <p className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
              </div>
              {onLogout && (
                <Button variant="secondary" size="sm" onClick={onLogout}>
                  Log out
                </Button>
              )}
            </div>
          )}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
