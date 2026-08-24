// Minimal external store for in-progress uploads, consumed via
// useSyncExternalStore. Kept outside React so upload progress (driven by
// XHR events, not React events) can update state without needing the
// upload manager itself to be a component/hook.

export type UploadStatus = 'uploading' | 'completing' | 'done' | 'error' | 'incomplete';

export interface UploadRecord {
  key: string; // fingerprint: name::size::lastModified, scoped to a folder
  fileId: string;
  uploadId: string;
  folderId: string;
  name: string;
  sizeBytes: number;
  partSize: number;
  totalParts: number;
  completedParts: Record<number, string>; // partNumber -> ETag
  bytesUploaded: number;
  status: UploadStatus;
  error?: string;
}

const STORAGE_KEY = 'drive-clone.uploads';
let records: Record<string, UploadRecord> = loadFromStorage();
const listeners = new Set<() => void>();

function loadFromStorage(): Record<string, UploadRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, UploadRecord>;
  } catch {
    return {};
  }
}

function persist(): void {
  // Only persist records that represent real resumable state (skip
  // transient in-memory-only bookkeeping isn't needed here since
  // everything in `records` is meant to survive a reload until done/
  // discarded).
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function notify(): void {
  persist();
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): Record<string, UploadRecord> {
  return records;
}

export function upsert(record: UploadRecord): void {
  records = { ...records, [record.key]: record };
  notify();
}

export function patch(key: string, patch: Partial<UploadRecord>): void {
  const existing = records[key];
  if (!existing) return;
  records = { ...records, [key]: { ...existing, ...patch } };
  notify();
}

export function remove(key: string): void {
  const next = { ...records };
  delete next[key];
  records = next;
  notify();
}

export function fingerprint(file: File, folderId: string): string {
  return `${folderId}::${file.name}::${file.size}::${file.lastModified}`;
}
