import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { getFileIcon } from '../lib/fileIcons';
import { getPreviewKind } from '../lib/mediaType';
import type { DriveFile } from '../api/types';

interface FileThumbnailProps {
  file: DriveFile;
  /** 'lg' = grid card box, 'sm' = list-row icon slot. */
  size: 'sm' | 'lg';
}

/**
 * Renders a real server-generated thumbnail for images/videos once one
 * is ready, falling back to the plain file-type icon otherwise — while
 * it's still loading, for non-image/video files, or if generation ever
 * failed server-side. One request per mount; the backend does the actual
 * caching (GET /files/:id/thumbnail-url only generates once per file,
 * ever — every request after the first just re-presigns the same
 * already-generated object).
 */
export function FileThumbnail({ file, size }: FileThumbnailProps) {
  const [url, setUrl] = useState<string | null>(null);
  const kind = getPreviewKind(file.name);

  useEffect(() => {
    if (!kind || file.status !== 'complete') return;
    let cancelled = false;
    api
      .getThumbnailUrl(file.id)
      .then((res) => {
        if (!cancelled && res.status === 'ready' && res.url) setUrl(res.url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [file.id, file.status, kind]);

  const { icon: Icon, color } = getFileIcon(file.name);

  if (size === 'lg') {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 transition-colors duration-150 dark:bg-slate-700">
        {url ? (
          <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <Icon className={`h-8 w-8 ${color}`} />
        )}
      </div>
    );
  }

  return url ? (
    <img src={url} alt="" loading="lazy" className="h-5 w-5 shrink-0 rounded object-cover" />
  ) : (
    <Icon className={`h-5 w-5 shrink-0 ${color}`} />
  );
}
