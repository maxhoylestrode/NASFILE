# drive-clone

Self-hosted Google Drive clone MVP for a homelab. Node.js/Express + TypeScript,
Postgres, MinIO, invite-only JWT auth. Deployed behind Nginx Proxy Manager.

> Picking this project back up? Start with
> [`docs/HANDOFF.md`](docs/HANDOFF.md) — current live status, what's done,
> what to check next. This README is the endpoint-level technical reference.

## Status

**Session 1 — done:** accounts, invites, auth.
**Session 2 — done:** folder and file metadata CRUD.
**Session 3 — done:** resumable multipart upload/download, direct
browser-to-MinIO.
**Session 4 — done:** React + Tailwind frontend, served from this same
Express server.
**Session 5 — done:** visual redesign (Silo rebrand, dark mode), Storage
view, Bin/Trash, Sharing (user-to-user + public links).
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
- `GET /files/storage` — `{ usedBytes }`, sum of the current user's
  completed files. No quota/cap exists yet — this is informational only.
- `POST /folders` — `{ name, parentId }`, creates a folder under an
  explicit parent
- `PATCH /folders/:id` — `{ name?, parentId? }`, rename and/or move; blocks
  moving a folder into its own subtree (walks the parent chain via a
  recursive CTE) and blocks any modification of the per-user root folder
- `DELETE /folders/:id` — **first call moves the folder (and everything
  inside it) to the Bin.** A second `DELETE` on an already-trashed folder
  is what actually removes it and its files' MinIO objects for good.
  Blocked for the root folder, either way.
- `POST /folders/:id/restore` — undoes a soft-delete for a folder and
  everything trashed alongside it in the same batch. 409s if the
  containing folder is also trashed (restore that first) or if something
  with the same name already exists in the destination.
- `GET /folders/trash/all` — everything currently in the Bin: one row per
  trashed subtree root (a trashed folder's descendants aren't listed
  separately), across both folders and files.
- `PATCH /files/:id` — `{ name?, folderId? }`, rename and/or move to a
  different folder
- `DELETE /files/:id` — a still-pending upload is always removed outright
  (nothing finished to preserve). A completed file's **first** `DELETE`
  moves it to the Bin instead of touching MinIO; calling `DELETE` again
  on an already-trashed file deletes the object and the row for good.
- `POST /files/:id/restore` — undoes a soft-delete. 409s if the containing
  folder is itself trashed (restore that first) or on a name collision.

Trashed items don't occupy their old name — you can create (or restore)
something with the same name a trashed item had; the unique-name indexes
on `folders`/`files` are `deleted_at IS NULL`-scoped. `npm run
purge-trash` (cron-able, same pattern as `cleanup-stale-uploads` below)
permanently removes anything that's been in the Bin longer than
`TRASH_RETENTION_DAYS` (default 30).

Every account gets exactly one root folder (`is_root = true`,
`parent_id IS NULL`), created at invite-acceptance time. `POST
/auth/login` and `POST /invites/accept` both include `rootFolderId`
in the response so a client always has a starting point. (`POST
/auth/refresh` only re-issues an access token, so it omits it.)

There's no way to create the very first user through the API (invites can
only be created by an existing admin, and account creation only happens via
invite acceptance) — see `npm run create-admin` below.

## Frontend

`frontend/` is a separate Vite + React + TypeScript + Tailwind app (no
relation to the backend's build — its own `package.json`, its own
`tsc`). It talks to the exact same endpoints documented below: login,
folder/file CRUD, and the full resumable multipart upload flow with a
real progress bar and cross-reload resume (re-select the same file after
a crash/reload — see `docs/session-4-qa-checklist.md`).

**Dev:** two processes. `npm run dev` here for the API (port 3000), and
`npm --prefix frontend run dev` for the frontend (its own Vite dev
server, default port 5173) — Vite proxies `/auth`, `/invites`,
`/folders`, `/files` back to port 3000 (see `frontend/vite.config.ts`),
so the browser only ever talks to one origin even in dev.

**Production:** `npm run build:all` builds the frontend first, then the
backend. Express serves the built frontend as static files and falls
back to `index.html` for client-side routes (`/login`, `/accept-invite`,
etc.) — see the bottom of `src/app.ts`. One process, one Nginx Proxy
Manager host for the whole app. MinIO still needs its own separate
subdomain (see "Exposing MinIO" below) since upload/download bytes
bypass this server entirely.

**Deploying to a fresh server** (nothing installed yet but the OS):
`sudo bash scripts/provision-server.sh`. Installs Node.js, real
PostgreSQL, real MinIO (systemd units for both, following each project's
own documented install method), creates a dedicated non-root
`drive-clone` system user to actually run the app under, writes real
generated credentials into `.env`, then hands off into `deploy.sh`
below. Ends by printing exactly what to put into your reverse proxy —
domain → `<this box's LAN IP>:3000` for the app, another domain →
`<LAN IP>:9000` for MinIO. Doesn't touch a reverse proxy itself (assumes
you're running one elsewhere, e.g. Nginx Proxy Manager on a different
box) and won't touch the firewall without an explicit yes at that exact
step — it detects your actual SSH port first rather than assuming 22, to
avoid locking you out. **Only runs on Debian/Ubuntu** (apt-based).
Root-only on purpose — it's doing real system-level installs.

**Deploying where Postgres/MinIO already exist:** `bash scripts/deploy.sh`
from the repo root (no root needed). Generates real JWT secrets, checks
the rest of `.env` isn't still placeholder values, builds both frontend
and backend, runs migrations, optionally creates the admin account and a
systemd unit (`deploy/drive-clone.service`) — prints the `sudo systemctl`
commands rather than running them itself, since it doesn't assume root.
`provision-server.sh` calls this automatically as its last step.

If `frontend/dist` doesn't exist (frontend never built), the server logs
a warning at startup and runs API-only — nothing breaks, there's just no
UI to serve.

## Setup

**System dependency:** `ffmpeg` must be installed on the host (used only
for video thumbnail frame extraction — see "Thumbnails" below). Not
needed for anything else the app does.

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
- `PUBLIC_APP_URL` — **required, no default** (e.g. `https://drive.yourdomain.com`).
  Used to build the full `/public/:token` URL returned by the public-link
  endpoints. `scripts/deploy.sh` fails loudly on its placeholder-check if
  this is still unset.
- `TRASH_RETENTION_DAYS` — default 30, used by `npm run purge-trash`

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
- Sharing is view/download only — there's no in-app document editor, so
  write access is never granted via a share, only via ownership.
- Public share links are files only, not folders — sharing an entire
  folder via an open link (no login) was scoped out as materially bigger
  and nobody's asked for it yet.

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

### Session 4: frontend

Stack: Vite, React 18, TypeScript, Tailwind v4 (CSS-based config via
`@tailwindcss/vite`, no `tailwind.config.js` needed), React Router,
TanStack Query, `lucide-react` for icons. No component library beyond
that — deliberately minimal for a first pass, per your call to keep it
"quick and simple" but on a stack worth building on.

**Auth:** tokens live in `localStorage` (`frontend/src/api/tokenStore.ts`).
The fetch wrapper (`frontend/src/api/client.ts`) auto-refreshes on a 401,
coalescing concurrent refresh attempts into one request, and forces
logout if the refresh token itself is dead.

**Upload UI:** `frontend/src/upload/uploadManager.ts` drives the actual
multipart flow — XHR (not `fetch`) for real upload-progress events,
bounded concurrency (3 parts at once), per-part retry with backoff. State
lives in `frontend/src/upload/uploadStore.ts`, a small external store
(via `useSyncExternalStore`) persisted to `localStorage` so an in-progress
upload survives a reload.

**On resumability specifically** (the actual point of Session 3, carried
through to the UI): a browser can't hold onto a `File` object across a
reload — there's no getting around re-selecting the file. What resume
actually buys you is not re-uploading bytes MinIO already has. On resume,
the client doesn't trust its own stored progress — it calls `GET
/files/uploads/:id`, the server asks MinIO via `ListParts`, and only the
parts genuinely still missing get (re-)uploaded. See
`docs/session-4-qa-checklist.md` for exactly how to test this — kill the
tab mid-upload of something large, reopen, resume, confirm it doesn't
restart from zero.

**Not done in this pass** (flagging rather than silently skipping):
- No drag-and-drop *move* — moving is a folder-picker modal
  (`MoveModal.tsx`), not drag-and-drop onto folders. Drag-and-drop *is*
  wired up for uploads (drop anywhere on the drive view).
- No breadcrumb persistence across a hard refresh — reloading mid-navigation
  drops you back at "My Drive". The current folder's *contents* are still
  correct, just the path trail resets.
- Bucket CORS defaults to `AllowedOrigins: ['*']` (set in `storage.ts`
  from Session 3) — fine for a single-user homelab, worth tightening to
  your actual frontend origin once this is live.

### Session 5: visual redesign, Storage view, Bin/Trash, Sharing

**Rebrand:** display name changed to "Silo" (page title, sidebar brand
text) — the repo, npm package, database, S3 bucket, and systemd service
are all deliberately still named `drive-clone`, to avoid touching live
infra naming for a cosmetic change.

**Theme system:** light/dark mode via a `.dark` class on `<html>`
(`frontend/src/theme/ThemeContext.tsx`), toggled by the user or following
`prefers-color-scheme` until an explicit choice is made, persisted to
`localStorage`. An inline pre-paint script in `index.html` applies the
class before React mounts, so there's no flash of the wrong theme.

**Storage view:** `GET /files/storage` — `{ usedBytes }`, sum of
`size_bytes` across the current user's `status = 'complete'` files.
Deliberately no fake quota or percentage bar — there's no cap to measure
against yet.

**Bin/Trash:** every folder/file has a `deleted_at` column
(`db/migrations/003_soft_delete.sql`). Deleting is two-step: the first
`DELETE` soft-deletes (moves to the Bin, cascades to everything inside a
folder); a second `DELETE` on an already-trashed item is what actually
removes it, including its real MinIO object(s). `POST
.../:id/restore` undoes a soft-delete; 409s if the containing folder is
still trashed (restore that first) or if the name collides with
something already at the destination. `GET /folders/trash/all` lists
only trashed subtree *roots* — a trashed folder's already-trashed
children aren't listed again separately. `npm run purge-trash`
(cron-able) permanently sweeps anything past `TRASH_RETENTION_DAYS`.
Unique-name indexes are `deleted_at IS NULL`-scoped, so a trashed item's
old name is immediately reusable.

**Sharing** (`db/migrations/004_sharing.sql`, `src/routes/shares.ts`,
`src/routes/public.ts`): view/download only, never write — there's no
in-app editor, so a share can't grant more than ownership already
implies. Two kinds:

- **User-to-user.** Share a folder or file with another account by
  email. Access to a shared folder is inherited by everything under
  it — checked by walking up the `parent_id` chain (recursive CTE) to
  see whether any ancestor folder has a `share_type = 'user'` row for
  that recipient. Shared recipients can browse and download, never
  rename/move/delete/upload — write routes still use the original
  strict owner-only `getOwnedFolder`/`getOwnedFile` helpers, untouched.
  Trashing a shared folder immediately revokes the recipient's access
  (404); restoring it immediately restores access — the share row
  itself survives the whole cycle.
  - `POST /shares` — `{ resourceType: 'folder' | 'file', resourceId, email }`
  - `DELETE /shares/:id` — revoke
  - `GET /shares?resourceType=&resourceId=` — who a resource is shared
    with, plus whether it has an active public link
  - `GET /shares/with-me` — top-level items shared directly with you
- **Public links** (files only, no folder browsing via a public link —
  see Known limitations). No login, no click-through — built
  specifically so a link can be dropped straight into an `<img>`,
  `<iframe>`, `<video>`, or `<audio>` tag elsewhere (e.g. embedded in a
  LearnDash page). The token is generated once and only its SHA-256 hash
  is ever stored (same pattern as invite tokens,
  `src/lib/shareToken.ts`), so a second `POST` against an existing link
  **cannot** return the original token again — it responds `{ created:
  false, token: null, url: null }` instead of silently fabricating one.
  `GET /public/:token` sits on its own unauthenticated router
  (`src/routes/public.ts`, mounted at `/public`, deliberately outside
  `requireAuth`) and 302-redirects straight to a presigned MinIO URL with
  `Content-Disposition: inline` (vs. `attachment` for normal logged-in
  downloads), so images/PDF/video/audio render in place instead of
  triggering a save dialog.
  - `POST /shares/public-link` — `{ fileId }`, get-or-create
  - `DELETE /shares/public-link/:fileId` — idempotent revoke
  - `GET /public/:token` — the actual public-facing redirect

**Copy embed code:** the frontend (`frontend/src/lib/embedCode.ts`)
builds a ready-to-paste embed tag from the public link + the file's
extension — `<img>` for images, `<iframe>` for PDFs, `<video>`/`<audio>`
for those types, and a plain `<a href>` fallback (flagged as
non-embeddable) for anything else, like Word docs, that browsers won't
render inline from a URL.

### In-app photo/video preview + thumbnails

Clicking an image or video (in the drive view, grid view, right-click
menu, or Shared with me) opens a full-screen preview instead of
downloading — `frontend/src/components/PreviewModal.tsx` renders an
`<img>` or `<video controls autoPlay>` using the same presigned URL a
normal download uses (`Content-Disposition: attachment` doesn't stop a
browser from loading it as an `<img>`/`<video>` subresource — that
header only matters for top-level navigation). Everything else (PDF,
audio, Word/Excel/etc.) still just downloads on click, unchanged.
`frontend/src/lib/mediaType.ts` holds the single source of truth for
which extensions get a native in-browser renderer — `embedCode.ts`
imports from it too, instead of keeping its own copy of the same
extension lists.

The preview modal also supports arrow-key/click navigation through every
other image/video in the same list (current folder, or the current
Shared-with-me view) — `PreviewModal` takes an ordered `items` array plus
a `startIndex` rather than a single file, wraps around at either end, and
just swaps which player renders (`<img>` vs `<video>`) as you move
between an image and a video.

**Thumbnails** (`GET /files/:id/thumbnail-url`, `src/lib/thumbnails.ts`)
are real server-generated images, not client-side scaling — deliberately
chosen for reliability: a phone-shot video (e.g. iPhone HEVC `.mov`)
doesn't reliably decode in every browser, but a real `ffmpeg` subprocess
decodes it once, server-side, regardless of what's viewing it afterward.
Images go through `sharp` (bundles libvips, no system dependency beyond
the npm package); video frames are grabbed via `ffmpeg -ss 1 ... -frames:v
1` (falls back to `-ss 0` for anything shorter than a second) — **this is
the one new system dependency this feature needs; `ffmpeg` must be
installed on the host** (see Setup above).

Generation is on-demand and cached, not a batch job: the first request
for a given file's thumbnail downloads the source object once, generates
a small JPEG (`sharp`/`ffmpeg`), uploads it to MinIO next to the
original, and flips `files.thumbnail_status` to `'ready'` — every
request after that just re-presigns the already-generated object
(single-digit milliseconds vs. tens-to-low-hundreds of ms for the actual
generation). This also means existing files uploaded before this feature
shipped get a thumbnail the first time anyone views them, with no
backfill migration needed. A generation failure (corrupt file, exotic
codec) is caught and recorded as `thumbnail_status = 'failed'` rather
than surfacing an error — the frontend (`FileThumbnail.tsx`) just falls
back to the plain file-type icon. Same access rule as download —
`getAccessibleFile` (owner or a valid share) — so a thumbnail is visible
anywhere the file itself would be, verified by sharing a file with a
guest account and confirming their thumbnail request is blocked before
the share exists and works after.

Migration `005_thumbnails.sql` adds two nullable/defaulted columns to
`files` (`thumbnail_status`, `thumbnail_key`) — additive only, no
backfill, existing rows just start at `'none'`. Thumbnail objects are
cleaned up alongside the original on permanent delete (`DELETE
/files/:id` second call) and by `npm run purge-trash`, same pattern as
the original object.

**Memory:** opening a folder full of never-thumbnailed files fires one
generation request per visible file. The source object is streamed
straight into `sharp`/`ffmpeg` (`getObjectStream` in `storage.ts`) —
never buffered whole in memory first — and `acquireThumbnailSlot` in
`src/lib/thumbnails.ts` caps actual generation work at 2 concurrent
regardless of how many requests land at once; everything past that just
waits its turn. This exists because the first version buffered full
source files (videos especially) in memory with no concurrency limit,
which maxed out RAM on the real NAS the first time it ran against a
real photo/video library — caught from Max's own live usage, not from
sandbox testing, and reproduced in sandbox afterward (12 concurrent
requests against 6 videos + 6 images, confirmed throttled to 2-at-a-time
and all still succeeding) before being called fixed.

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
