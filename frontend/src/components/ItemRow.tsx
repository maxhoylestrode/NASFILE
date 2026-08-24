import { Folder as FolderIcon, Download, Pencil, FolderInput, Trash2, Clock } from 'lucide-react';
import type { DriveFile, Folder } from '../api/types';
import { formatBytes, formatDate } from '../lib/format';
import { getFileIcon } from '../lib/fileIcons';

interface FolderRowProps {
  kind: 'folder';
  item: Folder;
  onOpen: (id: string) => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
}

interface FileRowProps {
  kind: 'file';
  item: DriveFile;
  onDownload: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
}

type ItemRowProps = FolderRowProps | FileRowProps;

export function ItemRow(props: ItemRowProps) {
  const isFolder = props.kind === 'folder';
  const isPendingFile = props.kind === 'file' && props.item.status === 'pending';
  const FileIconComp = !isFolder ? getFileIcon(props.item.name) : null;

  return (
    <div className="group flex items-center gap-3 rounded-md px-3 py-2 transition-colors duration-150 hover:bg-slate-50 dark:hover:bg-slate-700/50">
      <button
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={isFolder ? () => props.onOpen(props.item.id) : props.kind === 'file' ? props.onDownload : undefined}
        disabled={isPendingFile}
      >
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
        {!(isFolder && props.item.isRoot) && (
          <>
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
