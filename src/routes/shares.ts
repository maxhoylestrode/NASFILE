import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { config } from '../config';
import { asyncHandler } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { uuidParamSchema } from '../lib/ids';
import { BadRequestError, ConflictError, NotFoundError } from '../middleware/errors';
import {
  getOwnedFolder,
  getOwnedFile,
  isUniqueViolation,
  serializeFolder,
  serializeFile,
  type FolderRow,
  type FileRow,
} from '../lib/dbHelpers';
import { generateShareToken, hashShareToken } from '../lib/shareToken';

export const sharesRouter = Router();
sharesRouter.use(requireAuth);

// POST /shares — share a folder or file you own with another invited
// user on this instance. View/download only — there's no in-app editor,
// so no write permission level exists to grant.
const createShareSchema = z.object({
  resourceType: z.enum(['folder', 'file']),
  resourceId: z.string().uuid('resourceId must be a valid UUID'),
  email: z.string().email().toLowerCase().trim(),
});

sharesRouter.post(
  '/',
  validate(createShareSchema),
  asyncHandler(async (req, res) => {
    const { resourceType, resourceId, email } = req.body as z.infer<typeof createShareSchema>;

    // Ownership check is strict (getOwnedFolder/getOwnedFile, not the
    // shared-access variant) — you can only share things you own
    // yourself, not re-share something already shared with you.
    if (resourceType === 'folder') {
      await getOwnedFolder(pool, resourceId, req.user!.id);
    } else {
      await getOwnedFile(pool, resourceId, req.user!.id);
    }

    const { rows: targetRows } = await pool.query<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE email = $1',
      [email],
    );
    const target = targetRows[0];
    if (!target) {
      throw new NotFoundError('No user with that email');
    }
    if (target.id === req.user!.id) {
      throw new BadRequestError('You already have access to your own files');
    }

    try {
      const { rows } = await pool.query<{ id: string; created_at: Date }>(
        `INSERT INTO shares (owner_id, folder_id, file_id, share_type, shared_with_user_id)
         VALUES ($1, $2, $3, 'user', $4)
         RETURNING id, created_at`,
        [
          req.user!.id,
          resourceType === 'folder' ? resourceId : null,
          resourceType === 'file' ? resourceId : null,
          target.id,
        ],
      );
      res.status(201).json({
        id: rows[0]!.id,
        resourceType,
        resourceId,
        sharedWithEmail: target.email,
        createdAt: rows[0]!.created_at,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('Already shared with this person');
      }
      throw err;
    }
  }),
);

// DELETE /shares/:id — revoke a user share. Owner-only, 404s (never
// 403) on mismatch, matching the rest of the app's ownership checks.
sharesRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof uuidParamSchema>;
    const { rowCount } = await pool.query(
      `DELETE FROM shares WHERE id = $1 AND owner_id = $2 AND share_type = 'user'`,
      [id, req.user!.id],
    );
    if (rowCount === 0) {
      throw new NotFoundError('Share not found');
    }
    res.status(204).send();
  }),
);

// GET /shares?resourceType=&resourceId= — who a resource you own is
// currently shared with, plus whether a public link exists (never the
// token itself — see the public-link endpoints below for why).
const listSharesQuerySchema = z.object({
  resourceType: z.enum(['folder', 'file']),
  resourceId: z.string().uuid('resourceId must be a valid UUID'),
});

sharesRouter.get(
  '/',
  validate(listSharesQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { resourceType, resourceId } = req.query as unknown as z.infer<typeof listSharesQuerySchema>;

    if (resourceType === 'folder') {
      await getOwnedFolder(pool, resourceId, req.user!.id);
    } else {
      await getOwnedFile(pool, resourceId, req.user!.id);
    }

    const column = resourceType === 'folder' ? 'folder_id' : 'file_id';
    const { rows } = await pool.query<{
      id: string;
      share_type: 'user' | 'public';
      shared_with_email: string | null;
      created_at: Date;
    }>(
      `SELECT s.id, s.share_type, u.email AS shared_with_email, s.created_at
       FROM shares s
       LEFT JOIN users u ON u.id = s.shared_with_user_id
       WHERE s.${column} = $1 AND s.owner_id = $2
       ORDER BY s.created_at`,
      [resourceId, req.user!.id],
    );

    res.status(200).json({
      userShares: rows
        .filter((r) => r.share_type === 'user')
        .map((r) => ({ id: r.id, email: r.shared_with_email, createdAt: r.created_at })),
      hasPublicLink: rows.some((r) => r.share_type === 'public'),
    });
  }),
);

// POST /shares/public-link — { fileId } — creates a public, unauthenticated
// share link for a file you own. Files only (see 004_sharing.sql). The
// raw token is returned exactly once, here, same as invite tokens — only
// its hash is ever persisted, so it can't be recovered later. Calling
// this again while a link already exists does NOT create a second one
// (unique index) and does NOT (can't) return the original token —
// `created` tells the frontend which case it got so it can show the
// right copy ("here's your link" vs "a link already exists, revoke and
// make a new one to get something copyable again").
const createPublicLinkSchema = z.object({
  fileId: z.string().uuid('fileId must be a valid UUID'),
});

sharesRouter.post(
  '/public-link',
  validate(createPublicLinkSchema),
  asyncHandler(async (req, res) => {
    const { fileId } = req.body as z.infer<typeof createPublicLinkSchema>;
    await getOwnedFile(pool, fileId, req.user!.id);

    const { rows: existing } = await pool.query('SELECT id FROM shares WHERE file_id = $1 AND share_type = $2', [
      fileId,
      'public',
    ]);
    if (existing.length > 0) {
      res.status(200).json({ created: false, token: null, url: null });
      return;
    }

    const token = generateShareToken();
    const tokenHash = hashShareToken(token);
    await pool.query(
      `INSERT INTO shares (owner_id, file_id, share_type, token_hash) VALUES ($1, $2, 'public', $3)`,
      [req.user!.id, fileId, tokenHash],
    );

    res.status(201).json({
      created: true,
      token,
      url: `${config.PUBLIC_APP_URL}/public/${token}`,
    });
  }),
);

// DELETE /shares/public-link/:fileId — revoke. Idempotent (204 whether
// or not one existed) since the frontend can't distinguish "already
// gone" from "never had one" in any way that matters to the user.
sharesRouter.delete(
  '/public-link/:fileId',
  validate(z.object({ fileId: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const { fileId } = req.params as unknown as { fileId: string };
    await getOwnedFile(pool, fileId, req.user!.id);
    await pool.query(`DELETE FROM shares WHERE file_id = $1 AND owner_id = $2 AND share_type = 'public'`, [
      fileId,
      req.user!.id,
    ]);
    res.status(204).send();
  }),
);

// GET /shares/with-me — top-level items shared directly with you (not
// things merely nested inside one of them — opening a shared folder and
// browsing into it goes through the normal GET /folders/:id, which
// already understands inherited share access).
sharesRouter.get(
  '/with-me',
  asyncHandler(async (req, res) => {
    const [folders, files] = await Promise.all([
      pool.query<FolderRow & { owner_email: string }>(
        `SELECT f.*, u.email AS owner_email
         FROM shares s
         JOIN folders f ON f.id = s.folder_id
         JOIN users u ON u.id = s.owner_id
         WHERE s.share_type = 'user' AND s.shared_with_user_id = $1 AND f.deleted_at IS NULL
         ORDER BY f.name`,
        [req.user!.id],
      ),
      pool.query<FileRow & { owner_email: string }>(
        `SELECT fi.*, u.email AS owner_email
         FROM shares s
         JOIN files fi ON fi.id = s.file_id
         JOIN users u ON u.id = s.owner_id
         WHERE s.share_type = 'user' AND s.shared_with_user_id = $1 AND fi.deleted_at IS NULL
         ORDER BY fi.name`,
        [req.user!.id],
      ),
    ]);

    res.status(200).json({
      folders: folders.rows.map((r) => ({ ...serializeFolder(r), ownerEmail: r.owner_email })),
      files: files.rows.map((r) => ({ ...serializeFile(r), ownerEmail: r.owner_email })),
    });
  }),
);
