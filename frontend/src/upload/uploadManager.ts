import { api, ApiError } from '../api/client';
import { fingerprint, patch, remove, upsert, getSnapshot, type UploadRecord } from './uploadStore';

const MAX_CONCURRENT_PARTS = 3;
const MAX_RETRIES_PER_PART = 3;

/** Uploads one part via XHR (not fetch) so we get real upload progress events. */
function uploadPart(url: string, blob: Blob, onProgress: (loaded: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag');
        if (!etag) {
          reject(new Error('Upload succeeded but no ETag header was returned (check MinIO CORS ExposeHeaders)'));
          return;
        }
        resolve(etag);
      } else {
        reject(new Error(`Part upload failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during part upload'));
    xhr.send(blob);
  });
}

async function uploadPartWithRetry(url: string, blob: Blob, onProgress: (loaded: number) => void): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES_PER_PART; attempt++) {
    try {
      return await uploadPart(url, blob, onProgress);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES_PER_PART) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Part upload failed');
}

/** Runs async jobs with bounded concurrency, stopping (but not throwing until all in-flight settle) on first failure. */
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  let firstError: unknown;
  async function next(): Promise<void> {
    while (index < items.length) {
      const item = items[index++];
      try {
        await worker(item);
      } catch (err) {
        firstError = firstError ?? err;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  if (firstError) throw firstError;
}

export interface StartUploadOptions {
  file: File;
  folderId: string;
  onProgress?: (record: UploadRecord) => void;
}

/** Slices out the byte range for a given (1-indexed) part number. */
function slicePart(file: File, partNumber: number, partSize: number): Blob {
  const start = (partNumber - 1) * partSize;
  const end = Math.min(start + partSize, file.size);
  return file.slice(start, end);
}

function currentBytesUploaded(record: UploadRecord, file: File, partSize: number): number {
  let total = 0;
  for (const partNumberStr of Object.keys(record.completedParts)) {
    total += slicePart(file, Number(partNumberStr), partSize).size;
  }
  return total;
}

/**
 * Starts (or continues, if a resumable record already exists for this
 * exact file+folder) a multipart upload. The caller must have the real
 * File object — after a reload, resuming requires the user to re-select
 * the same file so we have bytes to upload; what we skip on resume is
 * re-uploading parts MinIO already has, discovered via GET
 * /files/uploads/:id (ListParts), not anything trusted from localStorage
 * alone.
 */
export async function startUpload({ file, folderId, onProgress }: StartUploadOptions): Promise<void> {
  const key = fingerprint(file, folderId);
  const existing = getSnapshot()[key];

  let record: UploadRecord;

  if (existing && (existing.status === 'incomplete' || existing.status === 'error')) {
    // Resume: ask the server what's actually missing rather than trusting
    // our local completedParts, in case they've gone stale (expired
    // presigned URLs, a previous run failed partway through recording).
    const resume = await api.resumeUpload(existing.fileId);
    const completedParts: Record<number, string> = {};
    for (const p of resume.uploadedParts) completedParts[p.partNumber] = p.eTag;

    record = {
      ...existing,
      uploadId: resume.uploadId,
      partSize: resume.partSize,
      totalParts: resume.totalParts,
      completedParts,
      status: 'uploading',
      error: undefined,
    };
    record.bytesUploaded = currentBytesUploaded(record, file, record.partSize);
    upsert(record);

    await uploadMissingParts(record, file, resume.missingParts, onProgress);
  } else {
    const init = await api.initiateUpload(folderId, file.name, file.size, file.type || 'application/octet-stream');
    record = {
      key,
      fileId: init.fileId,
      uploadId: init.uploadId,
      folderId,
      name: file.name,
      sizeBytes: file.size,
      partSize: init.partSize,
      totalParts: init.totalParts,
      completedParts: {},
      bytesUploaded: 0,
      status: 'uploading',
    };
    upsert(record);

    await uploadMissingParts(record, file, init.parts, onProgress);
  }
}

async function uploadMissingParts(
  record: UploadRecord,
  file: File,
  parts: { partNumber: number; url: string }[],
  onProgress?: (record: UploadRecord) => void,
): Promise<void> {
  const partProgress = new Map<number, number>();

  const reportProgress = () => {
    const inFlightBytes = Array.from(partProgress.values()).reduce((a, b) => a + b, 0);
    const completedBytes = currentBytesUploaded(record, file, record.partSize);
    const latest = getSnapshot()[record.key];
    if (latest) {
      const updated = { ...latest, bytesUploaded: completedBytes + inFlightBytes };
      onProgress?.(updated);
    }
  };

  try {
    await runWithConcurrency(parts, MAX_CONCURRENT_PARTS, async (part) => {
      const blob = slicePart(file, part.partNumber, record.partSize);
      const etag = await uploadPartWithRetry(part.url, blob, (loaded) => {
        partProgress.set(part.partNumber, loaded);
        reportProgress();
      });
      partProgress.delete(part.partNumber);

      const latest = getSnapshot()[record.key];
      const completedParts = { ...(latest?.completedParts ?? record.completedParts), [part.partNumber]: etag };
      patch(record.key, { completedParts, bytesUploaded: currentBytesUploaded({ ...record, completedParts }, file, record.partSize) });
    });
  } catch (err) {
    patch(record.key, { status: 'incomplete', error: err instanceof Error ? err.message : 'Upload failed' });
    throw err;
  }

  const finalRecord = getSnapshot()[record.key];
  if (!finalRecord) return;

  patch(record.key, { status: 'completing' });
  try {
    const partsList = Object.entries(finalRecord.completedParts).map(([partNumber, eTag]) => ({
      partNumber: Number(partNumber),
      eTag,
    }));
    await api.completeUpload(record.fileId, partsList);
    patch(record.key, { status: 'done' });
    // Briefly show the "done" state (checkmark) instead of the row just
    // vanishing the instant it finishes — then clean it out of the store.
    setTimeout(() => remove(record.key), 2500);
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Failed to finalize upload';
    patch(record.key, { status: 'error', error: message });
    throw err;
  }
}

export async function discardUpload(record: UploadRecord): Promise<void> {
  // Aborts server-side (frees the parts sitting in MinIO) and forgets it
  // locally. Safe to call even if the upload already finished or was
  // never really started server-side, per DELETE /files/:id semantics.
  try {
    await api.deleteFile(record.fileId);
  } catch {
    // best-effort — still forget it locally either way
  }
  remove(record.key);
}

export function markIncompleteOnLoad(): void {
  // Any record still 'uploading'/'completing' at the time the page was
  // last closed didn't finish — mark it 'incomplete' so the UI offers
  // resume rather than silently sitting there looking active forever.
  const snapshot = getSnapshot();
  for (const record of Object.values(snapshot)) {
    if (record.status === 'uploading' || record.status === 'completing') {
      patch(record.key, { status: 'incomplete' });
    }
  }
}
