import { useRef, useState } from 'react';
import { X, RotateCcw, Trash2 } from 'lucide-react';
import { useUploads } from '../upload/useUploads';
import { discardUpload, startUpload } from '../upload/uploadManager';
import { formatBytes } from '../lib/format';
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
  if (uploads.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
      <div className="border-b border-slate-100 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200">
        Uploads ({uploads.length})
      </div>
      <div className="max-h-80 overflow-y-auto">
        {uploads.map((u) => {
          const pct = u.sizeBytes > 0 ? Math.min(100, Math.round((u.bytesUploaded / u.sizeBytes) * 100)) : 0;
          return (
            <div key={u.key} className="border-b border-slate-50 px-3 py-2 last:border-0 dark:border-slate-700/50">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-slate-700 dark:text-slate-200">{u.name}</span>
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
    </div>
  );
}
