import type {
  ApiErrorBody,
  CreateInviteResponse,
  DownloadUrlResponse,
  DriveFile,
  Folder,
  FolderContents,
  InitiateUploadResponse,
  LoginResponse,
  RefreshResponse,
  ResumeUploadResponse,
  StorageUsage,
} from './types';
import { clearSession, getAccessToken, getRefreshToken, saveAccessToken } from './tokenStore';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Set by AuthProvider so the client can react to a session that's
// unrecoverable (refresh token itself expired/invalid) without a
// circular import between client.ts and the auth context.
let onSessionExpired: (() => void) | null = null;
export function setOnSessionExpired(handler: () => void): void {
  onSessionExpired = handler;
}

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  // Coalesce concurrent 401s into a single refresh call.
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) throw new ApiError(401, 'NO_REFRESH_TOKEN', 'No refresh token available');

    const res = await fetch('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) throw new ApiError(res.status, 'REFRESH_FAILED', 'Session expired');

    const data = (await res.json()) as RefreshResponse;
    saveAccessToken(data.accessToken);
    return data.accessToken;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean; // defaults to true
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;

  const doFetch = async (token: string | null): Promise<Response> =>
    fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await doFetch(auth ? getAccessToken() : null);

  if (auth && res.status === 401) {
    try {
      const newToken = await refreshAccessToken();
      res = await doFetch(newToken);
    } catch {
      clearSession();
      onSessionExpired?.();
      throw new ApiError(401, 'SESSION_EXPIRED', 'Your session expired — please log in again');
    }
  }

  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // non-JSON error body, fall through
    }
    throw new ApiError(res.status, body?.error.code ?? 'UNKNOWN', body?.error.message ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponse>('/auth/login', { method: 'POST', body: { email, password }, auth: false }),

  acceptInvite: (token: string, email: string, password: string) =>
    request<LoginResponse>('/invites/accept', { method: 'POST', body: { token, email, password }, auth: false }),

  createInvite: (email?: string) =>
    request<CreateInviteResponse>('/invites', { method: 'POST', body: email ? { email } : {} }),

  getFolder: (id: string) => request<FolderContents>(`/folders/${id}`),

  createFolder: (name: string, parentId: string) =>
    request<Folder>('/folders', { method: 'POST', body: { name, parentId } }),

  renameFolder: (id: string, name: string) => request<Folder>(`/folders/${id}`, { method: 'PATCH', body: { name } }),

  moveFolder: (id: string, parentId: string) =>
    request<Folder>(`/folders/${id}`, { method: 'PATCH', body: { parentId } }),

  deleteFolder: (id: string) => request<void>(`/folders/${id}`, { method: 'DELETE' }),

  renameFile: (id: string, name: string) => request<DriveFile>(`/files/${id}`, { method: 'PATCH', body: { name } }),

  moveFile: (id: string, folderId: string) =>
    request<DriveFile>(`/files/${id}`, { method: 'PATCH', body: { folderId } }),

  deleteFile: (id: string) => request<void>(`/files/${id}`, { method: 'DELETE' }),

  initiateUpload: (folderId: string, name: string, sizeBytes: number, mimeType: string) =>
    request<InitiateUploadResponse>('/files/uploads', {
      method: 'POST',
      body: { folderId, name, sizeBytes, mimeType },
    }),

  resumeUpload: (fileId: string) => request<ResumeUploadResponse>(`/files/uploads/${fileId}`),

  completeUpload: (fileId: string, parts: { partNumber: number; eTag: string }[]) =>
    request<DriveFile>(`/files/uploads/${fileId}/complete`, { method: 'POST', body: { parts } }),

  getDownloadUrl: (fileId: string) => request<DownloadUrlResponse>(`/files/${fileId}/download`),

  getStorageUsage: () => request<StorageUsage>('/files/storage'),
};
