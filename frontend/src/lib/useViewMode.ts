import { useState } from 'react';

export type ViewMode = 'list' | 'grid';

const STORAGE_KEY = 'drive-clone-view';

export function useViewMode(): [ViewMode, (view: ViewMode) => void] {
  const [view, setViewState] = useState<ViewMode>(() => {
    return localStorage.getItem(STORAGE_KEY) === 'grid' ? 'grid' : 'list';
  });

  const setView = (next: ViewMode) => {
    localStorage.setItem(STORAGE_KEY, next);
    setViewState(next);
  };

  return [view, setView];
}
