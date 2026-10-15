import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { deriveWorkspaceKey } from '../services/crypto.js';
import { initializeWorkspaceSchema, seedBuiltinTemplates } from './schema.js';

/** One signed-in user's private data: their own SQLite file and their own encryption key. */
export interface Workspace {
  id: string;
  email: string;
  db: Database.Database;
  key: Buffer;
}

const DB_FILE = 'workspace.db';
const openWorkspaces = new Map<string, Workspace>();

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Folder name for a user: a hash, so no email appears on disk. */
export function workspaceIdFor(email: string): string {
  return createHash('sha256').update(`workspace:${normalizeEmail(email)}`).digest('hex').slice(0, 32);
}

export function workspacesRoot(): string {
  return join(config.dataDir, 'workspaces');
}

function readOwner(db: Database.Database): string | undefined {
  const row = db.prepare("SELECT value FROM workspace_meta WHERE key = 'owner_email'").get() as { value: string } | undefined;
  return row?.value;
}

export function openWorkspace(email: string): Workspace {
  const normalized = normalizeEmail(email);
  const cached = openWorkspaces.get(normalized);
  if (cached) return cached;

  const id = workspaceIdFor(normalized);
  const dir = join(workspacesRoot(), id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const db = new Database(join(dir, DB_FILE));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initializeWorkspaceSchema(db);

  const owner = readOwner(db);
  if (owner === undefined) {
    db.prepare("INSERT INTO workspace_meta (key, value) VALUES ('owner_email', ?)").run(normalized);
  } else if (owner !== normalized) {
    db.close();
    throw new Error(`Workspace ${id} belongs to a different user`);
  }
  seedBuiltinTemplates(db);

  const ws: Workspace = { id, email: normalized, db, key: deriveWorkspaceKey(config.getEncryptionKey(), id) };
  openWorkspaces.set(normalized, ws);
  return ws;
}

/** Owner emails of every workspace on disk (used by the background expiry sweep). */
export function listWorkspaceEmails(): string[] {
  const root = workspacesRoot();
  if (!existsSync(root)) return [];
  const emails: string[] = [];
  for (const id of readdirSync(root)) {
    const file = join(root, id, DB_FILE);
    if (!existsSync(file)) continue;
    let db: Database.Database | undefined;
    try {
      // One corrupt or locked file must not stop the sweep for everyone else
      db = new Database(file, { readonly: true, fileMustExist: true });
      const owner = readOwner(db);
      if (owner && workspaceIdFor(owner) === id) emails.push(owner);
      else console.warn(`[Workspace] Ignoring folder ${id}: owner does not match`);
    } catch (err) {
      console.warn(`[Workspace] Ignoring folder ${id}:`, err instanceof Error ? err.message : err);
    } finally {
      db?.close();
    }
  }
  return emails;
}

export function closeAllWorkspaces(): void {
  for (const ws of openWorkspaces.values()) ws.db.close();
  openWorkspaces.clear();
}
