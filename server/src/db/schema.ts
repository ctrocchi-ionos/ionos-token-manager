import { getDb } from './connection.js';

const CURRENT_VERSION = 1;

const MIGRATIONS: Record<number, string[]> = {
  1: [
    `CREATE TABLE IF NOT EXISTS managed_tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      ionos_token_id TEXT,
      ionos_user_id TEXT NOT NULL,
      ionos_group_id TEXT NOT NULL,
      sub_user_email TEXT NOT NULL,
      sub_user_password_enc TEXT NOT NULL,
      permissions JSON NOT NULL,
      shared_resources JSON DEFAULT '[]',
      template_id TEXT,
      ttl_seconds INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      cleanup_on_delete INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tokens_status ON managed_tokens(status)`,
    `CREATE INDEX IF NOT EXISTS idx_tokens_expires ON managed_tokens(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_tokens_name ON managed_tokens(name)`,

    `CREATE TABLE IF NOT EXISTS permission_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      permissions JSON NOT NULL,
      shared_resource_types JSON DEFAULT '[]',
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details JSON,
      ionos_request_ids JSON,
      success INTEGER NOT NULL DEFAULT 1,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)`,

    `CREATE TABLE IF NOT EXISTS admin_token_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      current_token_enc TEXT NOT NULL,
      token_id TEXT,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      renewal_ttl_seconds INTEGER NOT NULL DEFAULT 2592000,
      renewal_threshold_seconds INTEGER NOT NULL DEFAULT 604800,
      last_renewal_at TEXT,
      last_renewal_error TEXT,
      auto_renew_enabled INTEGER NOT NULL DEFAULT 1
    )`,
  ],
};

export function initializeDatabase(): void {
  const db = getDb();

  // Create version tracking table
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // Get current version
  const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as
    | { version: number | null }
    | undefined;
  const currentVersion = row?.version ?? 0;

  // Run pending migrations
  for (let v = currentVersion + 1; v <= CURRENT_VERSION; v++) {
    const statements = MIGRATIONS[v];
    if (!statements) continue;

    const migrate = db.transaction(() => {
      for (const sql of statements) {
        db.exec(sql);
      }
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(v);
    });
    migrate();
    console.log(`Database migrated to version ${v}`);
  }
}
