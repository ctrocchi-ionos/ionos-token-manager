import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import Database from 'better-sqlite3';
import { decryptWith, deriveWorkspaceKey, encryptWith } from './crypto.js';
import { workspaceIdFor } from '../workspace/registry.js';
import { readOwner, sampleSecret } from '../workspace/queries.js';

export type MasterKeySource = 'env' | 'data-file' | 'generated-env' | 'generated-data-file';

const CHECK_TEXT = 'ionos-token-manager master key check v1';
const KEY_FILE = 'encryption.key';
const CHECK_FILE = 'key-check';

function hasExistingData(dataDir: string): boolean {
  if (existsSync(join(dataDir, 'tokenmanager.db')) || existsSync(join(dataDir, CHECK_FILE))) return true;
  const ws = join(dataDir, 'workspaces');
  return existsSync(ws) && readdirSync(ws).length > 0;
}

/** Append the key to an existing .env (local installs). Never creates the file. */
function appendToDotEnv(dotEnvPath: string, key: string): boolean {
  if (!existsSync(dotEnvPath)) return false;
  try {
    appendFileSync(dotEnvPath,
      `\n# Master key, generated ${new Date().toISOString()}. Keep a copy somewhere safe:\n`
      + `# without it, stored tokens cannot be read. Never change it on an existing install.\nENCRYPTION_KEY=${key}\n`);
    return true;
  } catch {
    return false;
  }
}

/** Where the master key comes from. Refuses rather than generating a new key over existing data. */
export function resolveMasterKey(opts: { envKey: string; dataDir: string; dotEnvPath: string }): { key: string; source: MasterKeySource } {
  if (opts.envKey) return { key: opts.envKey, source: 'env' };

  const keyFile = join(opts.dataDir, KEY_FILE);
  if (existsSync(keyFile)) {
    console.warn(`[MasterKey] Using ${keyFile}. Copy its value into ENCRYPTION_KEY in .env, and keep the file as a safety copy.`);
    return { key: readFileSync(keyFile, 'utf-8').trim(), source: 'data-file' };
  }

  if (hasExistingData(opts.dataDir)) {
    throw new Error('Refusing to start: ENCRYPTION_KEY is missing, but this app already has data. '
      + 'Put the original key back into .env (ENCRYPTION_KEY=...). Nothing was changed.');
  }

  const key = randomBytes(32).toString('hex');
  // Always keep a copy next to the data: if a managed .env is ever rebuilt without it, nothing is lost.
  writeFileSync(keyFile, key, { mode: 0o600 });
  if (appendToDotEnv(opts.dotEnvPath, key)) {
    console.log(`[MasterKey] New install: generated a master key, added it to .env and kept a copy in ${keyFile}. Keep a copy somewhere safe.`);
    return { key, source: 'generated-env' };
  }
  console.warn(`[MasterKey] New install: generated a master key in ${keyFile}. Copy it into ENCRYPTION_KEY in .env.`);
  return { key, source: 'generated-data-file' };
}

/** One stored secret from one workspace on disk, with that workspace's id (its key is derived from it). */
function sampleWorkspaceSecret(dataDir: string): { id: string; enc: string } | undefined {
  const root = join(dataDir, 'workspaces');
  if (!existsSync(root)) return undefined;
  for (const id of readdirSync(root)) {
    const file = join(root, id, 'workspace.db');
    if (!existsSync(file)) continue;
    let db: Database.Database | undefined;
    try {
      db = new Database(file, { readonly: true, fileMustExist: true });
      const owner = readOwner(db);
      if (!owner || workspaceIdFor(owner) !== id) continue; // the app ignores such folders too
      const enc = sampleSecret(db);
      if (enc) return { id, enc };
    } catch {
      // An unreadable file says nothing about the key; try the next workspace
    } finally {
      db?.close();
    }
  }
  return undefined;
}

/**
 * Refuse a key that differs from the one this data was created with.
 * With a fingerprint, compare against it. Without one (a crash before it was written, or the file was deleted)
 * but with workspaces on disk, decrypt one stored secret instead, so a wrong key is never accepted and recorded.
 */
export function verifyMasterKey(key: string, dataDir: string): void {
  const checkFile = join(dataDir, CHECK_FILE);
  if (!existsSync(checkFile)) {
    const sample = sampleWorkspaceSecret(dataDir);
    if (!sample) return; // brand-new install, or no secret stored yet: nothing to check against
    try {
      decryptWith(deriveWorkspaceKey(Buffer.from(key, 'hex'), sample.id), sample.enc);
    } catch {
      throw new Error('Refusing to start: ENCRYPTION_KEY cannot read the existing data (the key-check file is missing, '
        + 'so a stored secret was tested instead). Put the original key back. Nothing was changed.');
    }
    return;
  }
  let ok = false;
  try {
    ok = decryptWith(Buffer.from(key, 'hex'), readFileSync(checkFile, 'utf-8').trim()) === CHECK_TEXT;
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new Error('Refusing to start: ENCRYPTION_KEY does not match the key this data was created with. '
      + 'Put the original key back. Nothing was changed.');
  }
}

/** Write the fingerprint once, after a successful start (so a wrong key is never recorded). */
export function recordMasterKey(key: string, dataDir: string): void {
  const checkFile = join(dataDir, CHECK_FILE);
  if (existsSync(checkFile)) return;
  writeFileSync(checkFile, encryptWith(Buffer.from(key, 'hex'), CHECK_TEXT), { mode: 0o600 });
}
