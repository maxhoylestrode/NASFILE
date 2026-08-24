export interface AuthUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  rootFolderId: string;
}

export interface RefreshResponse {
  accessToken: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  isRoot: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type FileStatus = 'pending' | 'complete';

export interface DriveFile {
  id: string;
  name: string;
  folderId: string;
  mimeType: string | null;
  sizeBytes: number;
  status: FileStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface FolderContents {
  folder: Folder;
  subfolders: Folder[];
  files: DriveFile[];
}

export interface InitiateUploadResponse {
  fileId: string;
  uploadId: string;
  partSize: number;
  totalParts: number;
  parts: { partNumber: number; url: string }[];
  expiresInSeconds: number;
}

export interface ResumeUploadResponse {
  fileId: string;
  uploadId: string;
  partSize: number;
  totalParts: number;
  uploadedParts: { partNumber: number; eTag: string }[];
  missingParts: { partNumber: number; url: string }[];
  expiresInSeconds: number;
}

export interface DownloadUrlResponse {
  url: string;
  expiresInSeconds: number;
}

export interface CreateInviteResponse {
  id: string;
  token: string;
  email: string | null;
  expiresAt: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface StorageUsage {
  usedBytes: number;
}

export interface TrashContents {
  folders: Folder[];
  files: DriveFile[];
}

export interface ShareResource {
  id: string;
  resourceType: 'folder' | 'file';
  resourceId: string;
  sharedWithEmail: string;
  createdAt: string;
}

export interface UserShare {
  id: string;
  email: string;
  createdAt: string;
}

export interface ListSharesResponse {
  userShares: UserShare[];
  hasPublicLink: boolean;
}

export interface PublicLinkResponse {
  created: boolean;
  token: string | null;
  url: string | null;
}

export interface SharedWithMeFolder extends Folder {
  ownerEmail: string;
}

export interface SharedWithMeFile extends DriveFile {
  ownerEmail: string;
}

export interface SharedWithMeResponse {
  folders: SharedWithMeFolder[];
  files: SharedWithMeFile[];
}
