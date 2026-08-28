import { useEffect, useState } from 'react';
import { X, Download, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { DriveFile } from '../api/types';
import type { PreviewKind } from '../lib/mediaType';

export interface PreviewItem {
  file: DriveFile;
  kind: PreviewKind;
}

interface PreviewModalProps {
  items: PreviewItem[];
  startIndex: number;
  onClose: () => void;
}

/**
 * A full-screen lightbox for photos/videos, with arrow navigation
 * through every other previewable file in the same list (folder view)
 * — moving past an image onto a video (or back) just swaps which player
 * renders, same URL-fetch flow either way. Reuses the same presigned
 * download URL as an actual download; Content-Disposition: attachment
 * on that URL only affects top-level navigation, not an <img>/<video>
 * tag loading it as a subresource, so no backend change was needed for
 * this to render.
 */
export function PreviewModal({ items, startIndex, onClose }: PreviewModalProps) {
  const [index, setIndex] = useState(startIndex);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = items[index];

  const goPrev = () => setIndex((i) => (i - 1 + items.length) % items.length);
  const goNext = () => setIndex((i) => (i + 1) % items.length);

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setUrl(null);
    setError(null);
    api
      .getDownloadUrl(current.file.id)
      .then((res) => {
        if (!cancelled) setUrl(res.url);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load preview');
      });
    return () => {
      cancelled = true;
    };
  }, [current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && items.length > 1) goPrev();
      else if (e.key === 'ArrowRight' && items.length > 1) goNext();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, items.length]);

  if (!current) return null;
  const { file, kind } = current;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in flex-col bg-black/90"
      onClick={onClose}
      role="presentation"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 truncate text-sm text-white/90">
          {file.name}
          {items.length > 1 && (
            <span className="ml-2 text-xs text-white/50">
              {index + 1} / {items.length}
            </span>
          )}
        </span>
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
        className="relative flex flex-1 items-center justify-center overflow-hidden px-4 pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        {items.length > 1 && (
          <button
            title="Previous"
            onClick={goPrev}
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/80 transition-colors duration-150 hover:bg-black/60 hover:text-white sm:left-4"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        {!url && !error && <Loader2 className="h-8 w-8 animate-spin text-white/60" />}
        {error && <p className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        {url && kind === 'image' && (
          <img
            key={file.id}
            src={url}
            alt={file.name}
            className="max-h-full max-w-full animate-scale-in object-contain"
          />
        )}
        {url && kind === 'video' && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video key={file.id} src={url} controls autoPlay className="max-h-full max-w-full animate-scale-in" />
        )}

        {items.length > 1 && (
          <button
            title="Next"
            onClick={goNext}
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/80 transition-colors duration-150 hover:bg-black/60 hover:text-white sm:right-4"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </div>
  );
}
