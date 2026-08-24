import { useEffect, useState } from 'react';
import { Folder as FolderIcon, ChevronRight } from 'lucide-react';
import { api } from '../api/client';
import type { Folder } from '../api/types';
import { Modal } from './Modal';

interface MoveModalProps {
  title: string;
  rootFolderId: string;
  /** Folder ids that shouldn't be selectable (e.g. the item's own id, to block moving a folder into itself). */
  disabledIds?: string[];
  onMove: (destinationFolderId: string) => Promise<void>;
  onClose: () => void;
}

export function MoveModal({ title, rootFolderId, disabledIds = [], onMove, onClose }: MoveModalProps) {
  const [currentId, setCurrentId] = useState(rootFolderId);
  const [path, setPath] = useState<{ id: string; name: string }[]>([{ id: rootFolderId, name: 'My Drive' }]);
  const [subfolders, setSubfolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getFolder(currentId)
      .then((res) => {
        if (cancelled) return;
        setSubfolders(res.subfolders);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  const navigateInto = (folder: Folder) => {
    setCurrentId(folder.id);
    setPath((p) => [...p, { id: folder.id, name: folder.name }]);
  };

  const navigateTo = (index: number) => {
    setPath((p) => p.slice(0, index + 1));
    setCurrentId(path[index].id);
  };

  const handleMoveHere = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onMove(currentId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Move failed');
      setSubmitting(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <nav className="mb-2 flex flex-wrap items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
        {path.map((crumb, i) => (
          <span key={crumb.id} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3" />}
            <button onClick={() => navigateTo(i)} className="rounded px-1 hover:bg-slate-100 dark:hover:bg-slate-700">
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="mb-3 h-48 overflow-y-auto rounded border border-slate-200 dark:border-slate-700">
        {loading ? (
          <p className="p-3 text-sm text-slate-400 dark:text-slate-500">Loading…</p>
        ) : subfolders.length === 0 ? (
          <p className="p-3 text-sm text-slate-400 dark:text-slate-500">No subfolders here</p>
        ) : (
          subfolders.map((f) => {
            const disabled = disabledIds.includes(f.id);
            return (
              <button
                key={f.id}
                onClick={() => !disabled && navigateInto(f)}
                disabled={disabled}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                <FolderIcon className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
                {f.name}
              </button>
            );
          })
        )}
      </div>

      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700">
          Cancel
        </button>
        <button
          onClick={handleMoveHere}
          disabled={submitting || disabledIds.includes(currentId)}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Moving…' : `Move here (${path[path.length - 1].name})`}
        </button>
      </div>
    </Modal>
  );
}
