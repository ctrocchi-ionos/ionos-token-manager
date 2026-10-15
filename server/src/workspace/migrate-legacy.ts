import Database from 'better-sqlite3';
import { existsSync, renameSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config, decodeJwtHeader, decodeJwtPayload } from '../config.js';
import { decryptWith, encryptWith } from '../services/crypto.js';
import { openWorkspace, type Workspace } from './registry.js';
import * as q from './queries.js';

export interface LegacyMigrationResult {
  migrated: boolean;
  owners: number;
  tokens: number;
  skippedTokens: number;
}

type Row = Record<string, unknown>;
const SUB_USER_CONTRACT = /@c(\d+)\.tokenmanager\.internal$/;

export function hasTable(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

/** False for views too: an uploaded file could define a "table" as an expensive view, so only real tables are read. */
export function hasColumn(db: Database.Database, table: string, column: string): boolean {
  if (!hasTable(db, table)) return false;
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === column);
}

export function assertKeyWorks(legacy: Database.Database, master: Buffer): void {
  const first = (sql: string) => legacy.prepare(sql).get() as { v: string } | undefined;
  const sample = (hasTable(legacy, 'user_admin_tokens') ? first('SELECT current_token_enc AS v FROM user_admin_tokens LIMIT 1') : undefined)
    ?? first('SELECT sub_user_password_enc AS v FROM managed_tokens LIMIT 1')
    ?? (hasTable(legacy, 'admin_token_state') ? first('SELECT current_token_enc AS v FROM admin_token_state LIMIT 1') : undefined);
  if (!sample) return;
  try {
    decryptWith(master, sample.v);
  } catch {
    throw new Error('Legacy database cannot be decrypted with the current ENCRYPTION_KEY. Nothing was migrated. '
      + 'Set the key that was used before and restart.');
  }
}

/** LEGACY_OWNER_EMAIL: the person who owned a single-user install, whose rows have no owner. */
export function legacyOwnerEmail(): string | null {
  const v = (process.env.LEGACY_OWNER_EMAIL || '').trim().toLowerCase();
  return v || null;
}

/** Rows whose owner column is empty: they belong to LEGACY_OWNER_EMAIL (single-user installs). */
const noOwner = (column: string) => `(${column} IS NULL OR trim(${column}) = '')`;
const NO_OWNER = noOwner('owner_email');

/** Rows of one user (bound as the single parameter); the legacy owner also gets the rows with no owner. */
const ownedBy = (column: string, isLegacyOwner: boolean) =>
  isLegacyOwner ? `(lower(trim(${column})) = ? OR ${noOwner(column)})` : `lower(trim(${column})) = ?`;

export function countOwnerlessTokens(legacy: Database.Database): number {
  return (legacy.prepare(`SELECT COUNT(*) AS c FROM managed_tokens WHERE ${NO_OWNER}`).get() as { c: number }).c;
}

/** How many of this user's rows (tokens, plus their admin token) an old database holds. */
export function countLegacyRowsFor(legacy: Database.Database, email: string, isLegacyOwner: boolean): number {
  const tokens = (legacy.prepare(`SELECT COUNT(*) AS c FROM managed_tokens WHERE ${ownedBy('owner_email', isLegacyOwner)}`).get(email) as { c: number }).c;
  return tokens + (legacyAdminTokenEnc(legacy, email, isLegacyOwner) ? 1 : 0);
}

function listOwners(legacy: Database.Database, legacyOwner: string | null): string[] {
  const owners = new Set<string>();
  if (hasTable(legacy, 'user_admin_tokens')) {
    for (const r of legacy.prepare('SELECT owner_email FROM user_admin_tokens').all() as Array<{ owner_email: string }>) {
      owners.add(r.owner_email.trim().toLowerCase());
    }
  }
  for (const r of legacy.prepare(`SELECT DISTINCT owner_email FROM managed_tokens WHERE NOT ${NO_OWNER}`).all() as Array<{ owner_email: string }>) {
    owners.add(r.owner_email.trim().toLowerCase());
  }
  if (legacyOwner) owners.add(legacyOwner);
  return [...owners];
}

/** The owner's admin token: their user_admin_tokens row, or (for the legacy owner) the old single admin_token_state row. */
function legacyAdminTokenEnc(legacy: Database.Database, email: string, isLegacyOwner: boolean): string | undefined {
  if (hasTable(legacy, 'user_admin_tokens')) {
    const row = legacy.prepare('SELECT current_token_enc AS v FROM user_admin_tokens WHERE lower(trim(owner_email)) = ?').get(email) as { v: string } | undefined;
    if (row) return row.v;
  }
  if (isLegacyOwner && hasTable(legacy, 'admin_token_state')) {
    const row = legacy.prepare('SELECT current_token_enc AS v FROM admin_token_state WHERE id = 1').get() as { v: string } | undefined;
    if (row) return row.v;
  }
  return undefined;
}

export function migrateOwner(legacy: Database.Database, ws: Workspace, master: Buffer, isLegacyOwner: boolean): { tokens: number; skipped: number } {
  const ownerFilter = ownedBy('owner_email', isLegacyOwner);
  if (ws.db.prepare("SELECT 1 FROM workspace_meta WHERE key = 'legacy_migrated'").get()) {
    // Already migrated earlier (e.g. rollback + redeploy). Never import twice, but never hide tokens either.
    const ids = legacy.prepare(`SELECT id FROM managed_tokens WHERE ${ownerFilter}`).all(ws.email) as Array<{ id: string }>;
    const missing = ids.filter((r) => !q.getManagedTokenById(ws.db, r.id)).length;
    if (missing > 0) {
      console.warn(`[Migration] ${ws.email} was migrated before; ${missing} token(s) in the old file are not in their workspace. `
        + 'They stay in the renamed old file. Restoring that file (Settings, old whole-app backup) REPLACES the user\'s current '
        + 'data, so it is only safe after they revoke every token created since; the app refuses the restore until they do.');
    }
    return { tokens: 0, skipped: missing };
  }
  let tokens = 0;
  let skipped = 0;

  const accountFor = (contract: number): string => {
    const existing = q.getAccountByContract(ws.db, contract);
    if (existing) return existing.id;
    const id = uuidv4();
    q.insertAccount(ws.db, {
      id, label: `Contract ${contract} (needs token)`, contract_number: contract,
      admin_user_id: null, token_enc: null, token_id: null, issued_at: null, expires_at: null,
    });
    return id;
  };

  ws.db.transaction(() => {
    // 1. The owner's IONOS admin token becomes their first DCD account. A broken one is skipped:
    //    the user simply adds the token again in Settings.
    const adminEnc = legacyAdminTokenEnc(legacy, ws.email, isLegacyOwner);
    if (adminEnc) {
      try {
        const raw = decryptWith(master, adminEnc);
        const payload = decodeJwtPayload(raw);
        const fields: q.AccountTokenFields = {
          admin_user_id: payload.identity.uuid,
          token_enc: encryptWith(ws.key, raw),
          token_id: decodeJwtHeader(raw).kid,
          issued_at: new Date(payload.iat * 1000).toISOString(),
          expires_at: new Date(payload.exp * 1000).toISOString(),
        };
        const contract = payload.identity.contractNumber;
        const existing = q.getAccountByContract(ws.db, contract);
        if (existing) q.updateAccountToken(ws.db, existing.id, fields);
        else q.insertAccount(ws.db, { id: uuidv4(), label: `Contract ${contract}`, contract_number: contract, ...fields });
      } catch (err) {
        console.warn(`[Migration] Admin token of ${ws.email} could not be read (${err instanceof Error ? err.message : err}); they must add it again`);
      }
    }

    // 2. Tokens, attached to the account of their contract. One bad row is skipped, never fatal.
    const hasRegen = hasColumn(legacy, 'managed_tokens', 'last_regenerated_at');
    const hasCleaned = hasColumn(legacy, 'managed_tokens', 'cleaned_up_at');
    for (const r of legacy.prepare(`SELECT * FROM managed_tokens WHERE ${ownerFilter}`).all(ws.email) as Row[]) {
      const match = SUB_USER_CONTRACT.exec(String(r.sub_user_email));
      if (!match) {
        skipped++;
        console.warn(`[Migration] Skipped token ${r.id} of ${ws.email}: cannot tell its DCD contract`);
        continue;
      }
      let passwordEnc: string;
      try {
        passwordEnc = encryptWith(ws.key, decryptWith(master, String(r.sub_user_password_enc)));
      } catch {
        skipped++;
        console.warn(`[Migration] Skipped token ${r.id} of ${ws.email}: its stored password cannot be decrypted`);
        continue;
      }
      q.insertTokenRow(ws.db, {
        id: String(r.id), account_id: accountFor(Number(match[1])), name: String(r.name), description: r.description as string | null,
        ionos_token_id: r.ionos_token_id as string | null, ionos_user_id: String(r.ionos_user_id), ionos_group_id: String(r.ionos_group_id),
        sub_user_email: String(r.sub_user_email), sub_user_password_enc: passwordEnc,
        permissions: String(r.permissions), shared_resources: String(r.shared_resources ?? '[]'), template_id: r.template_id as string | null,
        ttl_seconds: Number(r.ttl_seconds), created_at: String(r.created_at), expires_at: String(r.expires_at),
        last_regenerated_at: hasRegen ? (r.last_regenerated_at as string | null) : null,
        cleaned_up_at: hasCleaned ? (r.cleaned_up_at as string | null) : null,
        status: r.status as q.NewTokenRow['status'], cleanup_on_delete: Number(r.cleanup_on_delete),
      }, { orIgnore: true });
      tokens++;
    }

    // 3. Custom templates (before per-user templates existed, every custom template was shared: copy to everyone)
    const tpls = (!hasTable(legacy, 'permission_templates') ? []
      : hasColumn(legacy, 'permission_templates', 'owner_email')
        ? legacy.prepare(`SELECT * FROM permission_templates WHERE is_builtin = 0 AND ${ownerFilter}`).all(ws.email)
        : legacy.prepare('SELECT * FROM permission_templates WHERE is_builtin = 0').all()) as Row[];
    for (const t of tpls) {
      q.insertTemplateRow(ws.db, {
        id: String(t.id), name: String(t.name), description: t.description as string | null, permissions: String(t.permissions),
        shared_resource_types: String(t.shared_resource_types ?? '[]'), created_at: String(t.created_at), updated_at: String(t.updated_at),
      }, { orIgnore: true });
    }

    // 4. This user's own audit history (the legacy owner also gets entries from before actors were recorded)
    const audit = (hasColumn(legacy, 'audit_log', 'actor_email')
      ? legacy.prepare(`SELECT * FROM audit_log WHERE ${ownedBy('actor_email', isLegacyOwner)} ORDER BY id`).all(ws.email)
      : isLegacyOwner && hasTable(legacy, 'audit_log') ? legacy.prepare('SELECT * FROM audit_log ORDER BY id').all() : []) as Row[];
    for (const a of audit) {
      q.insertAuditRow(ws.db, {
        account_id: null, action: String(a.action), entity_type: a.entity_type as string | null, entity_id: a.entity_id as string | null,
        details: a.details as string | null, success: Number(a.success ?? 1), error_message: a.error_message as string | null,
        created_at: String(a.created_at),
      });
    }

    ws.db.prepare("INSERT INTO workspace_meta (key, value) VALUES ('legacy_migrated', datetime('now'))").run();
    q.insertAuditLog(ws.db, { action: 'workspace.migrated', details: { tokens, skipped } });
  })();

  return { tokens, skipped };
}

/** A rename target that never overwrites an earlier backup (e.g. after a rollback and redeploy). */
function freeBackupName(path: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let name = `${path}.migrated-${stamp}`;
  for (let n = 1; existsSync(name); n++) name = `${path}.migrated-${stamp}-${n}`;
  return name;
}

/** Split the old shared tokenmanager.db into per-user workspaces. Keeps the old file, renamed. */
export function migrateLegacyDatabase(): LegacyMigrationResult {
  const path = config.dbPath;
  const result: LegacyMigrationResult = { migrated: false, owners: 0, tokens: 0, skippedTokens: 0 };
  if (!existsSync(path)) return result;

  const master = config.getEncryptionKey();
  const legacyOwner = legacyOwnerEmail();
  const legacy = new Database(path);
  try {
    legacy.pragma('wal_checkpoint(TRUNCATE)');
    if (!hasColumn(legacy, 'managed_tokens', 'owner_email')) {
      throw new Error('Legacy database is too old to migrate (no owner_email). Start the previous app version once, then retry.');
    }
    assertKeyWorks(legacy, master);

    // Refuse BEFORE writing anything: ownerless tokens would otherwise be left unmanageable.
    const ownerless = countOwnerlessTokens(legacy);
    if (ownerless > 0 && !legacyOwner) {
      throw new Error(`Legacy database has ${ownerless} token(s) with no owner. Set LEGACY_OWNER_EMAIL to the person `
        + 'who owned this install and restart. Nothing was migrated.');
    }

    const owners = listOwners(legacy, legacyOwner);
    for (const email of owners) {
      const counts = migrateOwner(legacy, openWorkspace(email), master, email === legacyOwner);
      result.tokens += counts.tokens;
      result.skippedTokens += counts.skipped;
    }
    result.owners = owners.length;
  } finally {
    legacy.close();
  }

  const target = freeBackupName(path);
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(path + suffix)) renameSync(path + suffix, target + suffix);
  }
  result.migrated = true;
  console.log(`[Migration] Moved ${result.tokens} token(s) of ${result.owners} user(s) into private workspaces; old file kept as ${target}`
    + (result.skippedTokens ? `. Skipped ${result.skippedTokens} (see warnings)` : ''));
  return result;
}
