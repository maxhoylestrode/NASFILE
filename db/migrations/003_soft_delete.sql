-- Bin/Trash: soft-delete instead of hard-delete on the first DELETE call.
-- A second DELETE on an already-trashed item is what actually removes it
-- (and its MinIO object) for good — see src/routes/folders.ts and
-- src/routes/files.ts. Root folders are still never trashable (enforced
-- in application code, same as the existing rename/move/delete guard).

BEGIN;

ALTER TABLE folders ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE files ADD COLUMN deleted_at TIMESTAMPTZ;

-- A trashed item shouldn't occupy the "name already taken" slot — you
-- should be able to create (or restore) something with the same name a
-- trashed item had. Replace the existing uniqueness indexes with
-- deleted_at-aware versions.
DROP INDEX idx_folders_unique_name_per_parent;
CREATE UNIQUE INDEX idx_folders_unique_name_per_parent
    ON folders(owner_id, parent_id, name) WHERE parent_id IS NOT NULL AND deleted_at IS NULL;

DROP INDEX idx_files_unique_name_per_folder;
CREATE UNIQUE INDEX idx_files_unique_name_per_folder
    ON files(folder_id, name) WHERE deleted_at IS NULL;

CREATE INDEX idx_folders_owner_deleted ON folders(owner_id) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_files_owner_deleted ON files(owner_id) WHERE deleted_at IS NOT NULL;

COMMIT;
