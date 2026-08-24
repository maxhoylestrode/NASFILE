-- Session 1: users, invites, folders, files as a real parent/child tree.
-- gen_random_uuid() is built into Postgres core as of v13+, no extension needed.

BEGIN;

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    is_admin        BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- We store a SHA-256 hash of the invite token, never the raw token.
    -- This mirrors password hashing hygiene: a DB dump alone should never
    -- yield a usable invite.
    token_hash      TEXT NOT NULL UNIQUE,
    email           TEXT,
    created_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    used_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    used_at         TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invites_created_by ON invites(created_by);

-- Folders form a real parent/child tree. Each user has exactly one root
-- folder (parent_id IS NULL), created automatically when their account
-- is provisioned via invite acceptance. Every other folder has a parent.
CREATE TABLE folders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id       UUID REFERENCES folders(id) ON DELETE CASCADE,
    name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    is_root         BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT folders_not_own_parent CHECK (id IS DISTINCT FROM parent_id)
);

-- Exactly one root folder per owner.
CREATE UNIQUE INDEX idx_folders_one_root_per_owner
    ON folders(owner_id) WHERE parent_id IS NULL;

-- No two sibling folders under the same parent (per owner) may share a name.
-- Root folders are excluded (parent_id IS NULL) since uniqueness there is
-- already guaranteed by idx_folders_one_root_per_owner.
CREATE UNIQUE INDEX idx_folders_unique_name_per_parent
    ON folders(owner_id, parent_id, name) WHERE parent_id IS NOT NULL;

CREATE INDEX idx_folders_owner_parent ON folders(owner_id, parent_id);

-- Files always live inside a folder (including the user's root folder).
-- storage_key is nullable until Session 3 wires up actual object upload;
-- for Session 2 we manually insert rows with a placeholder key.
CREATE TABLE files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id       UUID NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    mime_type       TEXT,
    size_bytes      BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    storage_key     TEXT UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_files_unique_name_per_folder ON files(folder_id, name);
CREATE INDEX idx_files_owner_folder ON files(owner_id, folder_id);

COMMIT;
