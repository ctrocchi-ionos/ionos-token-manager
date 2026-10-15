import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export const WORKSPACE_SCHEMA_VERSION = 1;

const MIGRATIONS: Record<number, string[]> = {
  1: [
    `CREATE TABLE workspace_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE dcd_accounts (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      contract_number INTEGER NOT NULL UNIQUE,
      admin_user_id TEXT,
      token_enc TEXT,
      token_id TEXT,
      issued_at TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE managed_tokens (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES dcd_accounts(id),
      name TEXT NOT NULL,
      description TEXT,
      ionos_token_id TEXT,
      ionos_user_id TEXT NOT NULL,
      ionos_group_id TEXT NOT NULL,
      sub_user_email TEXT NOT NULL,
      sub_user_password_enc TEXT NOT NULL,
      permissions TEXT NOT NULL,
      shared_resources TEXT NOT NULL DEFAULT '[]',
      template_id TEXT,
      ttl_seconds INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      last_regenerated_at TEXT,
      cleaned_up_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      cleanup_on_delete INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE INDEX idx_tokens_account ON managed_tokens(account_id, status)`,
    `CREATE INDEX idx_tokens_expires ON managed_tokens(expires_at)`,
    `CREATE TABLE permission_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      permissions TEXT NOT NULL,
      shared_resource_types TEXT NOT NULL DEFAULT '[]',
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details TEXT,
      success INTEGER NOT NULL DEFAULT 1,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX idx_audit_created ON audit_log(created_at)`,
    `CREATE INDEX idx_audit_action ON audit_log(action)`,
  ],
};

export function initializeWorkspaceSchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  for (let v = (row.v ?? 0) + 1; v <= WORKSPACE_SCHEMA_VERSION; v++) {
    db.transaction(() => {
      for (const sql of MIGRATIONS[v]) db.exec(sql);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(v);
    })();
  }
}

const BUILTIN_TEMPLATES: Array<{ name: string; description: string; permissions: Record<string, boolean> }> = [
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

/** Insert any missing built-in template (matched by name). Safe to run on every open. */
export function seedBuiltinTemplates(db: Database.Database): void {
  const insert = db.prepare(`INSERT OR IGNORE INTO permission_templates (id, name, description, permissions, shared_resource_types, is_builtin)
    VALUES (?, ?, ?, ?, '[]', 1)`);
  db.transaction(() => {
    for (const t of BUILTIN_TEMPLATES) insert.run(uuidv4(), t.name, t.description, JSON.stringify(t.permissions));
  })();
}
