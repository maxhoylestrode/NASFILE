import { useRef, useState } from 'react';
import { X, RotateCcw, Trash2, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';
import { useUploads } from '../upload/useUploads';
import { discardUpload, startUpload } from '../upload/uploadManager';
import { formatBytes } from '../lib/format';
import { getFileIcon } from '../lib/fileIcons';
import type { UploadRecord } from '../upload/uploadStore';

/**
 * Records that survive a reload (status 'incomplete') can't resume with
 * one click — the actual bytes are gone once the page reloads, browsers
 * don't let us keep hold of a File across a reload. Resuming just means
 * re-selecting the same file; we detect it's the same file by name+size+
 * lastModified and skip re-uploading whatever MinIO already has.
 */
function ResumePicker({ record, onDone }: { record: UploadRecord; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    const matches = file.name === record.name && file.size === record.sizeBytes;
    if (!matches) {
      setError(`That's not the same file (expected "${record.name}", ${formatBytes(record.sizeBytes)})`);
      return;
    }
    setError(null);
    try {
      await startUpload({ file, folderId: record.folderId });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resume failed');
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <button onClick={() => inputRef.current?.click()} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
        Select file to resume
      </button>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function UploadPanel() {
  const uploads = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  if (uploads.length === 0) return null;

  const activeCount = uploads.filter((u) => u.status === 'uploading' || u.status === 'completing').length;
  const overallPct = (() => {
    const active = uploads.filter((u) => u.status === 'uploading' && u.sizeBytes > 0);
    if (active.length === 0) return null;
    const total = active.reduce((sum, u) => sum + u.sizeBytes, 0);
    const done = active.reduce((sum, u) => sum + u.bytesUploaded, 0);
    return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  })();
  const summary =
    activeCount > 0
      ? `Uploading ${activeCount} file${activeCount === 1 ? '' : 's'}${overallPct !== null ? ` — ${overallPct}%` : ''}`
      : `${uploads.length} upload${uploads.length === 1 ? '' : 's'}`;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-40 animate-slide-up overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg transition-colors duration-200 dark:border-slate-700 dark:bg-slate-800 sm:left-auto sm:w-80">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left transition-colors duration-150 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/50"
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">{summary}</span>
        {collapsed ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        )}
      </button>

      {collapsed && overallPct !== null && (
        <div className="h-1 w-full bg-slate-100 dark:bg-slate-700">
          <div className="h-full bg-indigo-500 transition-all dark:bg-indigo-400" style={{ width: `${overallPct}%` }} />
        </div>
      )}

      {!collapsed && (
        <div className="max-h-80 overflow-y-auto">
          {uploads.map((u) => {
            const pct = u.sizeBytes > 0 ? Math.min(100, Math.round((u.bytesUploaded / u.sizeBytes) * 100)) : 0;
            const FileIconComp = getFileIcon(u.name);
            return (
              <div key={u.key} className="animate-fade-in border-b border-slate-50 px-3 py-2 last:border-0 dark:border-slate-700/50">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs text-slate-700 dark:text-slate-200">
                    <FileIconComp.icon className={`h-3.5 w-3.5 shrink-0 ${FileIconComp.color}`} />
                    <span className="truncate">{u.name}</span>
                  </span>
                  {(u.status === 'incomplete' || u.status === 'error') && (
                    <button
                      title="Discard upload"
                      onClick={() => void discardUpload(u)}
                      className="shrink-0 text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {u.status === 'uploading' && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                    <div className="h-full bg-indigo-500 transition-all dark:bg-indigo-400" style={{ width: `${pct}%` }} />
                  </div>
                )}
                {u.status === 'uploading' && (
                  <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                    {formatBytes(u.bytesUploaded)} / {formatBytes(u.sizeBytes)} ({pct}%)
                  </p>
                )}
                {u.status === 'completing' && <p className="text-[11px] text-slate-400 dark:text-slate-500">Finishing up…</p>}
                {u.status === 'done' && (
                  <p className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" /> Uploaded
                  </p>
                )}
                {u.status === 'incomplete' && (
                  <div className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                    <RotateCcw className="h-3 w-3" /> Paused — <ResumePicker record={u} onDone={() => {}} />
                  </div>
                )}
                {u.status === 'error' && (
                  <div className="flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400">
                    <X className="h-3 w-3" /> {u.error ?? 'Failed'} — <ResumePicker record={u} onDone={() => {}} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
