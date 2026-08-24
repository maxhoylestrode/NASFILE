import { Routes, Route } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { DrivePage } from './pages/DrivePage';
import { BinPage } from './pages/BinPage';
import { SharedWithMePage } from './pages/SharedWithMePage';
import { AdminInvitesPage } from './pages/AdminInvitesPage';
import { RequireAuth, RequireAdmin } from './components/RequireAuth';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <DrivePage />
          </RequireAuth>
        }
      />
      <Route
        path="/bin"
        element={
          <RequireAuth>
            <BinPage />
          </RequireAuth>
        }
      />
      <Route
        path="/shared"
        element={
          <RequireAuth>
            <SharedWithMePage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin/invites"
        element={
          <RequireAuth>
            <RequireAdmin>
              <AdminInvitesPage />
            </RequireAdmin>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
