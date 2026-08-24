import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Breadcrumb } from '../components/Breadcrumb';
import { ItemRow } from '../components/ItemRow';
import { PromptModal } from '../components/PromptModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { MoveModal } from '../components/MoveModal';
import { UploadPanel } from '../components/UploadPanel';
import { Sidebar } from '../components/Sidebar';
import { TopBar } from '../components/TopBar';
import { startUpload } from '../upload/uploadManager';
import type { DriveFile, Folder } from '../api/types';

type ModalState =
  | { type: 'new-folder' }
  | { type: 'rename-folder'; folder: Folder }
  | { type: 'rename-file'; file: DriveFile }
  | { type: 'move-folder'; folder: Folder }
  | { type: 'move-file'; file: DriveFile }
  | { type: 'delete-folder'; folder: Folder }
  | { type: 'delete-file'; file: DriveFile }
  | null;

export function DrivePage() {
  const { user, rootFolderId, logout } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const [path, setPath] = useState<{ id: string; name: string }[]>([{ id: rootFolderId!, name: 'My Drive' }]);
  const currentId = path[path.length - 1].id;
  const [modal, setModal] = useState<ModalState>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['folder', currentId],
    queryFn: () => api.getFolder(currentId),
  });

  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: ['folder', currentId] }), [queryClient, currentId]);

  const openFolder = (folder: Folder) => setPath((p) => [...p, { id: folder.id, name: folder.name }]);
  const navigateTo = (id: string) => setPath((p) => p.slice(0, p.findIndex((c) => c.id === id) + 1));

  const uploadFiles = useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        startUpload({ file, folderId: currentId }).finally(invalidate);
        setTimeout(invalidate, 800); // pick up the 'pending' row as soon as it's created
      }
    },
    [currentId, invalidate],
  );

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    };
    const onDragLeave = () => setDragOver(false);
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer?.files.length) uploadFiles(e.dataTransfer.files);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [uploadFiles]);

  const handleDownload = async (file: DriveFile) => {
    try {
      const { url } = await api.getDownloadUrl(file.id);
      window.location.href = url;
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Download failed');
    }
  };

  const runAction = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
      invalidate();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong');
      throw err;
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-900">
      <Sidebar
        onNewFolder={() => setModal({ type: 'new-folder' })}
        onUploadClick={() => fileInputRef.current?.click()}
        isAdmin={user?.isAdmin}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar email={user?.email} onLogout={logout} />

        <main className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-4xl">
            <div className="mb-4 flex items-center justify-between gap-2">
              <Breadcrumb path={path} onNavigate={navigateTo} />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && uploadFiles(e.target.files)}
              />
            </div>

            {actionError && (
              <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
                {actionError}
              </p>
            )}

            <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
              {isLoading && <p className="p-6 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</p>}
              {error && (
                <p className="p-6 text-center text-sm text-red-600 dark:text-red-400">Failed to load this folder.</p>
              )}
              {data && data.subfolders.length === 0 && data.files.length === 0 && (
                <p className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">
                  Empty — drag files in, or use New.
                </p>
              )}
              {data?.subfolders.map((folder) => (
                <ItemRow
                  key={folder.id}
                  kind="folder"
                  item={folder}
                  onOpen={() => openFolder(folder)}
                  onRename={() => setModal({ type: 'rename-folder', folder })}
                  onMove={() => setModal({ type: 'move-folder', folder })}
                  onDelete={() => setModal({ type: 'delete-folder', folder })}
                />
              ))}
              {data?.files.map((file) => (
                <ItemRow
                  key={file.id}
                  kind="file"
                  item={file}
                  onDownload={() => handleDownload(file)}
                  onRename={() => setModal({ type: 'rename-file', file })}
                  onMove={() => setModal({ type: 'move-file', file })}
                  onDelete={() => setModal({ type: 'delete-file', file })}
                />
              ))}
            </div>
          </div>
        </main>
      </div>

      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center border-4 border-dashed border-indigo-400 bg-indigo-50/70 dark:bg-indigo-950/60">
          <p className="text-lg font-medium text-indigo-700 dark:text-indigo-300">Drop to upload</p>
        </div>
      )}

      <UploadPanel />

      {modal?.type === 'new-folder' && (
        <PromptModal
          title="New folder"
          label="Folder name"
          confirmLabel="Create"
          onClose={() => setModal(null)}
          onSubmit={(name) => runAction(() => api.createFolder(name, currentId))}
        />
      )}
      {modal?.type === 'rename-folder' && (
        <PromptModal
          title="Rename folder"
          label="Folder name"
          initialValue={modal.folder.name}
          onClose={() => setModal(null)}
          onSubmit={(name) => runAction(() => api.renameFolder(modal.folder.id, name))}
        />
      )}
      {modal?.type === 'rename-file' && (
        <PromptModal
          title="Rename file"
          label="File name"
          initialValue={modal.file.name}
          onClose={() => setModal(null)}
          onSubmit={(name) => runAction(() => api.renameFile(modal.file.id, name))}
        />
      )}
      {modal?.type === 'move-folder' && (
        <MoveModal
          title={`Move "${modal.folder.name}"`}
          rootFolderId={rootFolderId!}
          disabledIds={[modal.folder.id]}
          onClose={() => setModal(null)}
          onMove={(destId) => runAction(() => api.moveFolder(modal.folder.id, destId))}
        />
      )}
      {modal?.type === 'move-file' && (
        <MoveModal
          title={`Move "${modal.file.name}"`}
          rootFolderId={rootFolderId!}
          onClose={() => setModal(null)}
          onMove={(destId) => runAction(() => api.moveFile(modal.file.id, destId))}
        />
      )}
      {modal?.type === 'delete-folder' && (
        <ConfirmDialog
          title="Delete folder"
          message={`Delete "${modal.folder.name}" and everything inside it? This can't be undone.`}
          confirmLabel="Delete"
          danger
          onClose={() => setModal(null)}
          onConfirm={() => runAction(() => api.deleteFolder(modal.folder.id))}
        />
      )}
      {modal?.type === 'delete-file' && (
        <ConfirmDialog
          title="Delete file"
          message={`Delete "${modal.file.name}"? This can't be undone.`}
          confirmLabel="Delete"
          danger
          onClose={() => setModal(null)}
          onConfirm={() => runAction(() => api.deleteFile(modal.file.id))}
        />
      )}
    </div>
  );
}
