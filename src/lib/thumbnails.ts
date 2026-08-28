import { spawn } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import sharp from 'sharp';

const THUMBNAIL_MAX_DIMENSION = 480;
const THUMBNAIL_JPEG_QUALITY = 78;

/** Downscales an image to a small JPEG thumbnail. Runs entirely in-process (sharp/libvips). */
export async function generateImageThumbnail(source: Buffer): Promise<Buffer> {
  return sharp(source)
    .rotate() // respect EXIF orientation before resizing, so sideways phone photos come out upright
    .resize(THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMBNAIL_JPEG_QUALITY })
    .toBuffer();
}

/**
 * Extracts a frame from a video and returns it as a small JPEG thumbnail,
 * via a real ffmpeg subprocess — deliberately not a browser-side frame
 * grab, since ffmpeg reliably decodes codecs (e.g. iPhone HEVC .mov)
 * that not every browser/OS combination can. The source has to be a
 * real local file (ffmpeg needs seekable random access for -ss), so the
 * caller downloads the object to a temp file first.
 *
 * Tries a 1-second offset first (skips a black opening frame on most
 * clips); falls back to the very first frame for anything shorter than
 * that.
 */
export async function generateVideoThumbnail(sourcePath: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'drive-clone-thumb-'));
  const outPath = path.join(dir, 'out.jpg');
  try {
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

/** Writes a buffer to a fresh temp file and returns its path + a cleanup function. */
export async function withTempFile<T>(buffer: Buffer, ext: string, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'drive-clone-src-'));
  const filePath = path.join(dir, `source${ext}`);
  try {
    await writeFile(filePath, buffer);
    return await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
