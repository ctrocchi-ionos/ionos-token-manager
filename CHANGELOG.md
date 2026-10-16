# Changelog

## 2.0.0 (2026-10-16)

A major release: every user now has private data, and one user can manage several IONOS contracts.
Read [Upgrading from 1.x](README.md#upgrading-from-1x) in the README before you deploy it.

### New
- **Private workspace per user.** Each signed-in user has their own database and their own encryption key
  (derived from the master key). Nobody else can see their DCD accounts, tokens, templates or audit log.
- **Several DCD accounts.** Connect every IONOS contract you manage (one admin API token each) and switch
  between them in the sidebar. Add, rename, replace the token of, or remove accounts in **Settings**.
- **Your own backup and restore.** Download "my database" and "my key"; restore them on this or any other copy
  of the app, also from the first-run screen. Old whole-app backups can still be restored: only your own rows are taken.
- **First-run screen** asks for the first DCD account, or a backup to restore.
- **Master key lifecycle.** A new install generates the master key, writes it to `DATA_DIR/encryption.key`, and also
  adds it to `.env` when that file exists. A `key-check` fingerprint stops the app from starting with a different key,
  so data is never written under the wrong key.
- **Automatic cleanup** of expired tokens' IONOS sub-users and groups after a grace period
  (`EXPIRED_CLEANUP_GRACE_DAYS`, default 7, `-1` turns it off).

### Changed
- On first start, the old shared database (`tokenmanager.db`) is split into one workspace per user and kept,
  renamed to `tokenmanager.db.migrated-<timestamp>`. Each user's admin token becomes their first DCD account.
- The audit log has an account column; templates are per user (the built-in ones are shared).
- IONOS errors are reported as IONOS errors (HTTP 502, with IONOS's status), never as a login or request problem.
- Request bodies are read only after sign-in; rate limits count per user (300 requests, 60 changes per minute).
- API timestamps are ISO 8601 in UTC with a `Z` (they were zone-less, so browsers showed them in the wrong time zone).
- The dashboard pages through tokens 50 at a time (it showed only the first 50). Expired tokens whose IONOS user still
  exists can be revoked from the dashboard. Downloads and exports show the server's error instead of saving it as the file.
- The token page lists the resources shared with the token, without asking IONOS.
- Requires Node.js 18.18 or later.

### Removed (breaking)
- The whole-app backup and restore endpoints (`/api/admin/backup/db`, `/api/admin/backup/key`, `/api/admin/restore`).
  Backups are now per user (`/api/backup/*`, in **Settings → Backup & restore**).
- The single shared admin token and its endpoints (`/api/admin/needs-setup`, `/api/admin/setup`, `/api/admin/token`,
  `/api/admin/token-status`). Admin tokens now belong to DCD accounts (`/api/dcd-accounts`).
  The health check `GET /api/admin/health` is unchanged.
- `GET /api/resources/all` and `GET /api/resources/:type` (unused by the app; `GET /api/resources/datacenters` stays).
- Open CORS.

### Security
- Every change needs the `X-Requested-With: token-manager` header (CSRF protection; the UI sends it).
- Optional `PROXY_SECRET` (at least 32 characters) stops identity spoofing on direct port access.
- `DEV_AUTH_EMAIL` only works under `npm run dev`.
- Revoke never reports success while the IONOS user may still be live.
- Regenerate, revoke and the cleanup never run at the same time on one token.
- A restore is refused when it would leave live IONOS users that nothing in the app could remove any more.
- Uploaded backups are opened read-only, with only real tables read.

## 1.2.1
- `DEV_AUTH_EMAIL` fallback for local development without the SSO proxy.

## 1.1.0
- Per-user token scoping via the SSO `X-Auth-Email` header.
