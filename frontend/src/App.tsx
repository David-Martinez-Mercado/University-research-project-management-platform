import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { RoleRoute } from './auth/RoleRoute';
import { AdminAiPage } from './pages/admin/AdminAiPage';
import { AdminInvestorsPage } from './pages/admin/AdminInvestorsPage';
import { InvestorDashboardPage } from './pages/InvestorDashboardPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { useAuth } from './auth/AuthContext';
import { AdminAssignmentsPage } from './pages/admin/AdminAssignmentsPage';
import { AdminCriteriaPage } from './pages/admin/AdminCriteriaPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { CreateProjectPage } from './pages/CreateProjectPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { ProjectWorkspacePage } from './pages/ProjectWorkspacePage';

// Literal env check so the mocks folder is excluded from production bundles unless enabled.
const MockBanner =
  import.meta.env.VITE_USE_MOCKS === 'true'
    ? lazy(() => import('./mocks/MockBanner').then((m) => ({ default: m.MockBanner })))
    : null;

/** Investors get their own read-only dashboard; every other role the project list. */
function HomePage() {
  const { user } = useAuth();
  return user?.role === 'INVESTOR' ? <InvestorDashboardPage /> : <DashboardPage />;
}

export function App() {
  return (
    <>
      {MockBanner && (
        <Suspense fallback={null}>
          <MockBanner />
        </Suspense>
      )}
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/projects/new" element={<CreateProjectPage />} />
          <Route path="/projects/:id" element={<ProjectWorkspacePage />} />
          <Route element={<RoleRoute allow={['ADMINISTRATOR']} />}>
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/criteria" element={<AdminCriteriaPage />} />
            <Route path="/admin/assignments" element={<AdminAssignmentsPage />} />
            <Route path="/admin/investors" element={<AdminInvestorsPage />} />
            <Route path="/admin/ai" element={<AdminAiPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
