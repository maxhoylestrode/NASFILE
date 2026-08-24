/**
 * Finds files stuck in status='pending' (upload initiated, never
 * completed or explicitly deleted — dropped connection, abandoned tab,
 * client crash) older than STALE_UPLOAD_CLEANUP_HOURS, aborts the
 * multipart upload in MinIO (freeing the uploaded-so-far parts), and
 * deletes the row.
 *
 * Not run automatically — wire this up as a cron job / systemd timer on
 * the homelab box, e.g. daily.
 *
 * Usage: npm run cleanup-stale-uploads
 */
import 'dotenv/config';
import { pool } from '../src/db';
import { config } from '../src/config';
import { abortMultipartUpload } from '../src/storage';
import { logger } from '../src/logger';

async function main() {
  const cutoff = new Date(Date.now() - config.STALE_UPLOAD_CLEANUP_HOURS * 60 * 60 * 1000);

  const { rows } = await pool.query<{ id: string; storage_key: string | null; upload_id: string | null; name: string }>(
    `SELECT id, storage_key, upload_id, name FROM files WHERE status = 'pending' AND created_at < $1`,
    [cutoff],
  );

  logger.info({ count: rows.length, cutoff }, 'Found stale pending uploads');

  for (const row of rows) {
    if (row.storage_key && row.upload_id) {
      await abortMultipartUpload(row.storage_key, row.upload_id).catch((err) => {
        logger.warn({ fileId: row.id, err: err instanceof Error ? err.message : err }, 'Failed to abort stale multipart upload in MinIO, deleting row anyway');
      });
    }
    await pool.query('DELETE FROM files WHERE id = $1', [row.id]);
    logger.info({ fileId: row.id, name: row.name }, 'Cleaned up stale pending upload');
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
