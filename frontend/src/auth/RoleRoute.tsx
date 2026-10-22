import { Navigate, Outlet } from 'react-router-dom';
import type { Role } from '../api/types';
import { useAuth } from './AuthContext';

/** UI convenience only (hides screens a role cannot use); the backend authorizes every call. */
export function RoleRoute({ allow }: { allow: readonly Role[] }) {
  const { user } = useAuth();
  if (!user || !allow.includes(user.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}
