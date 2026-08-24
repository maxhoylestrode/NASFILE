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

export interface ShareRow {
  id: string;
  owner_id: string;
  folder_id: string | null;
  file_id: string | null;
  share_type: 'user' | 'public';
  shared_with_user_id: string | null;
  token_hash: string | null;
  created_at: Date;
}

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

/**
 * True if userId has read access to folderId via a 'user' share on that
 * exact folder or any ancestor of it (inclusive) — sharing a folder
 * grants browsing access into everything nested inside it. Does not
 * check ownership; callers combine this with an owner check.
 */
export async function hasSharedFolderAccess(client: Queryable, folderId: string, userId: string): Promise<boolean> {
  const { rows } = await client.query<{ hit: boolean }>(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_id FROM folders WHERE id = $1
       UNION ALL
       SELECT f.id, f.parent_id FROM folders f JOIN chain c ON f.id = c.parent_id
     )
     SELECT EXISTS (
       SELECT 1 FROM shares s
       WHERE s.share_type = 'user' AND s.shared_with_user_id = $2 AND s.folder_id IN (SELECT id FROM chain)
     ) AS hit`,
    [folderId, userId],
  );
  return rows[0]?.hit ?? false;
}

/**
 * True if userId has read access to this file: a direct share on the
 * file itself, or a share on the file's folder or any ancestor of it.
 */
export async function hasSharedFileAccess(client: Queryable, file: FileRow, userId: string): Promise<boolean> {
  const direct = await client.query<{ hit: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM shares WHERE share_type = 'user' AND file_id = $1 AND shared_with_user_id = $2
     ) AS hit`,
    [file.id, userId],
  );
  if (direct.rows[0]?.hit) return true;
  return hasSharedFolderAccess(client, file.folder_id, userId);
}

/**
 * Read-path lookup for browsing: owner OR valid share (direct or
 * inherited). Trashed folders are always excluded — since trashing
 * cascades through a whole subtree unconditionally, a live (non-trashed)
 * folder can never have a trashed ancestor, so checking only this
 * folder's own deleted_at is sufficient; the share-chain walk above
 * doesn't need to re-check trash state at every level.
 *
 * Deliberately separate from getOwnedFolder rather than folding sharing
 * into it — every write path (rename/move/delete/create-inside/
 * upload-into) should stay strictly owner-only. Sharing is view/download
 * access only; use this helper only for the two read paths that need it
 * (GET /folders/:id, GET /files/:id/download).
 */
export async function getAccessibleFolder(client: Queryable, id: string, userId: string): Promise<FolderRow> {
  const { rows } = await client.query<FolderRow>('SELECT * FROM folders WHERE id = $1 AND deleted_at IS NULL', [id]);
  const folder = rows[0];
  if (!folder) throw new NotFoundError('Folder not found');
  if (folder.owner_id === userId) return folder;
  if (await hasSharedFolderAccess(client, id, userId)) return folder;
  throw new NotFoundError('Folder not found');
}

/** Read-path lookup for download: owner OR valid share. See getAccessibleFolder. */
export async function getAccessibleFile(client: Queryable, id: string, userId: string): Promise<FileRow> {
  const { rows } = await client.query<FileRow>('SELECT * FROM files WHERE id = $1 AND deleted_at IS NULL', [id]);
  const file = rows[0];
  if (!file) throw new NotFoundError('File not found');
  if (file.owner_id === userId) return file;
  if (await hasSharedFileAccess(client, file, userId)) return file;
  throw new NotFoundError('File not found');
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
