import { useEffect, useRef, useState } from 'react';
import { HardDrive, Plus, FolderPlus, Upload as UploadIcon, UserPlus, Folder as FolderIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

interface SidebarProps {
  onNewFolder: () => void;
  onUploadClick: () => void;
  isAdmin?: boolean;
}

export function Sidebar({ onNewFolder, onUploadClick, isAdmin }: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-4 transition-colors duration-200 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-5 flex items-center gap-2 px-2">
        <HardDrive className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
        <span className="text-lg font-semibold text-slate-900 dark:text-slate-100">Silo</span>
      </div>

      <div ref={menuRef} className="relative mb-4">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 transition-all duration-150 hover:shadow-md active:scale-[0.97] dark:bg-slate-700 dark:text-slate-100 dark:ring-slate-600"
        >
          <Plus className="h-5 w-5 text-indigo-600 dark:text-indigo-400" /> New
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-full z-20 mt-1 w-48 origin-top animate-slide-down overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-700">
            <button
              onClick={() => {
                setMenuOpen(false);
                onNewFolder();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors duration-100 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-600"
            >
              <FolderPlus className="h-4 w-4 text-slate-500 dark:text-slate-300" /> New folder
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                onUploadClick();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors duration-100 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-600"
            >
              <UploadIcon className="h-4 w-4 text-slate-500 dark:text-slate-300" /> Upload files
            </button>
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-3 rounded-full bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
          <FolderIcon className="h-4 w-4" /> My Drive
        </div>
        {isAdmin && (
          <Link
            to="/admin/invites"
            className={`flex items-center gap-3 rounded-full px-3 py-2 text-sm font-medium transition-colors duration-150 hover:bg-slate-50 dark:hover:bg-slate-700 ${
              location.pathname === '/admin/invites'
                ? 'text-indigo-700 dark:text-indigo-300'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <UserPlus className="h-4 w-4" /> Invites
          </Link>
        )}
      </nav>
    </aside>
  );
}
