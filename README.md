# IONOS Token Manager

A self-hosted web app for IONOS Cloud account owners who need to hand out scoped, time-limited API tokens to teammates or automation tools — without giving them full account access.

## What it does

- **Create scoped tokens** — each token gets its own IONOS sub-user with only the permissions you choose (read VMs, manage DNS, etc.)
- **Set an expiry** — tokens expire automatically; the app tracks their status
- **Auto-renew the admin token** — the app keeps its own session alive in the background
- **Permission templates** — save common permission sets so you don't repeat yourself
- **Audit log** — every action is recorded (who created what, when, any errors)
- **Account overview** — see all sub-users on your IONOS account and which tokens they belong to

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

5. **Complete setup** — on first run, the app shows a setup screen. Paste your IONOS API token (the owner or admin JWT from your DCD account) and click "Save & Continue".

That's it. The token is stored encrypted and the app manages itself from there.

### Getting your IONOS API token

1. Log in to [DCD (IONOS Data Center Designer)](https://dcd.ionos.com)
2. Click your profile in the top-right corner
3. Go to **Token Manager**
4. Generate a new token (choose a long TTL — the app will auto-renew it)
5. Copy the JWT and paste it into the setup screen

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATA_DIR` | `/data` | Directory for the database and encryption key. **Must be on a persistent volume.** |
| `PORT` | `3000` | Port the server listens on |
| `HOST` | `0.0.0.0` | Interface to bind to |
| `IONOS_API_TOKEN` | *(none)* | Optional. Provide the token via env var instead of the setup page |
| `ENCRYPTION_KEY` | *(auto-generated)* | AES-256-GCM key (64 hex chars). Auto-generated and saved to `DATA_DIR/encryption.key` on first run |
| `PUBLIC_DIR` | `./public` | Path to the built frontend files (rarely needs changing) |

### Data persistence

Everything important is stored in `DATA_DIR`:

- **`tokenmanager.db`** — SQLite database with all token records, templates, and the audit log
- **`encryption.key`** — AES-256-GCM key used to encrypt stored tokens

**Back up `DATA_DIR` regularly.** If you lose `encryption.key`, the encrypted tokens in the database become unreadable and you'll need to reconfigure.

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

### Admin token auto-renewal

The app's own IONOS token (the one you pasted at setup) will auto-renew before it expires. You can configure the renewal window and TTL on the **Settings** page.

### Audit log

Every operation is logged — token creation, deletion, renewal, errors. Find it on the **Audit Log** page.

## Known limitations

- **No built-in authentication.** Anyone who can reach port 3000 can use the app. If you expose it beyond localhost, put it behind a reverse proxy with HTTP Basic Auth or similar.
- **One IONOS account per instance.** The app is tied to the token you configure at setup.
- **Token values are shown once.** After creation, the raw token value is not stored — only the IONOS token ID. If a user loses their token, you'll need to regenerate it.
- **Orphan tokens** (tokens on your IONOS account not created by this app) are visible in the Account page but cannot be deleted from here — you'll need to manage them in the IONOS DCD portal.
