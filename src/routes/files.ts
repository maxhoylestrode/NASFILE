import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { asyncHandler } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { uuidParamSchema, folderNameSchema } from '../lib/ids';
import { ConflictError } from '../middleware/errors';
import { getOwnedFile, getOwnedFolder, isUniqueViolation, serializeFile, type FileRow } from '../lib/dbHelpers';

export const filesRouter = Router();
filesRouter.use(requireAuth);

// PATCH /files/:id — rename and/or move to a different folder.
const patchFileSchema = z
  .object({
    name: folderNameSchema.optional(),
    folderId: z.string().uuid('folderId must be a valid UUID').optional(),
  })
  .refine((body) => body.name !== undefined || body.folderId !== undefined, {
    message: 'At least one of name or folderId must be provided',
  });

filesRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(patchFileSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof uuidParamSchema>;
    const { name, folderId } = req.body as z.infer<typeof patchFileSchema>;

    const file = await getOwnedFile(pool, id, req.user!.id);

    let newFolderId = file.folder_id;
    if (folderId !== undefined) {
      await getOwnedFolder(pool, folderId, req.user!.id); // 404s if missing/not-owned
      newFolderId = folderId;
    }
    const newName = name ?? file.name;

    try {
      const { rows } = await pool.query<FileRow>(
        `UPDATE files SET name = $1, folder_id = $2, updated_at = now()
         WHERE id = $3
         RETURNING *`,
        [newName, newFolderId, id],
      );
      res.status(200).json(serializeFile(rows[0]!));
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('A file with this name already exists in the destination folder');
      }
      throw err;
    }
  }),
);

// DELETE /files/:id — removes the metadata row. Object storage cleanup
// (deleting the underlying MinIO object by storage_key) lands in
// Session 3 once upload/download actually populate storage_key.
filesRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof uuidParamSchema>;
    await getOwnedFile(pool, id, req.user!.id);

    await pool.query('DELETE FROM files WHERE id = $1', [id]);
    res.status(204).send();
  }),
);
