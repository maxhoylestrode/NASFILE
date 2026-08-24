# drive-clone

Self-hosted Google Drive clone MVP for a homelab. Node.js/Express + TypeScript,
Postgres, MinIO, invite-only JWT auth. Deployed behind Nginx Proxy Manager.

## Status

**Session 1 — done:** accounts, invites, auth.
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
