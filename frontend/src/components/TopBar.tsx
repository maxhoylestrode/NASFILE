import { LogOut, Menu } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

interface TopBarProps {
  email?: string;
  onLogout: () => void;
  /** Present only inside AppShell — opens the mobile drawer. Omit for a bare TopBar with no sidebar. */
  onMenuClick?: () => void;
}

export function TopBar({ email, onLogout, onMenuClick }: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 transition-colors duration-200 dark:border-slate-700 dark:bg-slate-800">
      {onMenuClick && (
        <button
          onClick={onMenuClick}
          title="Menu"
          className="rounded p-1.5 text-slate-600 transition-colors duration-150 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}
      <span className="flex-1" />
      <span className="hidden text-sm text-slate-500 sm:inline dark:text-slate-400">{email}</span>
      <ThemeToggle />
      <button
        onClick={onLogout}
        title="Sign out"
        className="rounded p-1.5 text-slate-500 transition-colors duration-150 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </header>
  );
}
