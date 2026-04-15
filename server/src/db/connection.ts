import { existsSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import Database from 'better-sqlite3';
import { config } from '../config.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export async function backupDatabase(destPath: string): Promise<void> {
  await getDb().backup(destPath);
}

export function replaceDatabase(newDbBuffer: Buffer): void {
  const tempPath = config.dbPath + '.restore';
  const backupPath = config.dbPath + '.bak';

  // Write and validate the incoming file before touching the live DB
  writeFileSync(tempPath, newDbBuffer);
  try {
    const testDb = new Database(tempPath, { readonly: true });
    const row = testDb.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number } | undefined;
    testDb.close();
    if (!row || row.v < 1) throw new Error('Schema version not found');
  } catch (err) {
    try { unlinkSync(tempPath); } catch {}
    throw new Error(`Invalid database file: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Checkpoint WAL so the current DB is fully flushed before we close it
  getDb().pragma('wal_checkpoint(TRUNCATE)');
  closeDb();

  // Swap: current → .bak, incoming → live
  if (existsSync(config.dbPath)) renameSync(config.dbPath, backupPath);
  renameSync(tempPath, config.dbPath);

  // Reopen with fresh connection
  getDb();
}
