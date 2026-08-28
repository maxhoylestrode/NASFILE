# Silo — project handoff / status

Last updated: 2026-08-28, after adding server-generated thumbnails + preview navigation.

This doc is the "what's actually going on" summary. For endpoint-by-endpoint
technical reference, see the main [README.md](../README.md) — it's kept
up to date per-feature and is more detailed than this file on purpose.
This doc is the narrative version: what's live, what's done, what isn't,
and what to do next.

## What this is

Self-hosted Google Drive clone for Max's homelab. Display name **Silo**
(rebranded from "drive-clone" — that name lives on everywhere else on
purpose: repo, npm package, Postgres database, MinIO bucket, and the
systemd service are all still literally `drive-clone`, to avoid touching
live infra naming for a cosmetic change).

Stack: Node.js/Express + TypeScript, Postgres, MinIO (S3-compatible),
invite-only JWT auth, React 18 + Vite + TS + Tailwind v4 frontend served
as static files from the same Express server.

Repo: `https://github.com/maxhoylestrode/NASFILE`, branch `main`.

## It's live

Deployed on the real NAS, not just tested in sandbox:

- App: `https://drive.apexstudio.dev`
- MinIO: `https://s3.apexstudio.dev`
- NAS LAN IP: `192.168.0.6`
- Nginx Proxy Manager: separate Proxmox LXC, `192.168.0.80`
  (container `nginx-proxy-manager-app-1`)
- Pi-hole (local DNS, used to avoid hairpin-NAT throttling for LAN
  clients): `192.168.0.40`

Deploy sequence on the NAS:

```
sudo -u drive-clone -H git -C /opt/drive-clone pull
sudo -u drive-clone -H bash -c "cd /opt/drive-clone && npm run build:all && npm run migrate"
systemctl restart drive-clone
```

**Action needed on the live server (one-time):** `ffmpeg` must be
installed on the NAS itself before the thumbnails feature works for
videos (images work regardless — `sharp` has no system dependency). If
it's missing, video thumbnail generation just fails gracefully
(`thumbnail_status = 'failed'`, falls back to the plain file icon) —
nothing breaks, videos just won't get real thumbnails until it's
installed:

```
apt-get update && apt-get install -y ffmpeg
```

`PUBLIC_APP_URL` was the other action item from the previous update —
if that's already in `.env` (it should be, since sharing has been
confirmed working live), there's nothing further to do for it.

## Feature status

Everything below is built, tested (real embedded-postgres + s3rver +
a real running app boot, not just unit tests), and pushed to `main`.

| Feature | Status | Notes |
|---|---|---|
| Auth (invite-only, JWT) | done | Session 1 |
| Folder/file CRUD | done | Session 2 |
| Resumable multipart upload/download | done | Session 3, direct browser↔MinIO |
| React/Tailwind frontend | done | Session 4 |
| Deploy tooling (`deploy.sh`, `provision-server.sh`) | done | |
| Live deployment | done | SSL/DNS/hairpin-NAT issues hit and fixed, see below |
| Theme system (light/dark toggle) | done | Phase 1 |
| Drive-like shell (Sidebar/TopBar) | done | Phase 2 |
| Rebrand to "Silo" + animations | done | display-only, infra names unchanged |
| Storage usage view | done | real aggregate, no fake quota |
| Bin / Trash (soft-delete, restore, purge) | done | 2 real bugs caught by testing, both fixed |
| Sharing (user-to-user + public links + embed code) | done | see below |
| Grid/list view toggle + right-click context menu | done | Phase 3 |
| Upload panel polish | done | Phase 4 |
| Restyled login/accept-invite/admin-invites pages | done | Phase 5 |
| In-app photo/video preview + next/prev navigation | done | |
| Real server-generated thumbnails (images + video) | done | new system dependency: ffmpeg |

Nothing is currently in progress. The visual redesign (Phases 1-5) is
complete.

## Sharing — the newest feature, worth understanding fully

Two kinds, both view/download only — there's no in-app document editor,
so a share can never grant write access:

- **User-to-user**: share a folder or file with another account by
  email. Access to a shared folder is inherited by everything under it.
  Recipients can browse/download, never rename/move/delete/upload — the
  original owner-only write paths are completely untouched by this
  feature.
- **Public links** (files only, not folders): no login, no click-through,
  built specifically for embedding elsewhere (e.g. a LearnDash page).
  A "copy embed code" button generates ready-to-paste `<img>`/`<iframe>`/
  `<video>`/`<audio>` markup depending on file type — Word/Excel/etc.
  fall back to a plain link since browsers can't render those inline.

This is why `PUBLIC_APP_URL` exists now — it's used to build the full
public link URL. See README's "Session 5" section for the full technical
breakdown (migration, endpoints, the one bug caught during testing).

## Known limitations (by design, for now)

- Refresh tokens are stateless JWTs, no server-side revocation — can't
  invalidate one before it expires. Would need a token table for
  multi-device sign-out.
- Sharing is view/download only, and public links are files only (no
  public folder browsing) — both deliberate scope cuts, not oversights.
- Bucket CORS is `AllowedOrigins: ['*']` — fine for a single-user
  homelab, worth tightening to the real frontend origin at some point.

## What's genuinely unverified

This sandbox has never been able to run a real browser — headless
Chromium's download is blocked by the network allowlist, same class of
restriction that's blocked a couple of other things across this project
(no root/Docker for real MinIO either, hence `s3rver` as a test double).
So every verification across every session, including all of Phases
1-5 and Sharing, has been at the API/build/lint level: real Postgres,
real (s3rver-simulated) S3 calls, a real running app boot, real HTTP
requests against real endpoints — but never an actual click-through in
a real browser.

`docs/session-4-qa-checklist.md` has the manual pass that's been waiting
since Session 4 for exactly this reason. Worth running for real now that
the app is live and reachable, especially:
- the new sharing UI (ShareModal, copy-embed-code button, the
  Shared-with-me page)
- the new right-click context menu and grid/list toggle
- kill-tab-mid-upload-and-resume (the one thing that's mattered most
  since Session 3 and still has never been machine-verified)

## Database caution

**The database is live in production with real data.** Any future
migration must be additive/backward-compatible (new nullable columns,
new tables) — never a destructive change without Max's explicit
go-ahead first. Test every migration against the sandbox's
embedded-postgres before it's ever called ready to deploy. Never run ad
hoc SQL/scripts directly against the live DB without flagging it and
getting confirmation — that's a step above the normal test-then-deploy
flow used for everything else.

## Next steps

Nothing is queued. If picking this back up, the obvious options are:

1. Run the manual QA checklist above in a real browser.
2. Tighten MinIO's bucket CORS to the real origin instead of `*`.
3. Whatever new feature Max wants next — nothing scoped yet.
