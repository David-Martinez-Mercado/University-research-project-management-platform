import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getMe, login } from '../api/auth';
import { setUnauthorizedHandler } from '../api/client';
import type { User } from '../api/types';
import { tokenStore } from './tokenStore';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: Status;
  user: User | null;
  /** True after the server rejected the stored token (e.g. 30 minutes of inactivity). */
  sessionExpired: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // A token left in sessionStorage (page reload) must be validated against /auth/me first.
  const [status, setStatus] = useState<Status>(() => (tokenStore.get() ? 'loading' : 'anonymous'));
  const [user, setUser] = useState<User | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    // The API client has already cleared the token when it calls this.
    setUnauthorizedHandler(() => {
      setUser(null);
      setStatus('anonymous');
      setSessionExpired(true);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (status !== 'loading') return;
    let cancelled = false;
    getMe().then(
      (me) => {
        if (cancelled) return;
        setUser(me);
        setStatus('authenticated');
      },
      () => {
        if (cancelled) return;
        // 401 is already handled by the unauthorized handler; this also covers network errors.
        tokenStore.clear();
        setStatus('anonymous');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [status]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await login(email, password);
    tokenStore.set(result.token);
    setUser(result.user);
    setSessionExpired(false);
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setSessionExpired(false);
    setStatus('anonymous');
  }, []);

  const value = useMemo(
    () => ({ status, user, sessionExpired, signIn, signOut }),
    [status, user, sessionExpired, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
