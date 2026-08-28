-- Thumbnails for images/videos. Additive only: two new columns on
-- `files`, both nullable/defaulted, no backfill required -- existing
-- rows just start at thumbnail_status = 'none' and get a thumbnail
-- generated the first time one is requested (see GET
-- /files/:id/thumbnail-url), not as part of this migration.

BEGIN;

ALTER TABLE files
    ADD COLUMN thumbnail_status TEXT NOT NULL DEFAULT 'none'
        CHECK (thumbnail_status IN ('none', 'ready', 'failed')),
    ADD COLUMN thumbnail_key TEXT;

COMMIT;
