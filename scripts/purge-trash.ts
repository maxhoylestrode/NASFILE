/**
 * Permanently removes anything that's been sitting in the Bin longer
 * than TRASH_RETENTION_DAYS — real MinIO object delete for completed
 * files, then the row itself. Files first, then folders: a folder row
 * delete cascades to any files/folders still nested under it, but by
 * the time we get here every completed file we care about has already
 * had its object explicitly cleaned up in the loop below, so the
 * cascade is just tidying up rows, not silently orphaning MinIO objects.
 *
 * Not run automatically — wire this up as a cron job / systemd timer on
 * the homelab box, e.g. daily, same as cleanup-stale-uploads.
 *
 * Usage: npm run purge-trash
 */
import 'dotenv/config';
import { pool } from '../src/db';
import { config } from '../src/config';
import { deleteObject } from '../src/storage';
import { logger } from '../src/logger';

async function main() {
  const cutoff = new Date(Date.now() - config.TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const { rows: files } = await pool.query<{
    id: string;
    storage_key: string | null;
    thumbnail_key: string | null;
    name: string;
  }>(
    `SELECT id, storage_key, thumbnail_key, name FROM files WHERE deleted_at IS NOT NULL AND deleted_at < $1`,
    [cutoff],
  );
  logger.info({ count: files.length, cutoff }, 'Purging trashed files past retention');
  for (const file of files) {
    if (file.storage_key) {
      await deleteObject(file.storage_key).catch((err) => {
        logger.warn({ fileId: file.id, err: err instanceof Error ? err.message : err }, 'Failed to delete MinIO object, deleting row anyway');
      });
    }
    if (file.thumbnail_key) {
      await deleteObject(file.thumbnail_key).catch((err) => {
        logger.warn({ fileId: file.id, err: err instanceof Error ? err.message : err }, 'Failed to delete thumbnail object, deleting row anyway');
      });
    }
    await pool.query('DELETE FROM files WHERE id = $1', [file.id]);
    logger.info({ fileId: file.id, name: file.name }, 'Purged trashed file');
  }

  const { rows: folders } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < $1`,
    [cutoff],
  );
  logger.info({ count: folders.length, cutoff }, 'Purging trashed folders past retention');
  for (const folder of folders) {
    await pool.query('DELETE FROM folders WHERE id = $1', [folder.id]);
    logger.info({ folderId: folder.id, name: folder.name }, 'Purged trashed folder');
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Purge failed:', err);
  process.exit(1);
});
