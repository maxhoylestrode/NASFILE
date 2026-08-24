import type { Pool, PoolClient } from 'pg';
import { NotFoundError } from '../middleware/errors';

export interface FolderRow {
  id: string;
  owner_id: string;
  parent_id: string | null;
  name: string;
  is_root: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface FileRow {
  id: string;
  owner_id: string;
  folder_id: string;
  name: string;
  mime_type: string | null;
  size_bytes: string; // BIGINT comes back as string from pg
  storage_key: string | null;
  status: 'pending' | 'complete';
  upload_id: string | null;
  part_size_bytes: string | null;
  created_at: Date;
  updated_at: Date;
}

type Queryable = Pick<Pool | PoolClient, 'query'>;

/** Fetches a folder by id, scoped to the requesting user. 404s (never 403) on mismatch. */
export async function getOwnedFolder(client: Queryable, id: string, ownerId: string): Promise<FolderRow> {
  const { rows } = await client.query<FolderRow>('SELECT * FROM folders WHERE id = $1 AND owner_id = $2', [id, ownerId]);
  const folder = rows[0];
  if (!folder) {
    throw new NotFoundError('Folder not found');
  }
  return folder;
}

/** Fetches a file by id, scoped to the requesting user. 404s (never 403) on mismatch. */
export async function getOwnedFile(client: Queryable, id: string, ownerId: string): Promise<FileRow> {
  const { rows } = await client.query<FileRow>('SELECT * FROM files WHERE id = $1 AND owner_id = $2', [id, ownerId]);
  const file = rows[0];
  if (!file) {
    throw new NotFoundError('File not found');
  }
  return file;
}

/**
 * Returns true if `candidateAncestorId` is `folderId` itself or one of its
 * ancestors, walking up via parent_id. Used to block moves that would
 * create a cycle (e.g. moving a folder into its own descendant).
 */
export async function isSameOrAncestor(client: Queryable, folderId: string, candidateAncestorId: string): Promise<boolean> {
  const { rows } = await client.query<{ hit: boolean }>(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_id FROM folders WHERE id = $1
       UNION ALL
       SELECT f.id, f.parent_id FROM folders f
       JOIN chain c ON f.id = c.parent_id
     )
     SELECT EXISTS (SELECT 1 FROM chain WHERE id = $2) AS hit`,
    [candidateAncestorId, folderId],
  );
  return rows[0]?.hit ?? false;
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505';
}

export function serializeFolder(f: FolderRow) {
  return {
    id: f.id,
    name: f.name,
    parentId: f.parent_id,
    isRoot: f.is_root,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  };
}

export function serializeFile(f: FileRow) {
  return {
    id: f.id,
    name: f.name,
    folderId: f.folder_id,
    mimeType: f.mime_type,
    sizeBytes: Number(f.size_bytes),
    status: f.status,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
    // storage_key and upload_id are internal MinIO bookkeeping — never
    // serialized to clients.
  };
}
