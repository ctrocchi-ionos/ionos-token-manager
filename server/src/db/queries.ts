import { v4 as uuidv4 } from 'uuid';
import { getDb } from './connection.js';
import type {
  ManagedToken,
  PermissionTemplate,
  AuditLogEntry,
  AdminTokenState,
  PermissionFlags,
} from '../types/app.js';

// ── Managed Tokens ──

export function insertManagedToken(token: Omit<ManagedToken, 'created_at'>): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO managed_tokens (id, name, description, ionos_token_id, ionos_user_id, ionos_group_id,
      sub_user_email, sub_user_password_enc, permissions, shared_resources, template_id,
      ttl_seconds, expires_at, status, cleanup_on_delete)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    token.id, token.name, token.description, token.ionos_token_id,
    token.ionos_user_id, token.ionos_group_id, token.sub_user_email,
    token.sub_user_password_enc, token.permissions, token.shared_resources,
    token.template_id, token.ttl_seconds, token.expires_at, token.status,
    token.cleanup_on_delete,
  );
}

export function getManagedTokenById(id: string): ManagedToken | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM managed_tokens WHERE id = ?').get(id) as ManagedToken | undefined;
}

export function listManagedTokens(filters?: {
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}): { items: ManagedToken[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.status && filters.status !== 'all') {
    if (filters.status === 'expiring_soon') {
      conditions.push("status = 'active' AND datetime(expires_at) <= datetime('now', '+7 days')");
    } else {
      conditions.push('status = ?');
      params.push(filters.status);
    }
  }

  if (filters?.search) {
    conditions.push('(name LIKE ? OR description LIKE ?)');
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) as count FROM managed_tokens ${where}`).get(...params) as { count: number }).count;

  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 50;
  const offset = (page - 1) * limit;

  const items = db.prepare(
    `SELECT * FROM managed_tokens ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as ManagedToken[];

  return { items, total };
}

export function updateManagedTokenStatus(id: string, status: string): void {
  const db = getDb();
  db.prepare('UPDATE managed_tokens SET status = ? WHERE id = ?').run(status, id);
}

export function updateManagedTokenIonosId(id: string, ionosTokenId: string, expiresAt: string): void {
  const db = getDb();
  db.prepare('UPDATE managed_tokens SET ionos_token_id = ?, expires_at = ?, status = ? WHERE id = ?')
    .run(ionosTokenId, expiresAt, 'active', id);
}

export function deleteManagedToken(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM managed_tokens WHERE id = ?').run(id);
}

export function getExpiredTokens(): ManagedToken[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM managed_tokens WHERE status = 'active' AND datetime(expires_at) <= datetime('now')"
  ).all() as ManagedToken[];
}

export function getTokenStats(): { active: number; expiringSoon: number; expired: number; revoked: number; total: number } {
  const db = getDb();
  const active = (db.prepare("SELECT COUNT(*) as c FROM managed_tokens WHERE status = 'active' AND datetime(expires_at) > datetime('now', '+7 days')").get() as { c: number }).c;
  const expiringSoon = (db.prepare("SELECT COUNT(*) as c FROM managed_tokens WHERE status = 'active' AND datetime(expires_at) <= datetime('now', '+7 days') AND datetime(expires_at) > datetime('now')").get() as { c: number }).c;
  const expired = (db.prepare("SELECT COUNT(*) as c FROM managed_tokens WHERE status = 'expired'").get() as { c: number }).c;
  const revoked = (db.prepare("SELECT COUNT(*) as c FROM managed_tokens WHERE status = 'revoked'").get() as { c: number }).c;
  const total = (db.prepare("SELECT COUNT(*) as c FROM managed_tokens").get() as { c: number }).c;
  return { active, expiringSoon, expired, revoked, total };
}

// ── Permission Templates ──

export function insertPermissionTemplate(template: {
  name: string;
  description?: string;
  permissions: PermissionFlags;
  sharedResourceTypes?: string[];
  isBuiltin?: boolean;
}): PermissionTemplate {
  const db = getDb();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO permission_templates (id, name, description, permissions, shared_resource_types, is_builtin)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id, template.name, template.description ?? null,
    JSON.stringify(template.permissions),
    JSON.stringify(template.sharedResourceTypes ?? []),
    template.isBuiltin ? 1 : 0,
  );
  return getPermissionTemplateById(id)!;
}

export function getPermissionTemplateById(id: string): PermissionTemplate | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM permission_templates WHERE id = ?').get(id) as PermissionTemplate | undefined;
}

export function listPermissionTemplates(): PermissionTemplate[] {
  const db = getDb();
  return db.prepare('SELECT * FROM permission_templates ORDER BY is_builtin DESC, name ASC').all() as PermissionTemplate[];
}

export function updatePermissionTemplate(id: string, update: {
  name?: string;
  description?: string;
  permissions?: PermissionFlags;
  sharedResourceTypes?: string[];
}): void {
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (update.name !== undefined) { sets.push('name = ?'); params.push(update.name); }
  if (update.description !== undefined) { sets.push('description = ?'); params.push(update.description); }
  if (update.permissions !== undefined) { sets.push('permissions = ?'); params.push(JSON.stringify(update.permissions)); }
  if (update.sharedResourceTypes !== undefined) { sets.push('shared_resource_types = ?'); params.push(JSON.stringify(update.sharedResourceTypes)); }
  sets.push("updated_at = datetime('now')");

  params.push(id);
  db.prepare(`UPDATE permission_templates SET ${sets.join(', ')} WHERE id = ? AND is_builtin = 0`).run(...params);
}

export function deletePermissionTemplate(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM permission_templates WHERE id = ? AND is_builtin = 0').run(id);
  return result.changes > 0;
}

export function templateExistsByName(name: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM permission_templates WHERE name = ?').get(name);
  return !!row;
}

// ── Audit Log ──

export function insertAuditLog(entry: {
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ionosRequestIds?: string[];
  success?: boolean;
  errorMessage?: string;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO audit_log (action, entity_type, entity_id, details, ionos_request_ids, success, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.action, entry.entityType ?? null, entry.entityId ?? null,
    entry.details ? JSON.stringify(entry.details) : null,
    entry.ionosRequestIds ? JSON.stringify(entry.ionosRequestIds) : null,
    entry.success !== false ? 1 : 0,
    entry.errorMessage ?? null,
  );
}

export function listAuditLog(filters?: {
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}): { items: AuditLogEntry[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.action) { conditions.push('action = ?'); params.push(filters.action); }
  if (filters?.entityType) { conditions.push('entity_type = ?'); params.push(filters.entityType); }
  if (filters?.from) { conditions.push('created_at >= ?'); params.push(filters.from); }
  if (filters?.to) { conditions.push('created_at <= ?'); params.push(filters.to); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`).get(...params) as { count: number }).count;

  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 50;
  const offset = (page - 1) * limit;

  const items = db.prepare(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as AuditLogEntry[];

  return { items, total };
}

// ── Admin Token State ──

export function getAdminTokenState(): AdminTokenState | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM admin_token_state WHERE id = 1').get() as AdminTokenState | undefined;
}

export function upsertAdminTokenState(state: {
  currentTokenEnc: string;
  tokenId: string | null;
  issuedAt: string;
  expiresAt: string;
  renewalTtlSeconds?: number;
  renewalThresholdSeconds?: number;
  autoRenewEnabled?: boolean;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO admin_token_state (id, current_token_enc, token_id, issued_at, expires_at,
      renewal_ttl_seconds, renewal_threshold_seconds, auto_renew_enabled)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      current_token_enc = excluded.current_token_enc,
      token_id = excluded.token_id,
      issued_at = excluded.issued_at,
      expires_at = excluded.expires_at,
      renewal_ttl_seconds = COALESCE(excluded.renewal_ttl_seconds, admin_token_state.renewal_ttl_seconds),
      renewal_threshold_seconds = COALESCE(excluded.renewal_threshold_seconds, admin_token_state.renewal_threshold_seconds),
      auto_renew_enabled = COALESCE(excluded.auto_renew_enabled, admin_token_state.auto_renew_enabled)
  `).run(
    state.currentTokenEnc, state.tokenId, state.issuedAt, state.expiresAt,
    state.renewalTtlSeconds ?? 2592000, state.renewalThresholdSeconds ?? 604800,
    state.autoRenewEnabled !== false ? 1 : 0,
  );
}

export function updateAdminTokenRenewal(update: {
  currentTokenEnc?: string;
  tokenId?: string;
  issuedAt?: string;
  expiresAt?: string;
  lastRenewalAt?: string;
  lastRenewalError?: string | null;
}): void {
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (update.currentTokenEnc !== undefined) { sets.push('current_token_enc = ?'); params.push(update.currentTokenEnc); }
  if (update.tokenId !== undefined) { sets.push('token_id = ?'); params.push(update.tokenId); }
  if (update.issuedAt !== undefined) { sets.push('issued_at = ?'); params.push(update.issuedAt); }
  if (update.expiresAt !== undefined) { sets.push('expires_at = ?'); params.push(update.expiresAt); }
  if (update.lastRenewalAt !== undefined) { sets.push('last_renewal_at = ?'); params.push(update.lastRenewalAt); }
  if (update.lastRenewalError !== undefined) { sets.push('last_renewal_error = ?'); params.push(update.lastRenewalError); }

  if (sets.length === 0) return;
  db.prepare(`UPDATE admin_token_state SET ${sets.join(', ')} WHERE id = 1`).run(...params);
}

export function updateAdminTokenConfig(update: {
  renewalTtlSeconds?: number;
  renewalThresholdSeconds?: number;
  autoRenewEnabled?: boolean;
}): void {
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (update.renewalTtlSeconds !== undefined) { sets.push('renewal_ttl_seconds = ?'); params.push(update.renewalTtlSeconds); }
  if (update.renewalThresholdSeconds !== undefined) { sets.push('renewal_threshold_seconds = ?'); params.push(update.renewalThresholdSeconds); }
  if (update.autoRenewEnabled !== undefined) { sets.push('auto_renew_enabled = ?'); params.push(update.autoRenewEnabled ? 1 : 0); }

  if (sets.length === 0) return;
  db.prepare(`UPDATE admin_token_state SET ${sets.join(', ')} WHERE id = 1`).run(...params);
}

// ── Seed Built-in Templates ──

export function seedBuiltinTemplates(): void {
  const templates = [
    { name: 'AI Model Hub', description: 'AI Model Hub access only', permissions: { accessAndManageAiModelHub: true } },
    { name: 'S3 Only', description: 'Object storage access only', permissions: { s3Privilege: true } },
    { name: 'Read-Only Monitoring', description: 'View activity logs and monitoring data', permissions: { accessActivityLog: true, accessAndManageMonitoring: true } },
    { name: 'Kubernetes Developer', description: 'Create and manage Kubernetes clusters and container registry', permissions: { createK8sCluster: true, manageRegistry: true, accessAndManageKaas: true } },
    { name: 'Database Admin', description: 'Full DBaaS and Data Platform management', permissions: { manageDBaaS: true, manageDataplatform: true } },
    { name: 'Network Engineer', description: 'DNS, VPN, CDN, and API Gateway management', permissions: { accessAndManageDns: true, accessAndManageCdn: true, accessAndManageVpn: true, accessAndManageApiGateway: true, createPcc: true } },
    { name: 'Full DevOps', description: 'All compute, storage, Kubernetes, and monitoring permissions', permissions: { createDataCenter: true, createSnapshot: true, reserveIp: true, createPcc: true, s3Privilege: true, createBackupUnit: true, createInternetAccess: true, createK8sCluster: true, createFlowLog: true, accessActivityLog: true, accessAndManageMonitoring: true, accessAndManageCertificates: true, manageDBaaS: true, manageRegistry: true, accessAndManageLogging: true, manageDataplatform: true, createNetworkSecurityGroups: true } },
    { name: 'AI / ML Engineer', description: 'AI Model Hub and S3 storage access', permissions: { accessAndManageAiModelHub: true, s3Privilege: true } },
    { name: 'Security Auditor', description: 'Read-only access to logs, monitoring, certificates, and IAM', permissions: { accessActivityLog: true, accessAndManageMonitoring: true, accessAndManageCertificates: true, accessAndManageLogging: true, accessAndManageIamResources: true } },
  ];

  for (const t of templates) {
    if (!templateExistsByName(t.name)) {
      insertPermissionTemplate({ ...t, isBuiltin: true });
    }
  }
}
