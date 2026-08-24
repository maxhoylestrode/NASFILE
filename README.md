# drive-clone

Self-hosted Google Drive clone MVP for a homelab. Node.js/Express + TypeScript,
Postgres, MinIO, invite-only JWT auth. Deployed behind Nginx Proxy Manager.

## Status

**Session 1 — done:** accounts, invites, auth.
**Session 2 — done:** folder and file metadata CRUD.
**Session 3 — done:** resumable multipart upload/download, direct
browser-to-MinIO.
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

### Session 3: file upload/download

**Note on the storage client:** Session 1 used the `minio` npm package
for the one thing it needed (bucket bootstrap). Session 3 needs full
multipart + presigned-URL control, where `@aws-sdk/client-s3` +
`@aws-sdk/s3-request-presigner` have first-class, stable public APIs —
`minio`'s lower-level multipart primitives aren't part of its documented
public surface. `storage.ts` was rewritten around the AWS SDK
accordingly; the `minio` dependency is gone. MinIO itself is unaffected —
it's still just an S3-compatible object store, only the client library
talking to it changed.

**Note on the API surface:** `serializeFile()` (`src/lib/dbHelpers.ts`)
no longer includes `storageKey` in responses — it's internal MinIO
bookkeeping and shouldn't have been client-visible in Session 2's
metadata-only version either. Responses now include `status`
(`'pending' | 'complete'`) instead.


Large files (tested up to the default 20GiB cap, using genuinely
multi-part reassembly — not just a config value) upload via S3 multipart,
**directly to MinIO** — bytes never pass through this Node server. This
matters on a homelab box that's also running Postgres and MinIO itself:
proxying a 20GB upload through Express would double your bandwidth and
tie up a connection for as long as the transfer takes.

**Upload flow:**

1. `POST /files/uploads` — `{ folderId, name, sizeBytes, mimeType? }`.
   Validates ownership and size (`413` over `MAX_UPLOAD_SIZE_BYTES`),
   opens a multipart upload against MinIO, creates a `files` row with
   `status: 'pending'`, and returns a presigned PUT URL for every part.
2. Client uploads each part **directly to MinIO** using those URLs. If
   the connection drops, only the failed part needs retrying — not the
   whole file.
3. `GET /files/uploads/:id` — the resume endpoint. Asks MinIO (via
   `ListParts`) which parts have actually landed and returns fresh
   presigned URLs for whatever's missing. A client that lost its local
   progress entirely (crash, days-later reconnect) doesn't need to have
   remembered anything — MinIO is the source of truth.
4. `POST /files/uploads/:id/complete` — stitches the parts into the
   final object. Accepts an optional `{ parts: [{ partNumber, eTag }] }`
   body; if the client supplies its tracked list, that's used directly.
   If omitted, the server calls `ListParts` itself and completes with
   whatever MinIO reports — useful when the client doesn't trust its own
   state. Flips the row to `status: 'complete'`.
5. `DELETE /files/:id` on a still-pending upload aborts the multipart
   upload in MinIO instead of trying to delete a finished object that
   doesn't exist yet.

**Download:** `GET /files/:id/download` returns a presigned GET URL
(`{ url, expiresInSeconds }`) — the client fetches directly from MinIO.
Only works for `status: 'complete'` files.

**Stale upload cleanup:** an abandoned upload (initiated, never
completed or deleted) leaves its uploaded-so-far parts sitting in MinIO
indefinitely. `npm run cleanup-stale-uploads` aborts and removes any
`pending` row older than `STALE_UPLOAD_CLEANUP_HOURS` (default 48h) —
wire this up as a daily cron job / systemd timer.

**Testing note:** the automated test suite runs against `s3rver`, a
lightweight pure-JS S3-API test double, since this sandbox has neither
root/Docker (can't install real MinIO) nor access to `dl.min.io` (network
allowlist). s3rver correctly implements `CreateMultipartUpload`,
presigned `UploadPart`, and `CompleteMultipartUpload` with a
client-submitted parts list — verified with real HTTP PUTs of real
random bytes and a byte-for-byte comparison of the reassembled object.
It does **not** implement `ListParts` or `AbortMultipartUpload` (both
return 405), so the resume endpoint, the complete-without-a-body
fallback, and the abort-on-delete path could not be exercised
automatically. Run `scripts/smoke-test-multipart.sh` once against your
real deployed MinIO to verify those specifically — see the script header
for usage.

### Exposing MinIO for direct browser upload/download

Presigned URLs are signed for whatever host is configured as
`MINIO_PUBLIC_URL`, and a browser has to be able to reach that host
directly (uploads/downloads bypass this app server entirely). That means
MinIO needs its own public-facing route through Nginx Proxy Manager,
separate from wherever this API is exposed:

1. **New Proxy Host in NPM** — domain `s3.yourdomain.com` (or whatever
   you set `MINIO_PUBLIC_URL` to), forwarding to MinIO's internal
   host:port (the same one in `MINIO_ENDPOINT`/`MINIO_PORT`). Enable
   SSL/force SSL as usual.
2. **Bump the body size limit.** Nginx defaults to rejecting bodies over
   1MB, which will reject every part upload (parts are 100MB by
   default). In the Proxy Host's "Advanced" tab, add:
   ```nginx
   client_max_body_size 0;
   proxy_read_timeout 3600s;
   proxy_send_timeout 3600s;
   ```
   (`0` means unlimited. The timeouts give slow homelab uplinks room for
   a full 100MB part without NPM cutting the connection.)
3. **Don't rewrite the Host header or the path.** Presigned URLs are
   SigV4-signed against the exact hostname in `MINIO_PUBLIC_URL` — if NPM
   changes the `Host` header or alters the request path on its way to
   MinIO, signature verification fails with `SignatureDoesNotMatch`. NPM's
   default proxy behavior passes both through unchanged, so this is
   usually a non-issue as long as you haven't added custom rewrite rules.
4. **CORS.** The app tries to set bucket CORS automatically at startup
   (`PutBucketCors`, best-effort — logs a warning rather than crashing if
   your MinIO version doesn't support it). If browser uploads fail with a
   CORS error, set it manually once via the MinIO client:
   ```bash
   mc anonymous set-json cors.json myminio/drive-clone
   ```
   with a `cors.json` allowing `GET`/`PUT` from your frontend's origin
   and exposing the `ETag` header.

`MINIO_ENDPOINT` stays internal-only (private network, never needs to be
internet-reachable) — only `MINIO_PUBLIC_URL` needs the NPM setup above.
