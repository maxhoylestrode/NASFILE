/**
 * Shared extension lists for "does this file have a native browser
 * renderer" — used both by embed-code generation (ShareModal) and the
 * in-app preview modal. Single source of truth so the two never drift.
 */
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];
export const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v'];
export const AUDIO_EXT = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'];

export function extOf(filename: string): string {
  return filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
}

export type PreviewKind = 'image' | 'video';

/** Photos and videos get an in-app preview player; everything else just downloads. */
export function getPreviewKind(filename: string): PreviewKind | null {
  const ext = extOf(filename);
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return null;
}
