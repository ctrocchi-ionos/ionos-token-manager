# IONOS Token Manager

A self-hosted web app for IONOS Cloud account owners who need to hand out scoped, time-limited API tokens to teammates or automation tools — without giving them full account access.

## What it does

- **Create scoped tokens** — each token gets its own IONOS sub-user with only the permissions you choose (read VMs, manage DNS, etc.)
- **Set an expiry** — tokens expire automatically; the app tracks their status
- **Automatic cleanup** — expired tokens' sub-users and groups are removed after a grace period (default 7 days)
- **Permission templates** — save common permission sets so you don't repeat yourself
- **Audit log** — every action is recorded (who created what, when, any errors)
- **Account overview** — see all sub-users on your IONOS account and which tokens they belong to
- **Private workspaces**: every signed-in user has their own database and key; nobody else can see their accounts, tokens, templates or audit log.
- **Several DCD accounts**: connect every IONOS contract you manage and switch between them in the sidebar.
- **Your own backups**: download your data + key, restore it on this or any other copy of the app.

## Who it's for

IONOS account owners or admins who want a simple dashboard to manage API access for their team or CI/CD pipelines, instead of logging into the IONOS DCD portal each time.

## How to run it

### Requirements

- Node.js 18 or later
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

4. **Open your browser** at `http://localhost:3000`

5. **Sign in and add a DCD account** — On first sign-in, add your first DCD account: a name and an admin API token. Add more later in **Settings → DCD accounts**.

That's it. The token is stored encrypted and the app manages itself from there.

### Getting your IONOS API token

1. Log in to [DCD (IONOS Data Center Designer)](https://dcd.ionos.com)
2. Click your profile in the top-right corner
3. Go to **Token Manager**
4. Generate a new token (choose a long TTL — the app does **not** renew it; you will need to paste a new one before it expires)
5. Copy the JWT and paste it when you add the DCD account

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATA_DIR` | `/data` | Holds the per-user workspaces, the master key fingerprint (`key-check`) and old migration files. **Must be on a persistent volume.** |
| `PORT` | `3000` | Port the server listens on |
| `HOST` | `0.0.0.0` | Interface to bind to |
| `ENCRYPTION_KEY` | *(generated on a new install)* | Master key. Generated on a new install and added to `.env`; on the marketplace keep it in the app's `.env`. Never change it on an existing install. |
| `PUBLIC_DIR` | `./public` | Path to the built frontend files (rarely needs changing) |
| `PROXY_SECRET` | *(none)* | Optional. Shared secret your SSO proxy sends as `X-Proxy-Secret`. If set, it must be at least 32 characters (e.g. `openssl rand -hex 32`), otherwise the app refuses to start. Without it, anyone who can reach the port can claim any identity via `X-Auth-Email`. |
| `EXPIRED_CLEANUP_GRACE_DAYS` | `7` | Days after expiry before the app deletes a token's IONOS sub-user and group (only for tokens created with cleanup on). `-1` turns it off. |
| `LEGACY_OWNER_EMAIL` | *(none)* | Only for upgrading very old installs: owner to assign to rows created before per-user ownership. |

Local development (`npm run dev`) also reads `DEV_AUTH_EMAIL` from `.env` as a stand-in for the SSO proxy. It is ignored by `npm start`.

### Security notes

- Runs behind the marketplace login.
- All non-GET API calls need `X-Requested-With: token-manager` (the UI sends it).
- Rate limits are per user.
- Backups are per user; nobody can download anyone else's data.

### Tests

```
npm test -w server
```

### Data persistence

- `DATA_DIR/workspaces/<id>/workspace.db`: one private database per user (`<id>` is a hash of their email).
- `DATA_DIR/key-check`: a fingerprint of the master key. If the app starts with a missing or different key while data exists, it refuses to start instead of losing access.
- `DATA_DIR/tokenmanager.db.migrated-<timestamp>`: the pre-workspace database, kept after the one-time migration. Delete it once you are happy.
- The master key is `ENCRYPTION_KEY` in `.env`. Each user's data is encrypted with their own key derived from it.

### Backup and restore (per user)

In **Settings → Backup & restore**, every user can download two files: **my database** and **my key**. Restore asks for both and replaces only your own data. It works across copies of the app: back up on the marketplace, restore on your PC, or the other way round. Keep the two files apart. Together they give access to your saved IONOS tokens.

A backup belongs to the email it was made with. To restore it on your PC, set `DEV_AUTH_EMAIL` in your local `.env` to the same email you use on the marketplace.

Backups made by older versions of the app (whole database + `encryption.key`) can also be restored; only your own data is taken from them.

Restore replaces your current data. If you created tokens after the backup was made and they still have a live IONOS user, the restore is refused until you revoke them on the dashboard; otherwise their IONOS users would stay behind with nothing left in the app to remove them.

To remove a user's data entirely: first have them revoke their tokens (or remove them yourself in the DCD console), because deleting the folder does not touch IONOS and their `tkn-*` IONOS users would stay behind. Then stop the app and delete their `DATA_DIR/workspaces/<id>/` folder.

## Key features

### Creating a token

1. Click **New Token** from the dashboard
2. Give it a name and description
3. Pick permissions (or start from a template)
4. Optionally select specific resources (datacenters, VMs) to share
5. Set a lifetime (TTL)
6. Click **Create**

The app creates an IONOS sub-user and a scoped token tied to that user. You get a one-time display of the token value — copy it, because it won't be shown again.

### Permission templates

Save a set of permissions as a template so you can reuse it. A few common ones are built in (read-only, CI/CD, etc.). You can create your own from the **Templates** page.

### DCD account token expiry

Each DCD account's token is checked against IONOS when you save it, but it is **not** renewed automatically. The sidebar and Settings show how many days are left for each account. Paste a fresh token before it expires.

### Audit log

Every operation is logged — token creation, deletion, renewal, errors. Find it on the **Audit Log** page.

## Known limitations

- **Token values are shown once.** After creation, the raw token value is not stored — only the IONOS token ID. If a user loses their token, you'll need to regenerate it.
- **Orphan tokens** (tokens on your IONOS account not created by this app) are visible in the Account page but cannot be deleted from here — you'll need to manage them in the IONOS DCD portal.
- **IONOS users created by this tool (`tkn-*`) cannot be deleted from the Account page in the app.** Revoke the token instead.
