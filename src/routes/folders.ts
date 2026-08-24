import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { asyncHandler } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { uuidParamSchema, folderNameSchema } from '../lib/ids';
import { BadRequestError, ConflictError, ForbiddenError } from '../middleware/errors';
import {
  getOwnedFolder,
  getDescendantFolderIds,
  isSameOrAncestor,
  isUniqueViolation,
  serializeFolder,
  serializeFile,
  type FolderRow,
  type FileRow,
} from '../lib/dbHelpers';
import { deleteObject, abortMultipartUpload } from '../storage';

export const foldersRouter = Router();
foldersRouter.use(requireAuth);

// GET /folders/:id — list a folder's direct subfolders and files.
foldersRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof uuidParamSchema>;
    const folder = await getOwnedFolder(pool, id, req.user!.id);

    const [subfolders, files] = await Promise.all([
      pool.query<FolderRow>(
        'SELECT * FROM folders WHERE parent_id = $1 AND owner_id = $2 AND deleted_at IS NULL ORDER BY name',
        [id, req.user!.id],
      ),
      pool.query<FileRow>(
        'SELECT * FROM files WHERE folder_id = $1 AND owner_id = $2 AND deleted_at IS NULL ORDER BY name',
        [id, req.user!.id],
      ),
    ]);

    res.status(200).json({
      folder: serializeFolder(folder),
      subfolders: subfolders.rows.map(serializeFolder),
      files: files.rows.map(serializeFile),
    });
  }),
);

// POST /folders — create a new folder under an explicit parent.
const createFolderSchema = z.object({
  name: folderNameSchema,
  parentId: z.string().uuid('parentId must be a valid UUID'),
});

foldersRouter.post(
  '/',
  validate(createFolderSchema),
  asyncHandler(async (req, res) => {
    const { name, parentId } = req.body as z.infer<typeof createFolderSchema>;

    // Confirms the parent exists and belongs to this user before insert,
    // so a bad parentId reports 404 rather than an opaque FK violation.
    await getOwnedFolder(pool, parentId, req.user!.id);

    try {
      const { rows } = await pool.query<FolderRow>(
        `INSERT INTO folders (owner_id, parent_id, name, is_root)
         VALUES ($1, $2, $3, false)
         RETURNING *`,
        [req.user!.id, parentId, name],
      );
      res.status(201).json(serializeFolder(rows[0]!));
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('A folder with this name already exists here');
      }
      throw err;
    }
  }),
);

// PATCH /folders/:id — rename and/or move.
const patchFolderSchema = z
  .object({
    name: folderNameSchema.optional(),
    parentId: z.string().uuid('parentId must be a valid UUID').optional(),
  })
  .refine((body) => body.name !== undefined || body.parentId !== undefined, {
    message: 'At least one of name or parentId must be provided',
  });

foldersRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(patchFolderSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof uuidParamSchema>;
    const { name, parentId } = req.body as z.infer<typeof patchFolderSchema>;

    const folder = await getOwnedFolder(pool, id, req.user!.id);
    if (folder.is_root) {
      throw new ForbiddenError('The root folder cannot be renamed or moved');
    }

    let newParentId = folder.parent_id;
    if (parentId !== undefined) {
      if (parentId === id) {
        throw new BadRequestError('A folder cannot be moved into itself');
      }
      await getOwnedFolder(pool, parentId, req.user!.id); // 404s if missing/not-owned
      if (await isSameOrAncestor(pool, id, parentId)) {
        throw new BadRequestError('Cannot move a folder into its own subtree');
      }
      newParentId = parentId;
    }
    const newName = name ?? folder.name;

    try {
      const { rows } = await pool.query<FolderRow>(
        `UPDATE folders SET name = $1, parent_id = $2, updated_at = now()
         WHERE id = $3
         RETURNING *`,
        [newName, newParentId, id],
      );
      res.status(200).json(serializeFolder(rows[0]!));
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('A folder with this name already exists in the destination');
      }
      throw err;
    }
  }),
);

// DELETE /folders/:id — first call moves the folder (and everything
// inside it, any depth) to the Bin. Calling DELETE again on an
// already-trashed folder is what actually removes it and its files'
// MinIO objects for good, matching how the frontend surfaces this as
// "Delete" vs "Delete forever". Nothing live can exist underneath an
// already-trashed folder (moving/uploading into a trashed folder 404s,
// same as any other trashed target), so a permanent delete is always
// safe to sweep the whole subtree regardless of individual timestamps.
foldersRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof uuidParamSchema>;
    const folder = await getOwnedFolder(pool, id, req.user!.id, { includeTrashed: true });
    if (folder.is_root) {
      throw new ForbiddenError('The root folder cannot be deleted');
    }

    const descendantIds = await getDescendantFolderIds(pool, id);

    if (!folder.deleted_at) {
      // First delete: soft-delete the whole subtree in one transaction so
      // every row touched gets the exact same timestamp (Postgres's now()
      // is stable within a transaction) — that shared timestamp is what
      // lets restore() bring back only this batch, not anything that was
      // independently trashed earlier and happens to live underneath.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE folders SET deleted_at = now() WHERE id = ANY($1) AND deleted_at IS NULL`, [descendantIds]);
        await client.query(`UPDATE files SET deleted_at = now() WHERE folder_id = ANY($1) AND deleted_at IS NULL`, [descendantIds]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      res.status(204).send();
      return;
    }

    // Second delete: permanent. Clean up real MinIO objects for every
    // file in the subtree before the row-level cascade removes them.
    const { rows: files } = await pool.query<{ status: string; storage_key: string | null; upload_id: string | null }>(
      'SELECT status, storage_key, upload_id FROM files WHERE folder_id = ANY($1)',
      [descendantIds],
    );
    for (const file of files) {
      if (file.status === 'complete' && file.storage_key) {
        await deleteObject(file.storage_key);
      } else if (file.status === 'pending' && file.storage_key && file.upload_id) {
        await abortMultipartUpload(file.storage_key, file.upload_id).catch((err) => {
          if (!(err instanceof Error) || !/NoSuchUpload/i.test(err.message)) throw err;
        });
      }
    }

    await pool.query('DELETE FROM folders WHERE id = $1', [id]);
    res.status(204).send();
  }),
);

// POST /folders/:id/restore — undoes a soft-delete for this folder and
// everything that was trashed alongside it in the same batch (same
// cascade timestamp). The immediate parent must not itself be trashed —
// restore that first. Renaming on restore isn't attempted automatically;
// a name collision with something created after the trash surfaces as a
// normal 409, same as any other rename/move conflict.
foldersRouter.post(
  '/:id/restore',
  validate(uuidParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof uuidParamSchema>;
    const folder = await getOwnedFolder(pool, id, req.user!.id, { includeTrashed: true });
    if (!folder.deleted_at) {
      throw new BadRequestError('This folder is not in the Bin');
    }
    if (folder.parent_id) {
      const parent = await getOwnedFolder(pool, folder.parent_id, req.user!.id, { includeTrashed: true });
      if (parent.deleted_at) {
        throw new ConflictError('The containing folder is also in the Bin — restore that first');
      }
    }

    const descendantIds = await getDescendantFolderIds(pool, id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Compare against the DB's own stored deleted_at via a subquery
      // rather than the JS Date we already read back — TIMESTAMPTZ has
      // microsecond precision, JS Date only has millisecond, so an
      // equality check against a round-tripped-through-JS value silently
      // matches zero rows instead of erroring, which is worse than a
      // crash: it looks like success but restores nothing.
      // Files first, folders second — the files UPDATE's subquery reads
      // this folder's *current* deleted_at, so it has to run before the
      // folders UPDATE below overwrites that same row to NULL. Getting
      // this order backwards means the subquery sees NULL by the time it
      // runs, "deleted_at = NULL" never matches anything in SQL, and the
      // files UPDATE silently touches zero rows.
      await client.query(
        `UPDATE files SET deleted_at = NULL
         WHERE folder_id = ANY($1) AND deleted_at = (SELECT deleted_at FROM folders WHERE id = $2)`,
        [descendantIds, id],
      );
      const { rows } = await client.query<FolderRow>(
        `UPDATE folders SET deleted_at = NULL
         WHERE id = ANY($1) AND deleted_at = (SELECT deleted_at FROM folders WHERE id = $2)
         RETURNING *`,
        [descendantIds, id],
      );
      await client.query('COMMIT');
      const restored = rows.find((r) => r.id === id);
      if (!restored) {
        // Genuinely shouldn't happen — we just confirmed this folder is
        // trashed and owned by this user above. Fail loudly rather than
        // silently returning something wrong if it ever does.
        throw new Error('Restore updated no rows despite folder being trashed');
      }
      res.status(200).json(serializeFolder(restored));
    } catch (err) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(err)) {
        throw new ConflictError('A folder with this name already exists in the destination — rename it first');
      }
      throw err;
    } finally {
      client.release();
    }
  }),
);

// GET /folders/trash/all — everything currently in the Bin: trashed
// folders and files whose containing folder isn't itself trashed, i.e.
// just the "roots" of each trashed subtree, matching how Drive's own
// trash view only shows one row per thing you actually deleted rather
// than every descendant separately.
foldersRouter.get(
  '/trash/all',
  asyncHandler(async (req, res) => {
    const [folders, files] = await Promise.all([
      pool.query<FolderRow>(
        `SELECT f.* FROM folders f
         LEFT JOIN folders p ON f.parent_id = p.id
         WHERE f.owner_id = $1 AND f.deleted_at IS NOT NULL AND (p.id IS NULL OR p.deleted_at IS NULL)
         ORDER BY f.deleted_at DESC`,
        [req.user!.id],
      ),
      pool.query<FileRow>(
        `SELECT fi.* FROM files fi
         JOIN folders p ON fi.folder_id = p.id
         WHERE fi.owner_id = $1 AND fi.deleted_at IS NOT NULL AND p.deleted_at IS NULL
         ORDER BY fi.deleted_at DESC`,
        [req.user!.id],
      ),
    ]);
    res.status(200).json({
      folders: folders.rows.map(serializeFolder),
      files: files.rows.map(serializeFile),
    });
  }),
);
