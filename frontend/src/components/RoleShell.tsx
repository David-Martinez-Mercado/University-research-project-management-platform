import { useEffect, useState, type ReactNode } from 'react';
import { listNotifications } from '../api/notifications';
import { useAuth } from '../auth/AuthContext';
import { ROLE_VIEWS } from '../lib/roleViews';
import { AppShell } from './ui';

const POLL_MS = 60_000;
/** Fired by the notifications page after reading, so the sidebar counter updates immediately. */
export const NOTIFICATIONS_CHANGED = 'notifications:changed';

function useUnreadCount(enabled: boolean): number {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const refresh = () =>
      listNotifications({ limit: 1 }).then(
        (page) => {
          if (!cancelled) setUnread(page.unread);
        },
        () => undefined, // a failed poll must never break the page; the counter just stays as it was
      );
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED, refresh);
    };
  }, [enabled]);
  return unread;
}

/** AppShell wired to the session: signed-in user, logout, the navigation of the user's role and the unread counter. */
export function RoleShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const unread = useUnreadCount(!!user);
  if (!user) return null;
  const nav = ROLE_VIEWS[user.role].nav.map((item) => (item.to === '/notifications' ? { ...item, badge: unread } : item));
  return (
    <AppShell user={user} onLogout={signOut} nav={nav}>
      {children}
    </AppShell>
  );
}
