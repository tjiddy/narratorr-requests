import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useMe } from './hooks';
import { ApiError } from './api';
import { Layout } from './components/Layout';
import { SearchPage } from './pages/SearchPage';
import { MyRequestsPage } from './pages/MyRequestsPage';
import { AdminQueuePage } from './pages/AdminQueuePage';
import { LoginPage } from './pages/LoginPage';

export function App() {
  const me = useMe();

  if (me.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Loading…
      </div>
    );
  }

  // 401 (or any load failure) → not signed in.
  if (me.error || !me.data) {
    if (me.error instanceof ApiError && me.error.status !== 401) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background text-destructive">
          {me.error.message}
        </div>
      );
    }
    return <LoginPage />;
  }

  const isAdmin = me.data.role === 'admin';

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout me={me.data} />}>
          <Route index element={<SearchPage />} />
          <Route path="requests" element={<MyRequestsPage />} />
          <Route path="admin" element={isAdmin ? <AdminQueuePage /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
