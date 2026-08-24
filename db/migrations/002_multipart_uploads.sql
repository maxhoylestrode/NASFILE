-- Session 3: track in-progress multipart uploads on the files table.
--
-- Every file row now has a lifecycle: created as 'pending' at upload
-- initiation (storage_key and the object already reserved in MinIO via
-- CreateMultipartUpload), flipped to 'complete' once all parts are
-- uploaded and stitched together. This means the (folder_id, name)
-- uniqueness check from Session 1 also reserves the name for the
-- duration of an upload, preventing two concurrent uploads (or an
-- upload racing a manual insert) from colliding.

BEGIN;

ALTER TABLE files
    ADD COLUMN status TEXT NOT NULL DEFAULT 'complete'
        CHECK (status IN ('pending', 'complete')),
    ADD COLUMN upload_id TEXT UNIQUE,
    -- Part size used for THIS upload, fixed at initiation time. Resume
    -- math (which part numbers exist, which are missing) has to stay
    -- consistent even if UPLOAD_PART_SIZE_BYTES changes in config later.
    ADD COLUMN part_size_bytes BIGINT;

-- Used by the stale-upload cleanup job (scripts/cleanup-stale-uploads.ts)
-- to find abandoned pending uploads without a full table scan.
CREATE INDEX idx_files_pending_created ON files(created_at) WHERE status = 'pending';

COMMIT;
