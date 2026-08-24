import type { AuthUser } from './types';

// Plain localStorage, outside React state, so the fetch wrapper (api/client.ts)
// can read/write tokens without needing a hook or context — it has to work
// from a plain async function, including during a background token refresh
// triggered by a 401.

const ACCESS_KEY = 'drive-clone.accessToken';
const REFRESH_KEY = 'drive-clone.refreshToken';
const USER_KEY = 'drive-clone.user';
const ROOT_FOLDER_KEY = 'drive-clone.rootFolderId';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  rootFolderId: string;
}

export function saveSession(session: StoredSession): void {
  localStorage.setItem(ACCESS_KEY, session.accessToken);
  localStorage.setItem(REFRESH_KEY, session.refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
  localStorage.setItem(ROOT_FOLDER_KEY, session.rootFolderId);
}

export function saveAccessToken(accessToken: string): void {
  localStorage.setItem(ACCESS_KEY, accessToken);
}

export function clearSession(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ROOT_FOLDER_KEY);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function getStoredRootFolderId(): string | null {
  return localStorage.getItem(ROOT_FOLDER_KEY);
}
