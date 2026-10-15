import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { PermissionFlags } from '../types/app.js';
import type { AccountRow, AuditRow, TemplateRow, TokenRow, TokenStatus } from './types.js';

type DB = Database.Database;

// ── DCD accounts ──

export type AccountTokenFields = Pick<AccountRow, 'admin_user_id' | 'token_enc' | 'token_id' | 'issued_at' | 'expires_at'>;

export function insertAccount(db: DB, a: Omit<AccountRow, 'created_at' | 'updated_at'>): void {
  db.prepare(`INSERT INTO dcd_accounts (id, label, contract_number, admin_user_id, token_enc, token_id, issued_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(a.id, a.label, a.contract_number, a.admin_user_id, a.token_enc, a.token_id, a.issued_at, a.expires_at);
}

/** Insert a complete account row, keeping its original timestamps (restore). */
export function insertAccountRow(db: DB, a: AccountRow): void {
  db.prepare(`INSERT INTO dcd_accounts (id, label, contract_number, admin_user_id, token_enc, token_id, issued_at, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(a.id, a.label, a.contract_number, a.admin_user_id, a.token_enc, a.token_id, a.issued_at, a.expires_at, a.created_at, a.updated_at);
}

export function getAccount(db: DB, id: string): AccountRow | undefined {
  return db.prepare('SELECT * FROM dcd_accounts WHERE id = ?').get(id) as AccountRow | undefined;
}

export function getAccountByContract(db: DB, contractNumber: number): AccountRow | undefined {
  return db.prepare('SELECT * FROM dcd_accounts WHERE contract_number = ?').get(contractNumber) as AccountRow | undefined;
}

export function listAccounts(db: DB): AccountRow[] {
  return db.prepare('SELECT * FROM dcd_accounts ORDER BY label COLLATE NOCASE, contract_number').all() as AccountRow[];
}

export function updateAccountToken(db: DB, id: string, t: AccountTokenFields): void {
  db.prepare(`UPDATE dcd_accounts SET admin_user_id = ?, token_enc = ?, token_id = ?, issued_at = ?, expires_at = ?,
    updated_at = datetime('now') WHERE id = ?`)
    .run(t.admin_user_id, t.token_enc, t.token_id, t.issued_at, t.expires_at, id);
}

export function renameAccount(db: DB, id: string, label: string): void {
  db.prepare("UPDATE dcd_accounts SET label = ?, updated_at = datetime('now') WHERE id = ?").run(label, id);
}

/** Tokens whose IONOS sub-user still exists: active, or expired but not cleaned up yet. */
const HOLDS_IONOS_ACCESS = "(status = 'active' OR (status = 'expired' AND cleanup_on_delete = 1 AND cleaned_up_at IS NULL))";

export function countTokensHoldingIonosAccess(db: DB, accountId: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM managed_tokens WHERE account_id = ? AND ${HOLDS_IONOS_ACCESS}`)
    .get(accountId) as { c: number }).c;
}

/** Every token in the workspace whose IONOS sub-user still exists (same rule as above, all accounts). */
export function listTokensHoldingIonosAccess(db: DB): Array<{ id: string; name: string }> {
  return db.prepare(`SELECT id, name FROM managed_tokens WHERE ${HOLDS_IONOS_ACCESS} ORDER BY created_at`).all() as Array<{ id: string; name: string }>;
}

export function deleteAccount(db: DB, id: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM managed_tokens WHERE account_id = ?').run(id);
    db.prepare('DELETE FROM dcd_accounts WHERE id = ?').run(id);
  })();
}

// ── Managed tokens ──

export type NewTokenRow = Omit<TokenRow, 'created_at' | 'last_regenerated_at' | 'cleaned_up_at'>;

export interface TokenFilters {
  accountId?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export function insertManagedToken(db: DB, t: NewTokenRow): void {
  db.prepare(`INSERT INTO managed_tokens (id, account_id, name, description, ionos_token_id, ionos_user_id, ionos_group_id,
      sub_user_email, sub_user_password_enc, permissions, shared_resources, template_id, ttl_seconds, expires_at, status, cleanup_on_delete)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(t.id, t.account_id, t.name, t.description, t.ionos_token_id, t.ionos_user_id, t.ionos_group_id,
      t.sub_user_email, t.sub_user_password_enc, t.permissions, t.shared_resources, t.template_id,
      t.ttl_seconds, t.expires_at, t.status, t.cleanup_on_delete);
}

/** Insert a complete token row, keeping its original timestamps (migration and restore). */
export function insertTokenRow(db: DB, t: TokenRow, opts: { orIgnore?: boolean } = {}): void {
  db.prepare(`INSERT ${opts.orIgnore ? 'OR IGNORE ' : ''}INTO managed_tokens (id, account_id, name, description, ionos_token_id,
      ionos_user_id, ionos_group_id, sub_user_email, sub_user_password_enc, permissions, shared_resources, template_id,
      ttl_seconds, created_at, expires_at, last_regenerated_at, cleaned_up_at, status, cleanup_on_delete)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(t.id, t.account_id, t.name, t.description, t.ionos_token_id, t.ionos_user_id, t.ionos_group_id,
      t.sub_user_email, t.sub_user_password_enc, t.permissions, t.shared_resources, t.template_id,
      t.ttl_seconds, t.created_at, t.expires_at, t.last_regenerated_at, t.cleaned_up_at, t.status, t.cleanup_on_delete);
}

export function getManagedTokenById(db: DB, id: string): TokenRow | undefined {
  return db.prepare('SELECT * FROM managed_tokens WHERE id = ?').get(id) as TokenRow | undefined;
}

export function listManagedTokens(db: DB, f: TokenFilters): { items: TokenRow[]; total: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (f.accountId) { conditions.push('account_id = ?'); params.push(f.accountId); }
  if (f.status && f.status !== 'all') {
    if (f.status === 'expiring_soon') {
      conditions.push("status = 'active' AND datetime(expires_at) <= datetime('now', '+7 days')");
    } else {
      conditions.push('status = ?');
      params.push(f.status);
    }
  }
  if (f.search) {
    conditions.push('(name LIKE ? OR description LIKE ?)');
    params.push(`%${f.search}%`, `%${f.search}%`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM managed_tokens ${where}`).get(...params) as { c: number }).c;
  const page = f.page ?? 1;
  const limit = f.limit ?? 50;
  const items = db.prepare(`SELECT * FROM managed_tokens ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit) as TokenRow[];
  return { items, total };
}

export function updateManagedTokenStatus(db: DB, id: string, status: TokenStatus): void {
  db.prepare('UPDATE managed_tokens SET status = ? WHERE id = ?').run(status, id);
}

/**
 * Record a regenerated IONOS token. Returns false, changing nothing, when the row is gone, revoked or cleaned up
 * by now: a regenerate must never bring such a token back to 'active'.
 */
export function updateManagedTokenIonosId(db: DB, id: string, ionosTokenId: string, expiresAt: string): boolean {
  return db.prepare(`UPDATE managed_tokens SET ionos_token_id = ?, expires_at = ?, status = 'active',
    last_regenerated_at = datetime('now') WHERE id = ? AND status != 'revoked' AND cleaned_up_at IS NULL`)
    .run(ionosTokenId, expiresAt, id).changes > 0;
}

export function deleteManagedToken(db: DB, id: string): void {
  db.prepare('DELETE FROM managed_tokens WHERE id = ?').run(id);
}

/** Flip active tokens past their expiry to 'expired'. Returns how many changed. */
export function markExpiredTokens(db: DB, accountId?: string): number {
  const sql = `UPDATE managed_tokens SET status = 'expired'
    WHERE status = 'active' AND datetime(expires_at) <= datetime('now')${accountId ? ' AND account_id = ?' : ''}`;
  return (accountId ? db.prepare(sql).run(accountId) : db.prepare(sql).run()).changes;
}

export function getTokenStats(db: DB, accountId: string): { active: number; expiringSoon: number; expired: number; revoked: number; total: number } {
  const count = (cond: string) =>
    (db.prepare(`SELECT COUNT(*) AS c FROM managed_tokens WHERE account_id = ? ${cond}`).get(accountId) as { c: number }).c;
  return {
    active: count("AND status = 'active' AND datetime(expires_at) > datetime('now', '+7 days')"),
    expiringSoon: count("AND status = 'active' AND datetime(expires_at) <= datetime('now', '+7 days') AND datetime(expires_at) > datetime('now')"),
    expired: count("AND status = 'expired'"),
    revoked: count("AND status = 'revoked'"),
    total: count(''),
  };
}

const DUE_FOR_CLEANUP = `status IN ('active', 'expired') AND cleanup_on_delete = 1 AND cleaned_up_at IS NULL
  AND datetime(expires_at) <= datetime('now', ?)`;
const graceModifier = (graceDays: number) => `-${Math.max(0, Math.floor(graceDays))} days`;

/** Expired tokens whose IONOS user/group still exist and have been expired longer than graceDays. */
export function getTokensDueForCleanup(db: DB, graceDays: number): TokenRow[] {
  return db.prepare(`SELECT * FROM managed_tokens WHERE ${DUE_FOR_CLEANUP}`).all(graceModifier(graceDays)) as TokenRow[];
}

/** The same rule for one token, read now (it may have been regenerated or revoked since the list was read). */
export function getTokenIfDueForCleanup(db: DB, id: string, graceDays: number): TokenRow | undefined {
  return db.prepare(`SELECT * FROM managed_tokens WHERE id = ? AND ${DUE_FOR_CLEANUP}`).get(id, graceModifier(graceDays)) as TokenRow | undefined;
}

export function markTokenCleanedUp(db: DB, id: string): void {
  db.prepare("UPDATE managed_tokens SET status = 'expired', cleaned_up_at = datetime('now') WHERE id = ?").run(id);
}

// ── Permission templates ──

export function insertPermissionTemplate(db: DB, t: {
  name: string;
  description?: string;
  permissions: PermissionFlags;
  sharedResourceTypes?: string[];
}): TemplateRow {
  const id = uuidv4();
  db.prepare(`INSERT INTO permission_templates (id, name, description, permissions, shared_resource_types, is_builtin)
    VALUES (?, ?, ?, ?, ?, 0)`)
    .run(id, t.name, t.description ?? null, JSON.stringify(t.permissions), JSON.stringify(t.sharedResourceTypes ?? []));
  return getPermissionTemplateById(db, id)!;
}

/** Insert a complete custom-template row, keeping its original timestamps (migration and restore). */
export function insertTemplateRow(db: DB, t: Omit<TemplateRow, 'is_builtin'>, opts: { orIgnore?: boolean } = {}): void {
  db.prepare(`INSERT ${opts.orIgnore ? 'OR IGNORE ' : ''}INTO permission_templates
      (id, name, description, permissions, shared_resource_types, is_builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(t.id, t.name, t.description, t.permissions, t.shared_resource_types, t.created_at, t.updated_at);
}

export function getPermissionTemplateById(db: DB, id: string): TemplateRow | undefined {
  return db.prepare('SELECT * FROM permission_templates WHERE id = ?').get(id) as TemplateRow | undefined;
}

export function listPermissionTemplates(db: DB): TemplateRow[] {
  return db.prepare('SELECT * FROM permission_templates ORDER BY is_builtin DESC, name ASC').all() as TemplateRow[];
}

export function updatePermissionTemplate(db: DB, id: string, update: {
  name?: string;
  description?: string;
  permissions?: PermissionFlags;
  sharedResourceTypes?: string[];
}): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (update.name !== undefined) { sets.push('name = ?'); params.push(update.name); }
  if (update.description !== undefined) { sets.push('description = ?'); params.push(update.description); }
  if (update.permissions !== undefined) { sets.push('permissions = ?'); params.push(JSON.stringify(update.permissions)); }
  if (update.sharedResourceTypes !== undefined) { sets.push('shared_resource_types = ?'); params.push(JSON.stringify(update.sharedResourceTypes)); }
  sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE permission_templates SET ${sets.join(', ')} WHERE id = ? AND is_builtin = 0`).run(...params, id);
}

export function deletePermissionTemplate(db: DB, id: string): boolean {
  return db.prepare('DELETE FROM permission_templates WHERE id = ? AND is_builtin = 0').run(id).changes > 0;
}

export function templateExistsByName(db: DB, name: string): boolean {
  return !!db.prepare('SELECT 1 FROM permission_templates WHERE name = ?').get(name);
}

// ── Audit log ──

/** A complete audit row, keeping its original timestamp (migration and restore). */
export type AuditRowInput = Omit<AuditRow, 'id'>;

export interface AuditInput {
  action: string;
  accountId?: string | null;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  success?: boolean;
  errorMessage?: string;
}

export interface AuditFilters {
  action?: string;
  entityType?: string;
  accountId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export function insertAuditLog(db: DB, e: AuditInput): void {
  db.prepare(`INSERT INTO audit_log (account_id, action, entity_type, entity_id, details, success, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(e.accountId ?? null, e.action, e.entityType ?? null, e.entityId ?? null,
      e.details ? JSON.stringify(e.details) : null, e.success === false ? 0 : 1, e.errorMessage ?? null);
}

export function insertAuditRow(db: DB, e: AuditRowInput): void {
  db.prepare(`INSERT INTO audit_log (account_id, action, entity_type, entity_id, details, success, error_message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(e.account_id, e.action, e.entity_type, e.entity_id, e.details, e.success, e.error_message, e.created_at);
}

export function listAuditLog(db: DB, f: AuditFilters): { items: AuditRow[]; total: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (f.accountId) { conditions.push('account_id = ?'); params.push(f.accountId); }
  if (f.action) { conditions.push('action = ?'); params.push(f.action); }
  if (f.entityType) { conditions.push('entity_type = ?'); params.push(f.entityType); }
  if (f.from) { conditions.push('created_at >= ?'); params.push(f.from); }
  if (f.to) { conditions.push('created_at <= ?'); params.push(f.to); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM audit_log ${where}`).get(...params) as { c: number }).c;
  const page = f.page ?? 1;
  const limit = f.limit ?? 50;
  const items = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit) as AuditRow[];
  return { items, total };
}

// ── Workspace file ──

/** The email recorded as the owner of a workspace file. */
export function readOwner(db: DB): string | undefined {
  return (db.prepare("SELECT value FROM workspace_meta WHERE key = 'owner_email'").get() as { value: string } | undefined)?.value;
}

/** One encrypted secret from a workspace file (an admin token, else a sub-user password), to test a key against. */
export function sampleSecret(db: DB): string | undefined {
  const row = (db.prepare('SELECT token_enc AS v FROM dcd_accounts WHERE token_enc IS NOT NULL LIMIT 1').get()
    ?? db.prepare('SELECT sub_user_password_enc AS v FROM managed_tokens LIMIT 1').get()) as { v: string } | undefined;
  return row?.v;
}
