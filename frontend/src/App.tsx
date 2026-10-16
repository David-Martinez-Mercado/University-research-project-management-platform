import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';

// Literal env check so the mocks folder is excluded from production bundles unless enabled.
const MockBanner =
  import.meta.env.VITE_USE_MOCKS === 'true'
    ? lazy(() => import('./mocks/MockBanner').then((m) => ({ default: m.MockBanner })))
    : null;

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
          <Route path="/" element={<DashboardPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
