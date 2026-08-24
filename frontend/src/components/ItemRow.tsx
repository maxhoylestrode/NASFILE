import { Folder as FolderIcon, File as FileIcon, Download, Pencil, FolderInput, Trash2, Clock } from 'lucide-react';
import type { DriveFile, Folder } from '../api/types';
import { formatBytes, formatDate } from '../lib/format';

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

  return (
    <div className="group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-slate-50">
      <button
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={isFolder ? () => props.onOpen(props.item.id) : props.kind === 'file' ? props.onDownload : undefined}
        disabled={isPendingFile}
      >
        {isFolder ? (
          <FolderIcon className="h-5 w-5 shrink-0 text-indigo-500" />
        ) : (
          <FileIcon className="h-5 w-5 shrink-0 text-slate-400" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{props.item.name}</span>
        {isPendingFile && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-amber-600">
            <Clock className="h-3.5 w-3.5" /> uploading…
          </span>
        )}
        {props.kind === 'file' && props.item.status === 'complete' && (
          <span className="shrink-0 text-xs text-slate-400">{formatBytes(props.item.sizeBytes)}</span>
        )}
        <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">{formatDate(props.item.updatedAt)}</span>
      </button>

      <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
        {props.kind === 'file' && props.item.status === 'complete' && (
          <button title="Download" onClick={props.onDownload} className="rounded p-1.5 text-slate-500 hover:bg-slate-200">
            <Download className="h-4 w-4" />
          </button>
        )}
        {!(isFolder && props.item.isRoot) && (
          <>
            <button title="Rename" onClick={props.onRename} className="rounded p-1.5 text-slate-500 hover:bg-slate-200">
              <Pencil className="h-4 w-4" />
            </button>
            <button title="Move" onClick={props.onMove} className="rounded p-1.5 text-slate-500 hover:bg-slate-200">
              <FolderInput className="h-4 w-4" />
            </button>
            <button title="Delete" onClick={props.onDelete} className="rounded p-1.5 text-red-500 hover:bg-red-50">
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
