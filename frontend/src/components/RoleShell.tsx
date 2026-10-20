import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ROLE_VIEWS } from '../lib/roleViews';
import { AppShell } from './ui';

/** AppShell wired to the session: signed-in user, logout and the navigation of the user's role. */
export function RoleShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  if (!user) return null;
  return (
    <AppShell user={user} onLogout={signOut} nav={ROLE_VIEWS[user.role].nav}>
      {children}
    </AppShell>
  );
}
