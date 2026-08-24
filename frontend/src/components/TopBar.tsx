import { LogOut } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

export function TopBar({ email, onLogout }: { email?: string; onLogout: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-slate-200 bg-white px-4 dark:border-slate-700 dark:bg-slate-800">
      <span className="hidden text-sm text-slate-500 sm:inline dark:text-slate-400">{email}</span>
      <ThemeToggle />
      <button
        onClick={onLogout}
        title="Sign out"
        className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </header>
  );
}
