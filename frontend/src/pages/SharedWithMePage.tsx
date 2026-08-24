import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Folder as FolderIcon, Users } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Sidebar } from '../components/Sidebar';
import { TopBar } from '../components/TopBar';
import { ItemRow } from '../components/ItemRow';
import { UploadPanel } from '../components/UploadPanel';
import { getFileIcon } from '../lib/fileIcons';
import type { DriveFile, Folder } from '../api/types';

type Crumb = { id: string; name: string };

export function SharedWithMePage() {
  const { user, logout } = useAuth();
  const [path, setPath] = useState<Crumb[]>([]); // empty = top-level "Shared with me" list
  const [actionError, setActionError] = useState<string | null>(null);
  const insideSharedFolder = path.length > 0;
  const currentId = insideSharedFolder ? path[path.length - 1].id : null;

  const topLevel = useQuery({
    queryKey: ['shared-with-me'],
    queryFn: () => api.getSharedWithMe(),
    enabled: !insideSharedFolder,
  });

  const nested = useQuery({
    queryKey: ['folder', currentId],
    queryFn: () => api.getFolder(currentId!),
    enabled: insideSharedFolder,
  });

  const openFolder = (folder: Folder) => setPath((p) => [...p, { id: folder.id, name: folder.name }]);
  const navigateTo = (index: number) => setPath((p) => (index < 0 ? [] : p.slice(0, index + 1)));

  const handleDownload = async (file: DriveFile) => {
    try {
      const { url } = await api.getDownloadUrl(file.id);
      window.location.href = url;
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Download failed');
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 transition-colors duration-200 dark:bg-slate-900">
      <Sidebar isAdmin={user?.isAdmin} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar email={user?.email} onLogout={logout} />

        <main className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-4xl">
            <div className="mb-4">
              <nav className="flex flex-wrap items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
                <button
                  onClick={() => navigateTo(-1)}
                  className={`rounded px-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-700 ${
                    !insideSharedFolder ? 'font-medium text-slate-900 dark:text-slate-100' : ''
                  }`}
                >
                  Shared with me
                </button>
                {path.map((crumb, i) => (
                  <span key={crumb.id} className="flex items-center gap-1">
                    <span className="text-slate-300 dark:text-slate-600">/</span>
                    <button
                      onClick={() => navigateTo(i)}
                      className={`rounded px-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-700 ${
                        i === path.length - 1 ? 'font-medium text-slate-900 dark:text-slate-100' : ''
                      }`}
                    >
                      {crumb.name}
                    </button>
                  </span>
                ))}
              </nav>
            </div>

            {actionError && (
              <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
                {actionError}
              </p>
            )}

            <div className="animate-fade-in rounded-lg border border-slate-200 bg-white transition-colors duration-200 dark:border-slate-700 dark:bg-slate-800">
              {!insideSharedFolder && (
                <>
                  {topLevel.isLoading && (
                    <p className="p-6 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</p>
                  )}
                  {topLevel.data && topLevel.data.folders.length === 0 && topLevel.data.files.length === 0 && (
                    <p className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">
                      Nothing's been shared with you yet.
                    </p>
                  )}
                  {topLevel.data?.folders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => openFolder(folder)}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors duration-150 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                    >
                      <FolderIcon className="h-5 w-5 shrink-0 text-indigo-500 dark:text-indigo-400" />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100">
                        {folder.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                        <Users className="h-3 w-3" /> {folder.ownerEmail}
                      </span>
                    </button>
                  ))}
                  {topLevel.data?.files.map((file) => {
                    const { icon: Icon, color } = getFileIcon(file.name);
                    return (
                      <button
                        key={file.id}
                        onClick={() => handleDownload(file)}
                        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors duration-150 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                      >
                        <Icon className={`h-5 w-5 shrink-0 ${color}`} />
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100">
                          {file.name}
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                          <Users className="h-3 w-3" /> {file.ownerEmail}
                        </span>
                      </button>
                    );
                  })}
                </>
              )}

              {insideSharedFolder && (
                <>
                  {nested.isLoading && (
                    <p className="p-6 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</p>
                  )}
                  {nested.error && (
                    <p className="p-6 text-center text-sm text-red-600 dark:text-red-400">
                      Failed to load — access may have been revoked.
                    </p>
                  )}
                  {nested.data && nested.data.subfolders.length === 0 && nested.data.files.length === 0 && (
                    <p className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">Empty.</p>
                  )}
                  {nested.data?.subfolders.map((folder) => (
                    <ItemRow
                      key={folder.id}
                      kind="folder"
                      item={folder}
                      readOnly
                      onOpen={() => openFolder(folder)}
                      onRename={() => {}}
                      onMove={() => {}}
                      onDelete={() => {}}
                      onShare={() => {}}
                    />
                  ))}
                  {nested.data?.files.map((file) => (
                    <ItemRow
                      key={file.id}
                      kind="file"
                      item={file}
                      readOnly
                      onDownload={() => handleDownload(file)}
                      onRename={() => {}}
                      onMove={() => {}}
                      onDelete={() => {}}
                      onShare={() => {}}
                    />
                  ))}
                </>
              )}
            </div>
          </div>
        </main>
      </div>

      <UploadPanel />
    </div>
  );
}
