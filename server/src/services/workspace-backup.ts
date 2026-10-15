import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { decryptWith, encryptWith } from './crypto.js';
import { AppError, ValidationError } from '../middleware/error-handler.js';
import { WORKSPACE_SCHEMA_VERSION } from '../workspace/schema.js';
import { assertKeyWorks, hasColumn, hasTable, migrateOwner } from '../workspace/migrate-legacy.js';
import * as q from '../workspace/queries.js';
import { normalizeEmail, type Workspace } from '../workspace/registry.js';
import type { AccountRow, AuditRow, TemplateRow, TokenRow } from '../workspace/types.js';

export interface RestoreResult {
  format: 'workspace' | 'legacy';
  accounts: number;
  tokens: number;
  templates: number;
  skipped: number;
}

/** A consistent copy of the user's workspace file in a private temp folder. The caller deletes `dir`. */
export async function snapshotWorkspace(ws: Workspace): Promise<{ dir: string; file: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'tm-backup-'));
  const file = join(dir, 'workspace.db');
  await ws.db.backup(file);
  return { dir, file };
}

/** Remove everything the user owns (built-in templates and the legacy_migrated flag stay). Only called inside a restore transaction. */
function wipeWorkspace(ws: Workspace): void {
  ws.db.prepare('DELETE FROM managed_tokens').run();
  ws.db.prepare('DELETE FROM dcd_accounts').run();
  ws.db.prepare('DELETE FROM permission_templates WHERE is_builtin = 0').run();
  ws.db.prepare('DELETE FROM audit_log').run();
}

function countCustomTemplates(ws: Workspace): number {
  return (ws.db.prepare('SELECT COUNT(*) AS c FROM permission_templates WHERE is_builtin = 0').get() as { c: number }).c;
}

/** Only real tables are read from an uploaded file: a view with the same name could run an endless query. */
function requireTables(up: Database.Database, names: string[]): void {
  if (names.some((n) => !hasTable(up, n))) throw new ValidationError('This file is damaged or is not a Token Manager backup.');
}

/**
 * Run inside the restore transaction, after the import: a token whose IONOS sub-user still exists must not lose
 * its row, or nothing in the app could ever remove that IONOS user again. Throwing rolls the whole restore back.
 */
function refuseOrphans(ws: Workspace, live: Array<{ id: string; name: string }>): void {
  const lost = live.filter((t) => !q.getManagedTokenById(ws.db, t.id));
  if (lost.length === 0) return;
  const names = lost.slice(0, 5).map((t) => t.name).join(', ') + (lost.length > 5 ? `, and ${lost.length - 5} more` : '');
  throw new AppError(
    `This backup does not contain ${lost.length} token(s) that still have a live IONOS user (${names}). `
      + 'Revoke them on the dashboard first, otherwise their IONOS users would stay behind and could no longer be removed from this app. '
      + 'Nothing was changed.',
    'RESTORE_WOULD_ORPHAN', 409, { tokens: lost },
  );
}

const wrongKey = () => new ValidationError('This key does not match this backup. Use the key file downloaded together with it.');

const restoreFailed = (err: unknown) =>
  new ValidationError(`The backup could not be restored; nothing was changed. ${err instanceof Error ? err.message : ''}`.trim());

/** The import runs inside the caller's try/catch; the returned function builds the result after the commit, outside it. */
type Finish = () => RestoreResult;
type LiveTokens = Array<{ id: string; name: string }>;

function restoreFromWorkspaceBackup(ws: Workspace, up: Database.Database, key: Buffer, live: LiveTokens): Finish {
  requireTables(up, ['workspace_meta', 'schema_version', 'dcd_accounts', 'managed_tokens', 'permission_templates', 'audit_log']);
  const owner = (up.prepare("SELECT value FROM workspace_meta WHERE key = 'owner_email'").get() as { value: string } | undefined)?.value;
  if (!owner || normalizeEmail(owner) !== ws.email) throw new AppError('This backup belongs to another user.', 'FORBIDDEN', 403);
  const version = (up.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }).v ?? 0;
  if (version > WORKSPACE_SCHEMA_VERSION) {
    throw new ValidationError('This backup comes from a newer version of the app. Update this copy first.');
  }
  // When WORKSPACE_SCHEMA_VERSION goes above 1, map older backups' columns here.

  const sample = (up.prepare('SELECT token_enc AS v FROM dcd_accounts WHERE token_enc IS NOT NULL LIMIT 1').get()
    ?? up.prepare('SELECT sub_user_password_enc AS v FROM managed_tokens LIMIT 1').get()) as { v: string } | undefined;
  if (sample) {
    try { decryptWith(key, sample.v); } catch { throw wrongKey(); }
  }

  const reencrypt = (v: string) => encryptWith(ws.key, decryptWith(key, v));
  const accounts = up.prepare('SELECT * FROM dcd_accounts').all() as AccountRow[];
  const tokens = up.prepare('SELECT * FROM managed_tokens').all() as TokenRow[];
  const templates = up.prepare('SELECT * FROM permission_templates WHERE is_builtin = 0').all() as TemplateRow[];
  const audit = up.prepare('SELECT * FROM audit_log ORDER BY id').all() as AuditRow[];

  try {
    ws.db.transaction(() => {
      wipeWorkspace(ws);
      const insAcc = ws.db.prepare(`INSERT INTO dcd_accounts (id, label, contract_number, admin_user_id, token_enc, token_id,
        issued_at, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const a of accounts) {
        insAcc.run(a.id, a.label, a.contract_number, a.admin_user_id, a.token_enc ? reencrypt(a.token_enc) : null,
          a.token_id, a.issued_at, a.expires_at, a.created_at, a.updated_at);
      }
      for (const t of tokens) q.insertTokenRow(ws.db, { ...t, sub_user_password_enc: reencrypt(t.sub_user_password_enc) });
      for (const t of templates) q.insertTemplateRow(ws.db, t, { orIgnore: true });
      const insAud = ws.db.prepare(`INSERT INTO audit_log (account_id, action, entity_type, entity_id, details, success, error_message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const e of audit) insAud.run(e.account_id, e.action, e.entity_type, e.entity_id, e.details, e.success, e.error_message, e.created_at);
      refuseOrphans(ws, live);
    })();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw restoreFailed(err);
  }
  return () => ({ format: 'workspace', accounts: accounts.length, tokens: tokens.length, templates: templates.length, skipped: 0 });
}

/** A backup made by the old single-database app (whole database + master key): import only the caller's rows. */
function restoreFromLegacyBackup(ws: Workspace, up: Database.Database, key: Buffer, live: LiveTokens): Finish {
  requireTables(up, ['managed_tokens', 'permission_templates']);
  if (!hasColumn(up, 'managed_tokens', 'owner_email')) {
    throw new ValidationError('This backup is from a very old version and cannot be restored.');
  }
  const count = (sql: string) => (up.prepare(sql).get(ws.email) as { c: number }).c;
  const mine = count('SELECT COUNT(*) AS c FROM managed_tokens WHERE lower(trim(owner_email)) = ?')
    + (hasTable(up, 'user_admin_tokens') ? count('SELECT COUNT(*) AS c FROM user_admin_tokens WHERE lower(trim(owner_email)) = ?') : 0);
  if (mine === 0) throw new AppError('This backup has no data for your account.', 'FORBIDDEN', 403);
  try { assertKeyWorks(up, key); } catch { throw wrongKey(); }

  let counts = { tokens: 0, skipped: 0 };
  try {
    ws.db.transaction(() => {
      wipeWorkspace(ws);
      // Clear the flag so migrateOwner imports; it sets the flag again itself.
      ws.db.prepare("DELETE FROM workspace_meta WHERE key = 'legacy_migrated'").run();
      counts = migrateOwner(up, ws, key, false); // nested transaction = savepoint
      refuseOrphans(ws, live);
    })();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw restoreFailed(err);
  }
  return () => ({ format: 'legacy', accounts: q.listAccounts(ws.db).length, tokens: counts.tokens, templates: countCustomTemplates(ws), skipped: counts.skipped });
}

/** Replace the user's data with a backup (made on any copy of the app). Refuses, changing nothing, when anything is off. */
export function restoreWorkspace(ws: Workspace, file: Buffer, keyHex: string): RestoreResult {
  const hex = keyHex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new ValidationError('The key file must contain 64 hex characters.');
  const key = Buffer.from(hex, 'hex');

  const dir = mkdtempSync(join(tmpdir(), 'tm-restore-'));
  let up: Database.Database | undefined;
  try {
    const path = join(dir, 'upload.db');
    writeFileSync(path, file);
    try {
      up = new Database(path, { readonly: true, fileMustExist: true });
      up.pragma('trusted_schema = OFF'); // the file is untrusted: no side-effect functions from its schema
      up.prepare('SELECT COUNT(*) FROM sqlite_master').get();
    } catch {
      throw new ValidationError('This is not a Token Manager backup file.');
    }

    // Tokens whose IONOS user still exists right now: the restore must keep a row for each of them
    const live = q.listTokensHoldingIonosAccess(ws.db);
    let finish: Finish;
    try {
      if (hasTable(up, 'workspace_meta')) finish = restoreFromWorkspaceBackup(ws, up, key, live);
      else if (hasTable(up, 'managed_tokens')) finish = restoreFromLegacyBackup(ws, up, key, live);
      else throw new ValidationError('This is not a Token Manager backup file.');
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.warn('[Restore] Unexpected error while reading or importing a backup:', err);
      // A database that looks like ours but is missing tables or columns (damaged or hand-made)
      throw new ValidationError('This file is damaged or is not a Token Manager backup.');
    }

    const result = finish();
    q.insertAuditLog(ws.db, { action: 'workspace.restore', details: { ...result } });
    return result;
  } finally {
    up?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
