import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { asyncHandler } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import { NotFoundError } from '../middleware/errors';
import { hashShareToken } from '../lib/shareToken';
import { presignDownload } from '../storage';
import type { FileRow } from '../lib/dbHelpers';

// No requireAuth on this router — that's the entire point. Anyone with
// the link (or an <img>/<iframe> pointed at it) gets straight to the
// file, no account and no click-through page, so it actually works as
// an embed. Mounted at /public in src/app.ts, separate from the SPA
// catch-all and from every authenticated router.
export const publicRouter = Router();

const tokenParamSchema = z.object({
  token: z.string().min(1),
});

publicRouter.get(
  '/:token',
  validate(tokenParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { token } = req.params as unknown as z.infer<typeof tokenParamSchema>;
    const tokenHash = hashShareToken(token);

    const { rows } = await pool.query<{ file_id: string }>(
      `SELECT file_id FROM shares WHERE token_hash = $1 AND share_type = 'public'`,
      [tokenHash],
    );
    const share = rows[0];
    if (!share) {
      throw new NotFoundError('This link is invalid or has been revoked');
    }

    const { rows: fileRows } = await pool.query<FileRow>(
      `SELECT * FROM files WHERE id = $1 AND deleted_at IS NULL`,
      [share.file_id],
    );
    const file = fileRows[0];
    if (!file || file.status !== 'complete' || !file.storage_key) {
      throw new NotFoundError('This link is invalid or has been revoked');
    }

    // 'inline' disposition so a browser (or an <img>/<iframe> that
    // followed this redirect) renders the content instead of prompting
    // a download — see storage.ts presignDownload.
    const url = await presignDownload(file.storage_key, file.name, { disposition: 'inline' });
    res.redirect(302, url);
  }),
);
