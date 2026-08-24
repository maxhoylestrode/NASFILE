import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { pool } from '../db';
import { config } from '../config';
import { asyncHandler } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { uuidParamSchema, folderNameSchema } from '../lib/ids';
import { BadRequestError, ConflictError, HttpError, NotFoundError } from '../middleware/errors';
import { getOwnedFile, getOwnedFolder, isUniqueViolation, serializeFile, type FileRow } from '../lib/dbHelpers';
import {
  buildObjectKey,
  createMultipartUpload,
  presignUploadPart,
  completeMultipartUpload,
  listUploadedParts,
  abortMultipartUpload,
  deleteObject,
  presignDownload,
} from '../storage';

export const filesRouter = Router();
filesRouter.use(requireAuth);

class PayloadTooLargeError extends HttpError {
  constructor(message = 'File too large') {
    super(413, 'PAYLOAD_TOO_LARGE', message);
  }
}

// POST /files/uploads — initiate a multipart upload. Returns presigned
// PUT URLs for every part; the client uploads parts directly to MinIO.
const initiateUploadSchema = z.object({
  folderId: z.string().uuid('folderId must be a valid UUID'),
  name: folderNameSchema,
  sizeBytes: z.coerce.number().int().positive('sizeBytes must be a positive integer'),
  mimeType: z.string().max(255).optional(),
});

filesRouter.post(
  '/uploads',
  validate(initiateUploadSchema),
  asyncHandler(async (req, res) => {
    const { folderId, name, sizeBytes, mimeType } = req.body as z.infer<typeof initiateUploadSchema>;

    if (sizeBytes > config.MAX_UPLOAD_SIZE_BYTES) {
      throw new PayloadTooLargeError(
        `File is ${sizeBytes} bytes, which exceeds the ${config.MAX_UPLOAD_SIZE_BYTES}-byte limit`,
      );
    }

    await getOwnedFolder(pool, folderId, req.user!.id); // 404s if missing/not-owned

    const partSize = config.UPLOAD_PART_SIZE_BYTES;
    const totalParts = Math.max(1, Math.ceil(sizeBytes / partSize));
    if (totalParts > 10000) {
      throw new BadRequestError('File is too large for the configured part size (exceeds 10,000 parts)');
    }

    const fileId = uuidv4();
    const storageKey = buildObjectKey(req.user!.id, fileId);
    const uploadId = await createMultipartUpload(storageKey);

    try {
      await pool.query(
        `INSERT INTO files (id, owner_id, folder_id, name, mime_type, size_bytes, storage_key, status, upload_id, part_size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)`,
        [fileId, req.user!.id, folderId, name, mimeType ?? null, sizeBytes, storageKey, uploadId, partSize],
      );
    } catch (err: unknown) {
      // Row insert failed (most likely a duplicate name in this folder) —
      // don't leave an orphaned multipart upload sitting in MinIO.
      await abortMultipartUpload(storageKey, uploadId).catch(() => undefined);
      if (isUniqueViolation(err)) {
        throw new ConflictError('A file with this name already exists in this folder');
      }
      throw err;
    }

    const parts = await Promise.all(
      Array.from({ length: totalParts }, (_, i) => i + 1).map(async (partNumber) => ({
        partNumber,
        url: await presignUploadPart(storageKey, uploadId, partNumber),
      })),
    );

    res.status(201).json({
      fileId,
      uploadId,
      partSize,
      totalParts,
      parts,
      expiresInSeconds: config.PRESIGN_UPLOAD_TTL_SECONDS,
    });
  }),
);

// GET /files/uploads/:id — resume support. Asks MinIO which parts have
// actually landed and returns fresh presigned URLs for whatever's still
// missing, so a client that lost its local progress can pick back up
// without restarting the whole upload.
filesRouter.get(
  '/uploads/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof uuidParamSchema>;
    const file = await getOwnedFile(pool, id, req.user!.id);

    if (file.status !== 'pending' || !file.upload_id || !file.part_size_bytes) {
      throw new NotFoundError('No in-progress upload for this file');
    }

    const partSize = Number(file.part_size_bytes);
    const totalParts = Math.max(1, Math.ceil(Number(file.size_bytes) / partSize));

    const uploaded = await listUploadedParts(file.storage_key!, file.upload_id);
    const uploadedNumbers = new Set(uploaded.map((p) => p.partNumber));
    const missing = Array.from({ length: totalParts }, (_, i) => i + 1).filter((n) => !uploadedNumbers.has(n));

    const freshUrls = await Promise.all(
      missing.map(async (partNumber) => ({
        partNumber,
        url: await presignUploadPart(file.storage_key!, file.upload_id!, partNumber),
      })),
    );

    res.status(200).json({
      fileId: file.id,
      uploadId: file.upload_id,
      partSize,
      totalParts,
      uploadedParts: uploaded,
      missingParts: freshUrls,
      expiresInSeconds: config.PRESIGN_UPLOAD_TTL_SECONDS,
    });
  }),
);

// POST /files/uploads/:id/complete — stitches the uploaded parts into
// the final object. If the client supplies its tracked {partNumber, eTag}
// list, that's used directly. If omitted, falls back to asking MinIO via
// ListParts for the authoritative list — useful when the client doesn't
// trust its own local state after a long gap or a crash.
const completeUploadSchema = z.object({
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().positive(),
        eTag: z.string().min(1),
      }),
    )
    .optional(),
});

filesRouter.post(
  '/uploads/:id/complete',
  validate(uuidParamSchema, 'params'),
  validate(completeUploadSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof uuidParamSchema>;
    const { parts: clientParts } = req.body as z.infer<typeof completeUploadSchema>;

    const file = await getOwnedFile(pool, id, req.user!.id);
    if (file.status !== 'pending' || !file.upload_id) {
      throw new NotFoundError('No in-progress upload for this file');
    }

    const partSize = Number(file.part_size_bytes ?? config.UPLOAD_PART_SIZE_BYTES);
    const expectedParts = Math.max(1, Math.ceil(Number(file.size_bytes) / partSize));

    const parts =
      clientParts && clientParts.length > 0 ? clientParts : await listUploadedParts(file.storage_key!, file.upload_id);

    if (parts.length !== expectedParts) {
      throw new BadRequestError(
        `Expected ${expectedParts} uploaded part(s), got ${parts.length}. Use GET /files/uploads/${id} to check what's missing.`,
      );
    }

    await completeMultipartUpload(file.storage_key!, file.upload_id, parts);

    const { rows } = await pool.query<FileRow>(
      `UPDATE files SET status = 'complete', upload_id = NULL, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id],
    );
    res.status(200).json(serializeFile(rows[0]!));
  }),
);

// GET /files/:id/download — presigned GET URL for a completed file. The
// actual bytes flow browser-to-MinIO directly, never through this server.
filesRouter.get(
  '/:id/download',
  validate(uuidParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof uuidParamSchema>;
    const file = await getOwnedFile(pool, id, req.user!.id);

    if (file.status !== 'complete' || !file.storage_key) {
      throw new NotFoundError('File is not available for download (upload not complete)');
    }

    const url = await presignDownload(file.storage_key, file.name);
    res.status(200).json({ url, expiresInSeconds: config.PRESIGN_DOWNLOAD_TTL_SECONDS });
  }),
);

// GET /files/storage — aggregate bytes used by the current user's
// completed files. No quota/cap concept exists yet, so this is purely
// informational (a real number, not a fake "X of Y GB" that implies a
// limit we don't actually enforce). Pending uploads are excluded since
// their bytes aren't durably stored as a finished object yet.
filesRouter.get(
  '/storage',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(size_bytes), 0) AS total FROM files WHERE owner_id = $1 AND status = 'complete'`,
      [req.user!.id],
    );
    res.status(200).json({ usedBytes: Number(rows[0]!.total) });
  }),
);

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

// DELETE /files/:id — removes the metadata row. For a completed file
// this also deletes the underlying MinIO object; for a still-pending
// upload it aborts the multipart upload instead (there's no finished
// object to delete yet, just uploaded parts taking up space).
filesRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof uuidParamSchema>;
    const file = await getOwnedFile(pool, id, req.user!.id);

    if (file.status === 'pending' && file.upload_id && file.storage_key) {
      await abortMultipartUpload(file.storage_key, file.upload_id).catch((err) => {
        // Already aborted/expired on the MinIO side — fine, we're
        // deleting the row either way. Anything else, surface it.
        if (!(err instanceof Error) || !/NoSuchUpload/i.test(err.message)) throw err;
      });
    } else if (file.storage_key) {
      await deleteObject(file.storage_key);
    }

    await pool.query('DELETE FROM files WHERE id = $1', [id]);
    res.status(204).send();
  }),
);
