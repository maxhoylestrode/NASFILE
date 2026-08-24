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
  isSameOrAncestor,
  isUniqueViolation,
  serializeFolder,
  serializeFile,
  type FolderRow,
  type FileRow,
} from '../lib/dbHelpers';

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
      pool.query<FolderRow>('SELECT * FROM folders WHERE parent_id = $1 AND owner_id = $2 ORDER BY name', [id, req.user!.id]),
      pool.query<FileRow>('SELECT * FROM files WHERE folder_id = $1 AND owner_id = $2 ORDER BY name', [id, req.user!.id]),
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

// DELETE /folders/:id — hard delete, cascades to descendant folders and files.
foldersRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof uuidParamSchema>;
    const folder = await getOwnedFolder(pool, id, req.user!.id);
    if (folder.is_root) {
      throw new ForbiddenError('The root folder cannot be deleted');
    }

    await pool.query('DELETE FROM folders WHERE id = $1', [id]);
    res.status(204).send();
  }),
);
