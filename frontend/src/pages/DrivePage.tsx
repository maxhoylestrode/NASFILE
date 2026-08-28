import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { List, LayoutGrid, FolderOpen, Download, Share2, Pencil, FolderInput, Trash2, Eye } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Breadcrumb } from '../components/Breadcrumb';
import { ItemRow } from '../components/ItemRow';
import { PromptModal } from '../components/PromptModal';
import { MoveModal } from '../components/MoveModal';
import { ShareModal } from '../components/ShareModal';
import { PreviewModal } from '../components/PreviewModal';
import { AppShell } from '../components/AppShell';
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu';
import { useViewMode } from '../lib/useViewMode';
import { getPreviewKind, type PreviewKind } from '../lib/mediaType';
import { startUpload } from '../upload/uploadManager';
import type { DriveFile, Folder } from '../api/types';

type ModalState =
  | { type: 'new-folder' }
  | { type: 'rename-folder'; folder: Folder }
  | { type: 'rename-file'; file: DriveFile }
  | { type: 'move-folder'; folder: Folder }
  | { type: 'move-file'; file: DriveFile }
  | { type: 'share-folder'; folder: Folder }
  | { type: 'share-file'; file: DriveFile }
  | null;

type ContextTarget = { x: number; y: number } & ({ kind: 'folder'; item: Folder } | { kind: 'file'; item: DriveFile });

export function DrivePage() {
  const { rootFolderId } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [view, setView] = useViewMode();

  const [path, setPath] = useState<{ id: string; name: string }[]>([{ id: rootFolderId!, name: 'My Drive' }]);
  const currentId = path[path.length - 1].id;
  const [modal, setModal] = useState<ModalState>(null);
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(null);
  const [previewStart, setPreviewStart] = useState<DriveFile | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['folder', currentId],
    queryFn: () => api.getFolder(currentId),
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['folder', currentId] });
    queryClient.invalidateQueries({ queryKey: ['storage'] });
  }, [queryClient, currentId]);

  const mediaItems: { file: DriveFile; kind: PreviewKind }[] = (data?.files ?? [])
    .map((file) => {
      const kind = getPreviewKind(file.name);
      return kind ? { file, kind } : null;
    })
    .filter((x): x is { file: DriveFile; kind: PreviewKind } => x !== null);

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

  const openFolderContextMenu = (e: React.MouseEvent, item: Folder) => {
    e.preventDefault();
    setContextTarget({ kind: 'folder', item, x: e.clientX, y: e.clientY });
  };
  const openFileContextMenu = (e: React.MouseEvent, item: DriveFile) => {
    e.preventDefault();
    setContextTarget({ kind: 'file', item, x: e.clientX, y: e.clientY });
  };

  const contextMenuItems: ContextMenuItem[] = (() => {
    if (!contextTarget) return [];
    const { kind, item } = contextTarget;
    const canManage = !(kind === 'folder' && item.isRoot);
    const items: ContextMenuItem[] = [];

    if (kind === 'folder') {
      items.push({ label: 'Open', icon: FolderOpen, onClick: () => openFolder(item) });
    } else {
      const previewKind = getPreviewKind(item.name);
      if (item.status === 'complete' && previewKind) {
        items.push({ label: 'Preview', icon: Eye, onClick: () => setPreviewStart(item) });
      }
      if (item.status === 'complete') {
        items.push({ label: 'Download', icon: Download, onClick: () => handleDownload(item) });
      }
    }

    if (canManage) {
      items.push({
        label: 'Share',
        icon: Share2,
        onClick: () => setModal(kind === 'folder' ? { type: 'share-folder', folder: item } : { type: 'share-file', file: item }),
      });
      items.push({
        label: 'Rename',
        icon: Pencil,
        onClick: () =>
          setModal(kind === 'folder' ? { type: 'rename-folder', folder: item } : { type: 'rename-file', file: item }),
      });
      items.push({
        label: 'Move',
        icon: FolderInput,
        onClick: () => setModal(kind === 'folder' ? { type: 'move-folder', folder: item } : { type: 'move-file', file: item }),
      });
      items.push({
        label: 'Move to Bin',
        icon: Trash2,
        danger: true,
        onClick: () => runAction(() => (kind === 'folder' ? api.deleteFolder(item.id) : api.deleteFile(item.id))),
      });
    }

    return items;
  })();

  return (
    <>
    <AppShell onNewFolder={() => setModal({ type: 'new-folder' })} onUploadClick={() => fileInputRef.current?.click()}>
            <div className="mb-4 flex items-center justify-between gap-2">
              <Breadcrumb path={path} onNavigate={navigateTo} />
              <div className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 p-0.5 dark:border-slate-700">
                <button
                  title="List view"
                  onClick={() => setView('list')}
                  className={`rounded p-1.5 transition-colors duration-150 ${
                    view === 'list'
                      ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400'
                      : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  <List className="h-4 w-4" />
                </button>
                <button
                  title="Grid view"
                  onClick={() => setView('grid')}
                  className={`rounded p-1.5 transition-colors duration-150 ${
                    view === 'grid'
                      ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400'
                      : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
              </div>
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

            <div className="animate-fade-in rounded-lg border border-slate-200 bg-white transition-colors duration-200 dark:border-slate-700 dark:bg-slate-800">
              {isLoading && <p className="p-6 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</p>}
              {error && (
                <p className="p-6 text-center text-sm text-red-600 dark:text-red-400">Failed to load this folder.</p>
              )}
              {data && data.subfolders.length === 0 && data.files.length === 0 && (
                <p className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">
                  Empty — drag files in, or use New.
                </p>
              )}
              {data && (data.subfolders.length > 0 || data.files.length > 0) && (
                <div
                  className={
                    view === 'grid'
                      ? 'grid grid-cols-3 gap-1 p-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6'
                      : 'p-2'
                  }
                >
                  {data.subfolders.map((folder) => (
                    <ItemRow
                      key={folder.id}
                      kind="folder"
                      item={folder}
                      view={view}
                      onOpen={() => openFolder(folder)}
                      onRename={() => setModal({ type: 'rename-folder', folder })}
                      onMove={() => setModal({ type: 'move-folder', folder })}
                      onDelete={() => runAction(() => api.deleteFolder(folder.id))}
                      onShare={() => setModal({ type: 'share-folder', folder })}
                      onContextMenu={(e) => openFolderContextMenu(e, folder)}
                    />
                  ))}
                  {data.files.map((file) => {
                    const previewKind = getPreviewKind(file.name);
                    return (
                      <ItemRow
                        key={file.id}
                        kind="file"
                        item={file}
                        view={view}
                        onDownload={() => handleDownload(file)}
                        onPreview={previewKind ? () => setPreviewStart(file) : undefined}
                        onRename={() => setModal({ type: 'rename-file', file })}
                        onMove={() => setModal({ type: 'move-file', file })}
                        onDelete={() => runAction(() => api.deleteFile(file.id))}
                        onShare={() => setModal({ type: 'share-file', file })}
                        onContextMenu={(e) => openFileContextMenu(e, file)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
    </AppShell>

      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-30 flex animate-fade-in items-center justify-center border-4 border-dashed border-indigo-400 bg-indigo-50/70 dark:bg-indigo-950/60">
          <p className="animate-scale-in text-lg font-medium text-indigo-700 dark:text-indigo-300">Drop to upload</p>
        </div>
      )}

      {contextTarget && (
        <ContextMenu
          x={contextTarget.x}
          y={contextTarget.y}
          items={contextMenuItems}
          onClose={() => setContextTarget(null)}
        />
      )}

      {previewStart && (
        <PreviewModal
          items={mediaItems}
          startIndex={Math.max(
            0,
            mediaItems.findIndex((m) => m.file.id === previewStart.id),
          )}
          onClose={() => setPreviewStart(null)}
        />
      )}

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
      {modal?.type === 'share-folder' && (
        <ShareModal
          resourceType="folder"
          resourceId={modal.folder.id}
          resourceName={modal.folder.name}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'share-file' && (
        <ShareModal
          resourceType="file"
          resourceId={modal.file.id}
          resourceName={modal.file.name}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
