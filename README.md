# IONOS Token Manager

A web application for creating **scoped, labeled API tokens** for IONOS Cloud. Solves two problems with IONOS's native token system:

1. **Tokens can't be labeled** — IONOS only shows UUID + dates, making it impossible to know which token is for what
2. **Tokens can't be scoped** — every token inherits ALL permissions of its creator

This app fixes both by creating **real IONOS sub-users** with restricted group permissions, generating tokens for those sub-users, and tracking everything locally.

## Features

- **Scoped tokens**: Select exactly which IONOS services the token can access (S3, AI Model Hub, Kubernetes, etc.)
- **Resource-level access**: Restrict tokens to specific datacenters with edit/share privileges
- **Permission templates**: 8 built-in templates (S3 Only, AI/ML Engineer, Full DevOps, etc.) + custom templates
- **Token dashboard**: See all tokens at a glance with expiry status, permissions summary, search and filters
- **Auto-renewal**: The app automatically renews its own admin token so it never stops working
- **Audit log**: Every operation is logged with full details
- **Export**: Download your token inventory as CSV or JSON

## Prerequisites

- **Node.js 18+** (tested on 18.19, recommended 20+)
- **npm 9+**
- **An IONOS Cloud API token** (create one in DCD > Management > Token Manager)

## Installation (Step by Step)

### 1. Clone the repo

```bash
git clone <this-repo-url>
cd ionos-api-gui
```

### 2. Create your `.env` file

```bash
cp .env.example .env
```

Edit `.env` and paste your IONOS API token:

```
IONOS_API_TOKEN=eyJ0eXAiOiJKV1QiLCJraWQi...your-token-here
```

> This must be a **contract owner** or **administrator** token — the app needs to create sub-users and groups.

### 3. Install dependencies

```bash
npm install
```

### 4. Build the frontend

```bash
npm run build -w client
```

### 5. Start the app

```bash
npm start
```

The app will:
- Initialize the SQLite database
- Auto-generate an `ENCRYPTION_KEY` (saved to `.env` — **back this up!**)
- Bootstrap the admin token and start auto-renewal
- Seed 8 built-in permission templates
- Start the server

Open **http://127.0.0.1:3001** in your browser.

## Development Mode

To run with hot-reload for both frontend and backend:

```bash
npm run dev
```

This starts:
- Backend on `http://localhost:3001` (auto-restarts on changes)
- Frontend on `http://localhost:5173` (hot module reload, proxies `/api` to backend)

## How It Works

When you create a token through the app:

1. A **sub-user** is created in your IONOS account (e.g., `tkn-a3f8b2c1@c10000001.tokenmanager.internal`)
2. A **group** is created with only the permissions you selected
3. The sub-user is added to the group
4. Selected **datacenters/resources** are shared with the group (if any)
5. A **JWT token** is generated for the sub-user with your chosen TTL
6. Metadata is saved locally in SQLite (name, description, permissions, IDs)
7. The token value is shown **once** — save it immediately!

The token genuinely can only do what its group allows. If you gave it "S3 Only" permissions, it cannot create datacenters or manage DNS — the IONOS API will reject those calls.

## Admin Token Auto-Renewal

The app uses your initial admin token to make IONOS API calls. To prevent it from expiring:

- A background job checks **every hour** if the admin token is approaching expiry
- By default, it renews **7 days before expiry** with a **30-day TTL**
- After renewal, the old token is deleted
- Configure this in **Settings** (TTL, threshold, enable/disable)
- You can also trigger a manual renewal from the Settings page

## Project Structure

```
ionos-api-gui/
├── server/                    # Express + TypeScript backend
│   ├── src/
│   │   ├── index.ts           # Entry point
│   │   ├── config.ts          # Environment config
│   │   ├── db/                # SQLite schema, queries
│   │   ├── routes/            # API routes (tokens, templates, admin, audit, resources)
│   │   ├── services/          # IONOS API clients, token creator, auto-renewal
│   │   └── middleware/        # Error handling, logging
│   └── data/                  # SQLite database (auto-created)
├── client/                    # React + TypeScript + Tailwind frontend
│   └── src/
│       ├── pages/             # Dashboard, CreateToken, TokenDetail, Templates, AuditLog, Settings
│       ├── components/        # PermissionPicker, ResourceBrowser, TokenReveal, etc.
│       ├── api/               # Typed API client
│       └── lib/               # Permissions metadata, utilities
└── .env                       # Your IONOS token + encryption key
```

## Deploying to a Server

The app has no built-in authentication. If you deploy it, put it behind a reverse proxy with authentication:

```nginx
# Example nginx config
server {
    listen 443 ssl;
    server_name tokens.yourdomain.com;

    auth_basic "Token Manager";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `IONOS_API_TOKEN` | Yes | IONOS JWT token (owner/admin role) |
| `ENCRYPTION_KEY` | Auto | 64 hex chars for AES-256-GCM (auto-generated on first run) |
| `PORT` | No | Server port (default: 3001) |
| `HOST` | No | Bind address (default: 127.0.0.1) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tokens` | Create a managed token |
| GET | `/api/tokens` | List tokens (with search, filter, pagination) |
| GET | `/api/tokens/:id` | Get token details |
| DELETE | `/api/tokens/:id` | Revoke token + cleanup sub-user/group |
| POST | `/api/tokens/:id/regenerate` | Generate new token for existing sub-user |
| POST | `/api/tokens/bulk-delete` | Bulk delete expired tokens |
| GET | `/api/tokens/export` | Export as CSV or JSON |
| GET | `/api/templates` | List permission templates |
| POST | `/api/templates` | Create custom template |
| GET | `/api/resources/datacenters` | List IONOS datacenters |
| GET | `/api/admin/health` | Health check + admin token status |
| POST | `/api/admin/token-renew` | Manually trigger admin token renewal |
| GET | `/api/audit` | View audit log |

## Backup

Back up these items:
- **`.env`** file (contains your encryption key)
- **`server/data/tokenmanager.db`** (SQLite database with all token metadata)

Without the encryption key, stored sub-user passwords cannot be decrypted and tokens cannot be regenerated.
