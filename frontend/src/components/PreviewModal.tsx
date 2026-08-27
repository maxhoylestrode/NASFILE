import { useEffect, useState } from 'react';
import { X, Download, Loader2 } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { DriveFile } from '../api/types';
import type { PreviewKind } from '../lib/mediaType';

interface PreviewModalProps {
  file: DriveFile;
  kind: PreviewKind;
  onClose: () => void;
}

/**
 * A full-screen lightbox for photos/videos — reuses the same presigned
 * download URL as an actual download, just rendered inline instead of
 * saved to disk. Content-Disposition on that URL is 'attachment', but
 * that only affects top-level navigation/direct clicks, not an <img>/
 * <video> tag loading it as a subresource, so no backend change is
 * needed for this to render.
 */
export function PreviewModal({ file, kind, onClose }: PreviewModalProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // No reset-to-null here: the modal is always fully unmounted (preview
    // state goes back to null) before a new one opens for a different
    // file, so this effect only ever runs once per mount with fresh state.
    api
      .getDownloadUrl(file.id)
      .then((res) => {
        if (!cancelled) setUrl(res.url);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load preview');
      });
    return () => {
      cancelled = true;
    };
  }, [file.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in flex-col bg-black/90"
      onClick={onClose}
      role="presentation"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 truncate text-sm text-white/90">{file.name}</span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            title="Download"
            onClick={() => url && (window.location.href = url)}
            disabled={!url}
            className="rounded p-2 text-white/80 transition-colors duration-150 hover:bg-white/10 disabled:opacity-40"
          >
            <Download className="h-5 w-5" />
          </button>
          <button
            title="Close"
            onClick={onClose}
            className="rounded p-2 text-white/80 transition-colors duration-150 hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div
        className="flex flex-1 items-center justify-center overflow-hidden px-4 pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        {!url && !error && <Loader2 className="h-8 w-8 animate-spin text-white/60" />}
        {error && <p className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        {url && kind === 'image' && (
          <img src={url} alt={file.name} className="max-h-full max-w-full animate-scale-in object-contain" />
        )}
        {url && kind === 'video' && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={url} controls autoPlay className="max-h-full max-w-full animate-scale-in" />
        )}
      </div>
    </div>
  );
}
