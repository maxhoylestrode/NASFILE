# drive-clone

Self-hosted Google Drive clone MVP for a homelab. Node.js/Express + TypeScript,
Postgres, MinIO, invite-only JWT auth. Deployed behind Nginx Proxy Manager.

## Status

**Session 1 — done:** accounts, invites, auth.
**Session 2 — done:** folder and file metadata CRUD.
- Postgres schema: `users`, `invites`, `folders`, `files` (folders/files form a
  real parent/child tree; schema in `db/migrations/001_init.sql`)
- argon2id password hashing
- JWT access + refresh tokens
- `POST /auth/login`, `POST /auth/refresh`
- `POST /invites` (admin-only), `POST /invites/accept`
- Invite tokens are single-use and stored only as a SHA-256 hash (never in
  plaintext), same hygiene as passwords
- Per-account and per-IP rate limiting on auth endpoints
- Redacted structured logging (pino) — passwords, tokens, and hashes never
  hit the log stream

### Session 2 endpoints

All require a valid access token (`Authorization: Bearer <token>`). Every
folder/file is strictly scoped to its owner — a mismatched owner returns
**404**, never 403, so an ID probe can't confirm something exists.

- `GET /folders/:id` — lists the folder itself plus its direct subfolders
  and files
- `POST /folders` — `{ name, parentId }`, creates a folder under an
  explicit parent
- `PATCH /folders/:id` — `{ name?, parentId? }`, rename and/or move; blocks
  moving a folder into its own subtree (walks the parent chain via a
  recursive CTE) and blocks any modification of the per-user root folder
- `DELETE /folders/:id` — hard delete; cascades to descendant folders and
  files via `ON DELETE CASCADE` (blocked for the root folder)
- `PATCH /files/:id` — `{ name?, folderId? }`, rename and/or move to a
  different folder
- `DELETE /files/:id` — removes the metadata row (the underlying MinIO
  object isn't touched — Session 3 wires up real upload/download and
  `storage_key` is currently always `NULL`/manually inserted for testing)

Every account gets exactly one root folder (`is_root = true`,
`parent_id IS NULL`), created at invite-acceptance time. `POST
/auth/login` and `POST /invites/accept` both include `rootFolderId`
in the response so a client always has a starting point. (`POST
/auth/refresh` only re-issues an access token, so it omits it.)

There's no way to create the very first user through the API (invites can
only be created by an existing admin, and account creation only happens via
invite acceptance) — see `npm run create-admin` below.

## Setup

```bash
npm install
cp .env.example .env   # fill in real secrets/connection info
npm run migrate
npm run create-admin -- --email you@yourdomain.com --password 'a-strong-password'
npm run build
npm start
```

For local development: `npm run dev` (ts-node-dev, auto-restart).

### Environment variables

See `.env.example`. Notably:
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — must each be ≥32 chars, distinct
- `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` — default 15m / 30d
- `MINIO_*` — bucket is created automatically at startup if it doesn't exist
- `INVITE_TTL_HOURS` — default 72

## Conventions used throughout

- Route handlers are wrapped in `asyncHandler` (`src/middleware/asyncHandler.ts`)
  so rejected promises reach Express's error middleware instead of crashing.
- Request bodies/params are validated with `zod` via the `validate()` middleware
  (`src/middleware/validate.ts`), which replaces `req.body`/`req.params` with
  the parsed (coerced) value.
- `requireAuth` / `requireAdmin` (`src/middleware/auth.ts`) gate routes on a
  valid access JWT and, where needed, `is_admin`.
- Errors are thrown as typed subclasses of `HttpError`
  (`src/middleware/errors.ts`) and rendered uniformly by the central error
  handler as `{ error: { code, message } }`.
- Ownership checks return **404**, not 403, when a resource exists but
  belongs to someone else — avoids confirming existence to an attacker
  probing IDs.

## Known limitations (by design, for now)

- Refresh tokens are stateless JWTs with no server-side revocation list —
  there's no way to invalidate one before it expires. Fine for a
  single-operator homelab; would need a token table before adding
  multi-device sign-out or "log out everywhere."
- No sharing model — every folder/file is strictly owned by one user, admin
  included. Revisit if this ever needs to serve more than one person who
  should see each other's stuff.
