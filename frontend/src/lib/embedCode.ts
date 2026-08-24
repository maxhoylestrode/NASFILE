/**
 * Best-effort embeddable HTML for a public share link, based on file
 * extension. Only image, PDF, video, and audio have a native browser
 * renderer that works inside a plain <img>/<iframe>/<video>/<audio> tag
 * — Word/Excel/PowerPoint and everything else don't, so those fall back
 * to a plain link. This mirrors exactly what was explained in-app: the
 * link always works for a direct click, only some types actually embed.
 */
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v'];
const AUDIO_EXT = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'];

export function buildEmbedCode(url: string, filename: string): { code: string; embeddable: boolean } {
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';

  if (IMAGE_EXT.includes(ext)) {
    return { code: `<img src="${url}" alt="${escapeAttr(filename)}" style="max-width:100%">`, embeddable: true };
  }
  if (ext === 'pdf') {
    return {
      code: `<iframe src="${url}" style="width:100%;height:600px;border:none" title="${escapeAttr(filename)}"></iframe>`,
      embeddable: true,
    };
  }
  if (VIDEO_EXT.includes(ext)) {
    return { code: `<video src="${url}" controls style="max-width:100%"></video>`, embeddable: true };
  }
  if (AUDIO_EXT.includes(ext)) {
    return { code: `<audio src="${url}" controls></audio>`, embeddable: true };
  }
  return { code: `<a href="${url}">${escapeAttr(filename)}</a>`, embeddable: false };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
