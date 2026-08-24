-- Sharing: a resource (folder XOR file) shared either with a specific
-- invited user (view/download only — no in-app editor exists, so no
-- write permission level is needed) or via an unguessable public link.
-- Public links are files only — embedding a whole folder as a public
-- browsable listing is a materially different, bigger feature nobody's
-- asked for yet.

BEGIN;

CREATE TABLE shares (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id           UUID REFERENCES folders(id) ON DELETE CASCADE,
    file_id             UUID REFERENCES files(id) ON DELETE CASCADE,
    share_type          TEXT NOT NULL CHECK (share_type IN ('user', 'public')),
    shared_with_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    -- Public link tokens are hashed exactly like invite tokens (see
    -- src/lib/inviteToken.ts / src/lib/shareToken.ts) — the raw token is
    -- shown to the owner exactly once and is not recoverable from the DB.
    token_hash          TEXT UNIQUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT shares_exactly_one_resource CHECK ((folder_id IS NOT NULL) <> (file_id IS NOT NULL)),
    CONSTRAINT shares_public_link_files_only CHECK (share_type = 'user' OR file_id IS NOT NULL),
    CONSTRAINT shares_type_shape CHECK (
        (share_type = 'user' AND shared_with_user_id IS NOT NULL AND token_hash IS NULL) OR
        (share_type = 'public' AND shared_with_user_id IS NULL AND token_hash IS NOT NULL)
    )
);

CREATE INDEX idx_shares_owner ON shares(owner_id);
CREATE INDEX idx_shares_shared_with_user ON shares(shared_with_user_id) WHERE shared_with_user_id IS NOT NULL;

-- Can't double-share the same resource with the same person.
CREATE UNIQUE INDEX idx_shares_unique_user_folder ON shares(folder_id, shared_with_user_id)
    WHERE share_type = 'user' AND folder_id IS NOT NULL;
CREATE UNIQUE INDEX idx_shares_unique_user_file ON shares(file_id, shared_with_user_id)
    WHERE share_type = 'user' AND file_id IS NOT NULL;

-- At most one public link per file — "get link" is get-or-create, not
-- mint-another-one, matching the single "copy embed code" button.
CREATE UNIQUE INDEX idx_shares_unique_public_file ON shares(file_id) WHERE share_type = 'public';

COMMIT;
