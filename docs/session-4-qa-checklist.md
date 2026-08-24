# Session 4 manual QA checklist

The automated suite (`run_tests.sh` equivalents, 64 checks) covers the API.
This covers what only a real browser can verify — headless Chromium
couldn't be installed in the build sandbox (network allowlist blocked the
download, same restriction that blocked a real MinIO binary). Run this
once after deploying, using the real browser + real MinIO.

Setup: `npm run build:all`, `npm run migrate`, `npm run create-admin`,
`npm start`. Open the app at wherever Nginx Proxy Manager points.

## Auth
- [ ] Log in with the admin account created via `create-admin`
- [ ] Log out, confirm redirected to `/login` and can't navigate back into the drive
- [ ] Wrong password shows an error, doesn't crash the page
- [ ] Leave a tab open past the access token TTL (15 min default), then do
      something (open a folder) — should silently refresh and work, not
      bounce to login

## Folders
- [ ] Create a folder, rename it, move it into another folder, delete it
- [ ] Try to move a folder into its own subfolder — should show an error, not silently break
- [ ] Duplicate folder name in the same location — should show an error
- [ ] Root folder ("My Drive") has no rename/move/delete controls

## Files — small
- [ ] Upload a small file (a few MB), confirm it appears and downloads correctly
- [ ] Rename a file, move it to another folder
- [ ] Delete a file, confirm it's actually gone (re-check the folder)

## Files — large, the actual point of Session 3
- [ ] Upload something genuinely large (500MB+, ideally an actual ISO) —
      watch the progress bar move, confirm multiple parts are uploading
      (check Network tab: several PUT requests to your MinIO domain, not
      one big request to the app server)
- [ ] Mid-upload, **kill the browser tab** (not graceful navigation — an
      actual crash/force-close). Reopen the app. The upload should show
      up under "Uploads" as paused/incomplete.
- [ ] Click resume, **re-select the same file**. Confirm it does NOT
      re-upload from zero — watch the progress bar jump close to where it
      left off rather than starting at 0%.
- [ ] Let it finish, confirm the file shows as available and downloads
      correctly (checksum/size matches the original if you want to be
      thorough: `sha256sum` the original and the downloaded copy)
- [ ] Select the wrong file when resuming — should show a clear error, not
      silently upload the wrong thing under the old file's name

## Invites (admin)
- [ ] Admin menu → create an invite (try both with and without an email restriction)
- [ ] Copy the generated link, open it in a private/incognito window
- [ ] Accept the invite, confirm you land in a drive with an empty root folder
- [ ] Try opening the same invite link again — should be rejected (single-use)
- [ ] Confirm the second account can't see the first account's files (different root folder, no cross-visibility)
- [ ] Confirm the second account has no admin menu / can't create invites

## Cross-cutting
- [ ] Resize the window down to phone width — layout shouldn't break (drag-and-drop upload obviously won't work on mobile, but click-to-upload should)
- [ ] Open browser devtools console during normal use — no unexpected errors logged
