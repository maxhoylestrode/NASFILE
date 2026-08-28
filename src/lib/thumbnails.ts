import { spawn } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import { tmpdir } from 'os';
import path from 'path';
import sharp from 'sharp';

const THUMBNAIL_MAX_DIMENSION = 480;
const THUMBNAIL_JPEG_QUALITY = 78;

/**
 * At most this many thumbnails generate at once, regardless of how many
 * requests come in — a folder full of unthumbnailed videos used to fire
 * one generation per visible file simultaneously, each buffering a full
 * video in memory, which is exactly what maxed out RAM on the NAS the
 * first time this ran against a real library. Everything past the limit
 * just waits its turn; nothing is dropped or fails, it's just throttled.
 */
const MAX_CONCURRENT_GENERATIONS = 2;
let active = 0;
const waiting: (() => void)[] = [];

export async function acquireThumbnailSlot(): Promise<() => void> {
  if (active >= MAX_CONCURRENT_GENERATIONS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active--;
    const next = waiting.shift();
    if (next) next();
  };
}

/**
 * Downscales an image to a small JPEG thumbnail. The source is streamed
 * straight into sharp/libvips (which decodes incrementally) rather than
 * buffered fully in the JS heap first — matters less for images than
 * video (they're much smaller) but keeps the same discipline throughout.
 */
export async function generateImageThumbnail(source: Readable): Promise<Buffer> {
  const transformer = sharp()
    .rotate() // respect EXIF orientation before resizing, so sideways phone photos come out upright
    .resize(THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMBNAIL_JPEG_QUALITY });
  source.pipe(transformer);
  return transformer.toBuffer();
}

/**
 * Extracts a frame from a video and returns it as a small JPEG thumbnail,
 * via a real ffmpeg subprocess — deliberately not a browser-side frame
 * grab, since ffmpeg reliably decodes codecs (e.g. iPhone HEVC .mov)
 * that not every browser/OS combination can.
 *
 * ffmpeg needs real seekable random access for -ss (can't pipe a video
 * into it and seek), so the source stream is written straight to a temp
 * file on disk via a piped stream — never buffered whole in memory, only
 * ever on disk at up to one file's size at a time, and only while a
 * concurrency slot (see acquireThumbnailSlot) is held.
 *
 * Tries a 1-second offset first (skips a black opening frame on most
 * clips); falls back to the very first frame for anything shorter than
 * that.
 */
export async function generateVideoThumbnail(source: Readable, ext: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'drive-clone-thumb-'));
  const sourcePath = path.join(dir, `source${ext}`);
  const outPath = path.join(dir, 'out.jpg');
  try {
    await pipeline(source, createWriteStream(sourcePath));
    try {
      await runFfmpegFrame(sourcePath, outPath, 1);
    } catch {
      await runFfmpegFrame(sourcePath, outPath, 0);
    }
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runFfmpegFrame(sourcePath: string, outPath: string, seekSeconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-ss', String(seekSeconds),
      '-i', sourcePath,
      '-frames:v', '1',
      '-vf', `scale='min(${THUMBNAIL_MAX_DIMENSION},iw)':-2`,
      '-q:v', '4',
      outPath,
    ];
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}
