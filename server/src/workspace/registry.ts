import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { deriveWorkspaceKey } from '../services/crypto.js';
import { initializeWorkspaceSchema, seedBuiltinTemplates } from './schema.js';
import { readOwner } from './queries.js';

/** One signed-in user's private data: their own SQLite file and their own encryption key. */
export interface Workspace {
  id: string;
  email: string;
  db: Database.Database;
  key: Buffer;
}

const DB_FILE = 'workspace.db';
/** A workspace closes after this long with nobody using it; it reopens on the next request. */
export const IDLE_CLOSE_MS = 30 * 60_000;
const EVICT_EVERY_MS = 60_000;

interface OpenEntry {
  ws: Workspace;
  users: number; // requests and sweeps holding it right now
  lastUsed: number;
}
const openWorkspaces = new Map<string, OpenEntry>();
let lastEviction = 0;

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

function openEntry(email: string): OpenEntry {
  const normalized = normalizeEmail(email);
  const cached = openWorkspaces.get(normalized);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached;
  }

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

  const entry: OpenEntry = {
    ws: { id, email: normalized, db, key: deriveWorkspaceKey(config.getEncryptionKey(), id) },
    users: 0,
    lastUsed: Date.now(),
  };
  openWorkspaces.set(normalized, entry);
  return entry;
}

/** The user's workspace, opened on first use. For short synchronous work (startup migration, tests). */
export function openWorkspace(email: string): Workspace {
  return openEntry(email).ws;
}

/**
 * The user's workspace, held open until `release()` (a request holds it until its response closes).
 * Idle workspaces of other users are closed along the way, so open files do not grow with every user ever seen.
 */
export function acquireWorkspace(email: string): { ws: Workspace; release: () => void } {
  const now = Date.now();
  if (now - lastEviction >= EVICT_EVERY_MS) {
    lastEviction = now;
    closeIdleWorkspaces(now);
  }
  const entry = openEntry(email);
  entry.users++;
  let released = false;
  return {
    ws: entry.ws,
    release: () => {
      if (released) return;
      released = true;
      entry.users--;
      entry.lastUsed = Date.now();
    },
  };
}

export function isWorkspaceOpen(email: string): boolean {
  return openWorkspaces.has(normalizeEmail(email));
}

function closeEntry(email: string, entry: OpenEntry): void {
  openWorkspaces.delete(email);
  try {
    entry.ws.db.close();
  } catch {
    // already closed
  }
}

/** Close one workspace if nobody holds it (the expiry sweep closes the ones it opened itself). */
export function closeWorkspaceIfUnused(email: string): void {
  const normalized = normalizeEmail(email);
  const entry = openWorkspaces.get(normalized);
  if (entry && entry.users === 0) closeEntry(normalized, entry);
}

/** Close every workspace nobody holds and nobody used for IDLE_CLOSE_MS. Returns how many were closed. */
export function closeIdleWorkspaces(now = Date.now()): number {
  let closed = 0;
  for (const [email, entry] of openWorkspaces) {
    if (entry.users === 0 && now - entry.lastUsed >= IDLE_CLOSE_MS) {
      closeEntry(email, entry);
      closed++;
    }
  }
  return closed;
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
  for (const [email, entry] of openWorkspaces) closeEntry(email, entry);
}
