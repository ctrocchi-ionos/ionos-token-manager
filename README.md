# IONOS Token Manager

A self-hosted web app for IONOS Cloud account owners who need to hand out scoped, time-limited API tokens to teammates or automation tools, without giving them full account access.

**Version 2.0.** Every user now has private data, and one user can manage several IONOS contracts. Coming from 1.x? Read [Upgrading from 1.x](#upgrading-from-1x) first. All changes are in [CHANGELOG.md](CHANGELOG.md).

## What it does

- **Create scoped tokens.** Each token gets its own IONOS sub-user with only the permissions you choose (read VMs, manage DNS, etc.), optionally limited to chosen datacenters.
- **Set an expiry.** Tokens expire automatically; the app tracks their status.
- **Automatic cleanup.** Expired tokens' sub-users and groups are removed after a grace period (default 7 days).
- **Permission templates.** Save common permission sets so you don't repeat yourself. Nine are built in.
- **Audit log.** Every action is recorded, with time, DCD account and any errors.
- **IONOS Users page.** See every sub-user on the selected IONOS contract and which token it belongs to.
- **Private workspaces.** Every signed-in user has their own database and key. Nobody else can see their accounts, tokens, templates or audit log.
- **Several DCD accounts.** Connect every IONOS contract you manage and switch between them in the sidebar.
- **Your own backups.** Download your data and your key; restore them on this or any other copy of the app.

## Who it's for

IONOS account owners or admins who want a simple dashboard to manage API access for their team or CI/CD pipelines, instead of logging into the IONOS DCD portal each time.

## How to run it

### Requirements

- Node.js 18.18 or later (20 or later recommended)
- npm 9 or later

### Steps

1. **Install dependencies**
   ```
   npm install
   ```
2. **Build the frontend**
   ```
   npm run build
   ```
3. **Start the server**
   ```
   DATA_DIR=/path/to/persistent/storage npm start
   ```
   The server listens on port **3000** by default.
4. **Open your browser** at `http://localhost:3000`.
5. **Add your first DCD account.** On first sign-in, the app asks for a name and an admin API token, or for a backup to restore. Add more accounts later in **Settings → DCD accounts**.

The app is meant to run behind an SSO proxy that sets the signed-in user's email in the `X-Auth-Email` header (the marketplace login does this).

### Getting your IONOS API token

1. Log in to [DCD (IONOS Data Center Designer)](https://dcd.ionos.com).
2. Click your profile in the top-right corner.
3. Go to **Token Manager**.
4. Generate a new token. Choose a long lifetime: the app does **not** renew it, so you paste a new one before it expires.
5. Copy the token (a JWT) and paste it when you add the DCD account.

The app checks the token with IONOS before saving it, and stores it encrypted.

## Configuration

Settings come from environment variables, or from a `.env` file in the project folder (another location: set `DOTENV_PATH`). A real environment variable wins over the same name in `.env`. In `.env`, write values without quotes. [.env.example](.env.example) is a commented template.

| Variable | Default | Description |
|---|---|---|
| `DATA_DIR` | `server/data` | Holds the per-user workspaces and the master key files. **Must be on a persistent volume** in containers. |
| `PORT` | `3000` | Port the server listens on. |
| `HOST` | `0.0.0.0` | Interface to bind to. Use `127.0.0.1` to keep it on this machine. |
| `ENCRYPTION_KEY` | *(generated on a new install)* | Master key, 64 hex characters. See [Master key](#master-key). Never change it on an existing install. |
| `PROXY_SECRET` | *(none)* | Optional. Shared secret your SSO proxy sends as `X-Proxy-Secret`. If set, it must be at least 32 characters (e.g. `openssl rand -hex 32`), otherwise the app refuses to start. Without it, anyone who can reach the port can claim any identity via `X-Auth-Email`. |
| `EXPIRED_CLEANUP_GRACE_DAYS` | `7` | Days after expiry before the app deletes a token's IONOS sub-user and group (only for tokens created with cleanup on). `-1` turns it off. |
| `LEGACY_OWNER_EMAIL` | *(none)* | Only for installs that predate per-user ownership (before 1.1): the email that owns rows with no owner. Needed on upgrade (the app refuses to start without it when such rows exist) and to restore such an old backup. |
| `PUBLIC_DIR` | `<project>/public` | The built frontend. Rarely needs changing. |
| `DOTENV_PATH` | `<project>/.env` | Where the `.env` file is read from (and where a new master key is added). Set it as a real environment variable: it cannot come from `.env` itself. |

For local development, `npm run dev` also reads `DEV_AUTH_EMAIL` from `.env` as a stand-in for the SSO proxy. `npm start` ignores it. Dev login (`ALLOW_DEV_AUTH=1`, set by `npm run dev`) is refused when `NODE_ENV=production`.

### Master key

All stored secrets (admin tokens, sub-user passwords) are encrypted. Each user's data uses their own key, derived from the master key.

- **New install:** the app generates the master key. It always writes it to `DATA_DIR/encryption.key`, and also appends `ENCRYPTION_KEY=...` to `.env` when that file exists. Keep a copy somewhere safe: without it, stored tokens cannot be read.
- **Where it is read from:** `ENCRYPTION_KEY` first; if that is not set, `DATA_DIR/encryption.key`. The app then warns you to copy the value into `ENCRYPTION_KEY`.
- **The `encryption.key` file** is kept as a safety copy. At startup the app says whether it matches `ENCRYPTION_KEY`.
- **Wrong or missing key:** the app writes a fingerprint (`DATA_DIR/key-check`) on first start. If it later starts with a different key, or with no key at all while data exists, it refuses to start and changes nothing.

### Data folder

- `DATA_DIR/workspaces/<id>/workspace.db`: one private database per user. `<id>` is a hash of their email, so no email appears in folder names.
- `DATA_DIR/encryption.key`: safety copy of the master key.
- `DATA_DIR/key-check`: fingerprint of the master key.
- `DATA_DIR/tokenmanager.db.migrated-<time>` (plus `-wal` and `-shm`, if present): the 1.x database, kept after the upgrade. Delete it once you are happy.

Folders are readable by the app's own user only.

## Backup and restore (per user)

In **Settings → Backup & restore**, every user can download two files: **my database** and **my key**. Restore asks for both and replaces only your own data. It works across copies of the app: back up on the marketplace, restore on your PC, or the other way round. Restore is also offered on the first-run screen. Keep the two files apart: together they give access to your saved IONOS tokens.

- A backup belongs to the email it was made with. To restore it on your PC, set `DEV_AUTH_EMAIL` in your local `.env` to the email you use on the marketplace.
- Backups made by 1.x (whole database + `encryption.key`) can also be restored; only your own rows are taken from them. Rows with no owner go to `LEGACY_OWNER_EMAIL`.
- Restore replaces your current data. If you created tokens after the backup was made and they still have a live IONOS user, the restore is refused until you revoke them; otherwise their IONOS users would stay behind with nothing left in the app to remove them.
- The upload limit is 50 MB, so a database of up to about 37 MB.

To remove a user's data entirely: first have them revoke their tokens (or remove the `tkn-*` users yourself in DCD), because deleting the folder does not touch IONOS. Then stop the app and delete their `DATA_DIR/workspaces/<id>/` folder.

## Upgrading from 1.x

The first start of 2.0 moves the 1.x database into one private workspace per user. It is automatic and keeps the old file, but read this first.

**Before you start**

1. Stop the app and back up the whole `DATA_DIR` (`tokenmanager.db`, its `-wal` and `-shm` files, and `encryption.key`), and your `.env`.
2. Keep the same master key. 1.x kept it in `DATA_DIR/encryption.key`; 2.0 still reads that file. Better: copy its value into `ENCRYPTION_KEY` in `.env`.
3. If the install is older than 1.1 (tokens with no owner), set `LEGACY_OWNER_EMAIL` to the email of the person who owned it. Without it, the app refuses to start and changes nothing.
4. A database from before owners were recorded at all (1.0) cannot be migrated: start 1.2.1 once first.

**What the first start does**

- Checks that the master key opens the old data. If not, it stops and changes nothing.
- For each user: their 1.x admin token becomes their first DCD account, "Contract &lt;number&gt;". Their tokens are attached to the account of their contract.
- A token on a contract with no admin token gets a placeholder account, "Contract &lt;number&gt; (needs token)". Add a token there (**Settings → Add token**) before you revoke such tokens or the cleanup can reach them.
- A token whose contract cannot be told, or whose stored password cannot be decrypted, is skipped and logged with its IONOS user id. It stays in the old file; remove that IONOS user in DCD by hand.
- Custom templates and each user's audit history are copied. Custom templates from before per-user templates are copied to every user.
- Renames the old file to `tokenmanager.db.migrated-<time>` and writes `key-check`.

**API changes** (only if you call the API yourself)

- Removed: `/api/admin/needs-setup`, `/api/admin/setup`, `/api/admin/token`, `/api/admin/token-status`, `/api/admin/backup/db`, `/api/admin/backup/key`, `/api/admin/restore`, `/api/resources/all`, `/api/resources/:type`.
- New: `/api/dcd-accounts` (add, rename, replace token, remove) and `/api/backup/db`, `/api/backup/key`, `/api/backup/restore`.
- Calls on an account (create, list, stats, export and bulk-delete of tokens; resources; IONOS users) need the `X-DCD-Account` header with the account id. Calls on one token by its id do not.
- `GET /api/admin/health` is unchanged.

**Rolling back to 1.x**

1. Revoke the tokens you created in 2.0, or their IONOS users stay behind (1.x does not know them).
2. Stop 2.0 and put back the `DATA_DIR` copy from before the upgrade. Without that copy: rename the `.migrated-*` files back to `tokenmanager.db` (and `-wal`, `-shm`), and delete `workspaces/` and `key-check`.
3. Start 1.x.

Do not keep the `workspaces/` folder when you upgrade again: users already migrated are never imported twice, so changes made in 1.x after the rollback would be ignored.

## Security notes

- Runs behind the SSO login; every API call except `GET /api/admin/health` needs a signed-in user.
- Set `PROXY_SECRET` if the port can be reached without going through the proxy.
- Every change needs the `X-Requested-With: token-manager` header (the UI sends it), which blocks cross-site form posts.
- Rate limits are per user: 300 requests and 60 changes per minute.
- Backups are per user; nobody can download anyone else's data.
- Revoke only reports success once IONOS has removed the access.

## Using it

### Creating a token

1. Click **Create Token**.
2. Give it a name and a description.
3. Pick permissions, or start from a template.
4. Optionally pick datacenters to share with it.
5. Set a lifetime (TTL).
6. Click **Create Token**.

The app creates an IONOS sub-user and a token tied to that user, in the DCD account selected in the sidebar. The token value is shown once: copy it, because it won't be shown again.

### Permission templates

Save a set of permissions as a template to reuse it. Nine are built in (read-only monitoring, Kubernetes developer, database admin, and more). Your own templates are private to you.

### DCD accounts and their token expiry

Each DCD account's admin token is checked with IONOS when you save it, but it is **not** renewed automatically. The sidebar and Settings show the days left for each account. Paste a fresh token (**Settings → Replace token**) before it expires.

### IONOS Users

Lists the sub-users of the selected contract: the admin, the users of your tokens, and anything else ("external"). External users can be deleted from here, except ones the Token Manager created.

### Audit log

Every operation is logged: token creation, revoke, regenerate, account changes, backups, errors. Find it on the **Audit Log** page, and export it as CSV or JSON.

## Development

```
npm run dev                    # server + client with live reload (uses DEV_AUTH_EMAIL)
npm test -w server             # server tests
npm run typecheck -w server    # server type check
```

`./start-dev.sh` runs `npm run dev` from the project folder.

## Known limitations

- **Token values are shown once.** Only the IONOS token id is stored. If a token is lost, regenerate it.
- **Orphan tokens** (tokens on your IONOS account not created by this app) are shown on the IONOS Users page but cannot be deleted from here. Manage them in DCD.
- **IONOS users created by the Token Manager (`tkn-*`) cannot be deleted from the IONOS Users page.** Revoke the token instead. Colleagues who share a contract each have their own workspace, so they see each other's `tkn-*` users as "external" and cannot delete them; the owner revokes them, or you remove them in DCD.
