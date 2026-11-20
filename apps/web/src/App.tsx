import { Suspense, lazy, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import { AccountPage } from './pages/AccountPage';
import { AdminPage } from './pages/AdminPage';
import { DatabasesPage } from './pages/DatabasesPage';
import { StorePage } from './pages/StorePage';
import { LoginPage } from './pages/LoginPage';
import { ServersPage } from './pages/ServersPage';

// The console page pulls in xterm.js; load it only when a server is opened.
const ServerPage = lazy(() => import('./pages/ServerPage').then((module) => ({ default: module.ServerPage })));

function RequireLogin({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center text-ink-400">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (admin && !user.isAdmin) return <Navigate to="/servers" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireLogin>
                <Layout />
              </RequireLogin>
            }
          >
            <Route path="/servers" element={<ServersPage />} />
            <Route
              path="/servers/:identifier"
              element={
                <Suspense fallback={<Spinner className="size-4" />}>
                  <ServerPage />
                </Suspense>
              }
            />
            <Route path="/databases" element={<DatabasesPage />} />
            <Route path="/store" element={<StorePage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route
              path="/admin"
              element={
                <RequireLogin admin>
                  <AdminPage />
                </RequireLogin>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/servers" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
