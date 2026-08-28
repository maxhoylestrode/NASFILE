import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Folder as FolderIcon, RotateCcw, Trash2 } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { AppShell } from '../components/AppShell';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatDate } from '../lib/format';
import { getFileIcon } from '../lib/fileIcons';
import type { DriveFile, Folder } from '../api/types';

type PermanentDeleteTarget = { kind: 'folder'; item: Folder } | { kind: 'file'; item: DriveFile } | null;

export function BinPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PermanentDeleteTarget>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['trash'],
    queryFn: () => api.getTrash(),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['trash'] });
    queryClient.invalidateQueries({ queryKey: ['folder'] });
    queryClient.invalidateQueries({ queryKey: ['storage'] });
  };

  const restoreFolder = async (id: string) => {
    setError(null);
    try {
      await api.restoreFolder(id);
      invalidate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Restore failed');
    }
  };

  const restoreFile = async (id: string) => {
    setError(null);
    try {
      await api.restoreFile(id);
      invalidate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Restore failed');
    }
  };

  const permanentlyDelete = async () => {
    if (!confirmDelete) return;
    if (confirmDelete.kind === 'folder') {
      await api.permanentlyDeleteFolder(confirmDelete.item.id);
    } else {
      await api.permanentlyDeleteFile(confirmDelete.item.id);
    }
    invalidate();
  };

  const isEmpty = data && data.folders.length === 0 && data.files.length === 0;

  return (
    <>
    <AppShell>
            <div className="mb-4">
              <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Bin</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Items here can be restored, or deleted for good.
              </p>
            </div>

            {error && (
              <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
                {error}
              </p>
            )}

            <div className="animate-fade-in rounded-lg border border-slate-200 bg-white transition-colors duration-200 dark:border-slate-700 dark:bg-slate-800">
              {isLoading && <p className="p-6 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</p>}
              {isEmpty && (
                <p className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">The Bin is empty.</p>
              )}
              {data?.folders.map((folder) => (
                <div
                  key={folder.id}
                  className="group flex items-center gap-3 rounded-md px-3 py-2 transition-colors duration-150 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                >
                  <FolderIcon className="h-5 w-5 shrink-0 text-indigo-500 dark:text-indigo-400" />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100">{folder.name}</span>
                  <span className="hidden shrink-0 text-xs text-slate-400 sm:inline dark:text-slate-500">
                    Deleted {formatDate(folder.deletedAt!)}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      title="Restore"
                      onClick={() => restoreFolder(folder.id)}
                      className="rounded p-1.5 text-slate-500 transition-colors duration-150 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-600"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <button
                      title="Delete forever"
                      onClick={() => setConfirmDelete({ kind: 'folder', item: folder })}
                      className="rounded p-1.5 text-red-500 transition-colors duration-150 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
              {data?.files.map((file) => {
                const { icon: Icon, color } = getFileIcon(file.name);
                return (
                  <div
                    key={file.id}
                    className="group flex items-center gap-3 rounded-md px-3 py-2 transition-colors duration-150 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                  >
                    <Icon className={`h-5 w-5 shrink-0 ${color}`} />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100">{file.name}</span>
                    <span className="hidden shrink-0 text-xs text-slate-400 sm:inline dark:text-slate-500">
                      Deleted {formatDate(file.deletedAt!)}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        title="Restore"
                        onClick={() => restoreFile(file.id)}
                        className="rounded p-1.5 text-slate-500 transition-colors duration-150 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-600"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <button
                        title="Delete forever"
                        onClick={() => setConfirmDelete({ kind: 'file', item: file })}
                        className="rounded p-1.5 text-red-500 transition-colors duration-150 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
    </AppShell>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete forever"
          message={`Permanently delete "${confirmDelete.item.name}"? This cannot be undone.`}
          confirmLabel="Delete forever"
          danger
          onClose={() => setConfirmDelete(null)}
          onConfirm={permanentlyDelete}
        />
      )}
    </>
  );
}
