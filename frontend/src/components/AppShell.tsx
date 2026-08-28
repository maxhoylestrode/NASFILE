import { useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { UploadPanel } from './UploadPanel';

interface AppShellProps {
  children: ReactNode;
  onNewFolder?: () => void;
  onUploadClick?: () => void;
}

/**
 * Shared page shell (Sidebar + TopBar + scrollable main + UploadPanel)
 * used by every authenticated page. Below the md breakpoint the sidebar
 * becomes an off-canvas drawer — fixed and translated off-screen by
 * default, toggled via the hamburger button in TopBar, dismissed by
 * tapping the backdrop or picking a nav destination — instead of
 * permanently eating ~240px of a phone-width screen the way a plain
 * always-visible w-60 sidebar would.
 */
export function AppShell({ children, onNewFolder, onUploadClick }: AppShellProps) {
  const { user, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // Picking a destination (or any route change) should close the drawer
  // rather than leaving it open over the page you just navigated to.
  // Adjusted during render (not an effect) so it doesn't trigger an
  // extra commit-then-render pass for what's really a derived reset.
  const [lastPathname, setLastPathname] = useState(location.pathname);
  if (location.pathname !== lastPathname) {
    setLastPathname(location.pathname);
    setNavOpen(false);
  }

  return (
    <div className="flex h-screen bg-slate-50 transition-colors duration-200 dark:bg-slate-900">
      {navOpen && (
        <div
          className="fixed inset-0 z-30 animate-fade-in bg-black/40 md:hidden"
          onClick={() => setNavOpen(false)}
          role="presentation"
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-40 transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar
          onNewFolder={onNewFolder}
          onUploadClick={onUploadClick}
          isAdmin={user?.isAdmin}
          onNavigate={() => setNavOpen(false)}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar email={user?.email} onLogout={logout} onMenuClick={() => setNavOpen(true)} />
        <main className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
          <div className="mx-auto max-w-4xl">{children}</div>
        </main>
      </div>

      <UploadPanel />
    </div>
  );
}
