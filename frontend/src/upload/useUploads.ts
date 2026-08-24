import { useSyncExternalStore } from 'react';
import { subscribe, getSnapshot, type UploadRecord } from './uploadStore';

export function useUploads(): UploadRecord[] {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  return Object.values(snapshot);
}
