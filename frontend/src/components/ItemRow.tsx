import { Folder as FolderIcon, Download, Pencil, FolderInput, Trash2, Clock, Share2, MoreVertical } from 'lucide-react';
import type { DriveFile, Folder } from '../api/types';
import { formatBytes, formatDate } from '../lib/format';
import { getFileIcon } from '../lib/fileIcons';
import type { ViewMode } from '../lib/useViewMode';

interface FolderRowProps {
  kind: 'folder';
  item: Folder;
  onOpen: (id: string) => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  onShare: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  view?: ViewMode;
  /** Read-only browsing (e.g. a folder shared with you) — hides every write action. */
  readOnly?: boolean;
}

interface FileRowProps {
  kind: 'file';
  item: DriveFile;
  onDownload: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  onShare: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  view?: ViewMode;
  readOnly?: boolean;
}

type ItemRowProps = FolderRowProps | FileRowProps;

export function ItemRow(props: ItemRowProps) {
  const isFolder = props.kind === 'folder';
  const isPendingFile = props.kind === 'file' && props.item.status === 'pending';
  const FileIconComp = !isFolder ? getFileIcon(props.item.name) : null;
  const openHandler = isFolder ? () => props.onOpen(props.item.id) : props.kind === 'file' ? props.onDownload : undefined;
  const canManage = !props.readOnly && !(isFolder && props.item.isRoot);

  if (props.view === 'grid') {
    return (
      <div
        className="group relative flex flex-col items-center gap-2 rounded-lg border border-transparent p-3 text-center transition-colors duration-150 hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-700/50"
        onContextMenu={(e) => {
          if (props.onContextMenu) {
            e.preventDefault();
            props.onContextMenu(e);
          }
        }}
      >
        <button className="flex w-full flex-col items-center gap-2" onClick={openHandler} disabled={isPendingFile}>
          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100 transition-colors duration-150 dark:bg-slate-700">
            {isFolder ? (
              <FolderIcon className="h-8 w-8 text-indigo-500 dark:text-indigo-400" />
            ) : (
              FileIconComp && <FileIconComp.icon className={`h-8 w-8 ${FileIconComp.color}`} />
            )}
          </div>
          <span className="line-clamp-2 w-full break-words text-xs text-slate-700 dark:text-slate-200">
            {props.item.name}
          </span>
          {isPendingFile && (
            <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
              <Clock className="h-3 w-3" /> uploading…
            </span>
          )}
        </button>
        {props.onContextMenu && (
          <button
            title="More"
            onClick={props.onContextMenu}
            className="absolute right-1 top-1 rounded p-1 text-slate-400 opacity-0 transition-opacity duration-150 hover:bg-slate-200 group-hover:opacity-100 dark:hover:bg-slate-600"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="group flex items-center gap-3 rounded-md px-3 py-2 transition-colors duration-150 hover:bg-slate-50 dark:hover:bg-slate-700/50"
      onContextMenu={(e) => {
        if (props.onContextMenu) {
          e.preventDefault();
          props.onContextMenu(e);
        }
      }}
    >
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={openHandler} disabled={isPendingFile}>
        {isFolder ? (
          <FolderIcon className="h-5 w-5 shrink-0 text-indigo-500 dark:text-indigo-400" />
        ) : (
          FileIconComp && <FileIconComp.icon className={`h-5 w-5 shrink-0 ${FileIconComp.color}`} />
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100">{props.item.name}</span>
        {isPendingFile && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <Clock className="h-3.5 w-3.5" /> uploading…
          </span>
        )}
        {props.kind === 'file' && props.item.status === 'complete' && (
          <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">{formatBytes(props.item.sizeBytes)}</span>
        )}
        <span className="hidden shrink-0 text-xs text-slate-400 sm:inline dark:text-slate-500">
          {formatDate(props.item.updatedAt)}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        {props.kind === 'file' && props.item.status === 'complete' && (
          <button
            title="Download"
            onClick={props.onDownload}
            className="rounded p-1.5 text-slate-500 transition-colors duration-150 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-600"
          >
            <Download className="h-4 w-4" />
          </button>
        )}
        {canManage && (
          <>
            <button
              title="Share"
              onClick={props.onShare}
              className="rounded p-1.5 text-slate-500 transition-colors duration-150 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-600"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <button
              title="Rename"
              onClick={props.onRename}
              className="rounded p-1.5 text-slate-500 transition-colors duration-150 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-600"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              title="Move"
              onClick={props.onMove}
              className="rounded p-1.5 text-slate-500 transition-colors duration-150 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-600"
            >
              <FolderInput className="h-4 w-4" />
            </button>
            <button
              title="Move to Bin"
              onClick={props.onDelete}
              className="rounded p-1.5 text-red-500 transition-colors duration-150 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
