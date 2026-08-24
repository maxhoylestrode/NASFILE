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
  deleted_at: Date | null;
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
  deleted_at: Date | null;
}

type Queryable = Pick<Pool | PoolClient, 'query'>;

/**
 * Fetches a folder by id, scoped to the requesting user. 404s (never 403)
 * on mismatch. Trashed folders are excluded by default — they're not
 * valid targets for browsing, rename, move, or as a move/upload
 * destination. Pass includeTrashed to reach a folder specifically to
 * restore or permanently delete it.
 */
export async function getOwnedFolder(
  client: Queryable,
  id: string,
  ownerId: string,
  opts: { includeTrashed?: boolean } = {},
): Promise<FolderRow> {
  const sql = opts.includeTrashed
    ? 'SELECT * FROM folders WHERE id = $1 AND owner_id = $2'
    : 'SELECT * FROM folders WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL';
  const { rows } = await client.query<FolderRow>(sql, [id, ownerId]);
  const folder = rows[0];
  if (!folder) {
    throw new NotFoundError('Folder not found');
  }
  return folder;
}

/**
 * Fetches a file by id, scoped to the requesting user. 404s (never 403)
 * on mismatch. Trashed files are excluded by default — see getOwnedFolder.
 */
export async function getOwnedFile(
  client: Queryable,
  id: string,
  ownerId: string,
  opts: { includeTrashed?: boolean } = {},
): Promise<FileRow> {
  const sql = opts.includeTrashed
    ? 'SELECT * FROM files WHERE id = $1 AND owner_id = $2'
    : 'SELECT * FROM files WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL';
  const { rows } = await client.query<FileRow>(sql, [id, ownerId]);
  const file = rows[0];
  if (!file) {
    throw new NotFoundError('File not found');
  }
  return file;
}

/**
 * Returns the ids of `folderId` and every descendant folder beneath it
 * (arbitrary depth), regardless of trashed state. Used for cascading
 * trash/restore/permanent-delete operations across a whole subtree.
 */
export async function getDescendantFolderIds(client: Queryable, folderId: string): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM folders WHERE id = $1
       UNION ALL
       SELECT f.id FROM folders f JOIN subtree s ON f.parent_id = s.id
     )
     SELECT id FROM subtree`,
    [folderId],
  );
  return rows.map((r) => r.id);
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
    deletedAt: f.deleted_at,
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
    deletedAt: f.deleted_at,
    // storage_key and upload_id are internal MinIO bookkeeping — never
    // serialized to clients.
  };
}
