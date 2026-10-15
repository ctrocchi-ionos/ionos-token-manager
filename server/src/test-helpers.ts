import axios from 'axios';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { encryptWith } from './services/crypto.js';
import * as q from './workspace/queries.js';
import type { Workspace } from './workspace/registry.js';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** An unsigned JWT shaped like an IONOS token (the app never verifies signatures; IONOS does). */
export function fakeJwt(opts: { contractNumber: number; uuid?: string; kid?: string; expInSeconds?: number }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: 'JWT', alg: 'RS256', kid: opts.kid ?? uuidv4() };
  const payload = {
    iss: 'ionos', iat: now, exp: now + (opts.expInSeconds ?? 86400), client: 'test',
    identity: { isParent: false, privileges: [], uuid: opts.uuid ?? uuidv4(), resellerId: 1, regDomain: 'ionos.de', role: 'admin', contractNumber: opts.contractNumber },
  };
  return `${b64(header)}.${b64(payload)}.sig`;
}

type MockReply = { status: number; data?: unknown };

/**
 * Route every axios call through `handler` (which may wait). Returns the list of "METHOD url" calls made.
 * Errors are shaped like axios 1.x errors, including the top-level `status`; status 0 means IONOS never answered.
 */
export function mockIonos(handler: (method: string, url: string, body?: unknown) => MockReply | Promise<MockReply>): string[] {
  const calls: string[] = [];
  const respond = async (method: string, url: string, body?: unknown) => {
    calls.push(`${method} ${url}`);
    const r = await handler(method, url, body);
    if (r.status === 0 || r.status >= 400) {
      const e = new Error(r.status ? `Request failed with status code ${r.status}` : 'connect ECONNREFUSED') as Error & {
        isAxiosError: boolean; status?: number; code?: string; response?: { status: number }; config: { method: string; url: string };
      };
      e.isAxiosError = true;
      e.config = { method: method.toLowerCase(), url };
      if (r.status) {
        e.status = r.status;
        e.response = { status: r.status };
      } else {
        e.code = 'ECONNREFUSED';
      }
      throw e;
    }
    return { status: r.status, headers: {}, data: r.data ?? {} };
  };
  (axios as unknown as { create: () => unknown }).create = () => ({
    get: (url: string) => respond('GET', url),
    delete: (url: string) => respond('DELETE', url),
    post: (url: string, body?: unknown) => respond('POST', url, body),
  });
  return calls;
}

/** Insert a DCD account straight into the workspace (bypasses IONOS verification). */
export function addTestAccount(ws: Workspace, contractNumber: number, opts: { expired?: boolean; noToken?: boolean } = {}): string {
  const id = uuidv4();
  const expires = new Date(Date.now() + (opts.expired ? -1 : 1) * 86400_000).toISOString();
  q.insertAccount(ws.db, {
    id, label: `Contract ${contractNumber}`, contract_number: contractNumber, admin_user_id: 'admin-uuid',
    token_enc: opts.noToken ? null : encryptWith(ws.key, fakeJwt({ contractNumber })),
    token_id: opts.noToken ? null : 'admin-kid', issued_at: new Date().toISOString(), expires_at: opts.noToken ? null : expires,
  });
  return id;
}

/** The admin token stored for alice@ionos.com in buildLegacyDb (contract 10000001). */
export const LEGACY_ALICE_ADMIN = fakeJwt({ contractNumber: 10000001, kid: 'alice-admin-kid' });

/**
 * Build a pre-workspace database (schema v6, as on fix/security-audit) at `path`, secrets encrypted with `key`.
 * Owners: alice (tokens a1 on her admin contract, a2 on contract 777, x1 with no contract) and bob (b1).
 */
export function buildLegacyDb(path: string, key: Buffer, opts: { ownerless?: boolean } = {}): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT);
    INSERT INTO schema_version (version) VALUES (6);
    CREATE TABLE user_admin_tokens (owner_email TEXT PRIMARY KEY, current_token_enc TEXT NOT NULL, token_id TEXT, issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, updated_at TEXT);
    CREATE TABLE managed_tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, ionos_token_id TEXT, ionos_user_id TEXT NOT NULL,
      ionos_group_id TEXT NOT NULL, sub_user_email TEXT NOT NULL, sub_user_password_enc TEXT NOT NULL, permissions TEXT NOT NULL,
      shared_resources TEXT DEFAULT '[]', template_id TEXT, ttl_seconds INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', cleanup_on_delete INTEGER NOT NULL DEFAULT 1, owner_email TEXT,
      last_regenerated_at TEXT, cleaned_up_at TEXT);
    CREATE TABLE permission_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT, permissions TEXT NOT NULL,
      shared_resource_types TEXT DEFAULT '[]', is_builtin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), owner_email TEXT);
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, entity_type TEXT, entity_id TEXT, details TEXT,
      ionos_request_ids TEXT, success INTEGER NOT NULL DEFAULT 1, error_message TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), actor_email TEXT);
  `);
  const exp = new Date(Date.now() + 86400_000).toISOString();
  db.prepare('INSERT INTO user_admin_tokens VALUES (?, ?, ?, ?, ?, ?)').run('alice@ionos.com', encryptWith(key, LEGACY_ALICE_ADMIN), 'alice-admin-kid', exp, exp, exp);
  const tok = db.prepare(`INSERT INTO managed_tokens (id, name, ionos_token_id, ionos_user_id, ionos_group_id, sub_user_email, sub_user_password_enc,
    permissions, ttl_seconds, expires_at, owner_email) VALUES (?, ?, 't', 'u', 'g', ?, ?, '{}', 60, ?, ?)`);
  tok.run('a1', 'alice-1', 'tkn-a1@c10000001.tokenmanager.internal', encryptWith(key, 'pw-a1'), exp, 'alice@ionos.com');
  tok.run('a2', 'alice-other-contract', 'tkn-a2@c777.tokenmanager.internal', encryptWith(key, 'pw-a2'), exp, 'alice@ionos.com');
  tok.run('b1', 'bob-1', 'tkn-b1@c888.tokenmanager.internal', encryptWith(key, 'pw-b1'), exp, 'bob@ionos.com');
  tok.run('x1', 'weird', 'not-a-tool-user@example.com', encryptWith(key, 'pw-x'), exp, 'alice@ionos.com');
  if (opts.ownerless) {
    tok.run('o1', 'from-single-user-era', 'tkn-o1@c10000001.tokenmanager.internal', encryptWith(key, 'pw-o1'), exp, null);
    db.prepare("INSERT INTO audit_log (action, actor_email) VALUES ('token.create.single-user-era', NULL)").run();
  }
  db.prepare("INSERT INTO permission_templates (id, name, permissions, is_builtin, owner_email) VALUES ('tp1', 'Alice custom', '{}', 0, 'alice@ionos.com')").run();
  db.prepare("INSERT INTO audit_log (action, actor_email) VALUES ('token.create', 'alice@ionos.com'), ('token.create', 'bob@ionos.com')").run();
  db.close();
}

/** The admin token of the single-user install built by buildSingleUserDb (contract 10000001). */
export const LEGACY_SOLO_ADMIN = fakeJwt({ contractNumber: 10000001, kid: 'solo-admin-kid' });

/**
 * An old single-user database: no owner on any row, the admin token in admin_token_state,
 * audit entries without an actor. One token (o1), one audit entry.
 */
export function buildSingleUserDb(path: string, key: Buffer): void {
  buildLegacyDb(path, key, { ownerless: true });
  const db = new Database(path);
  db.exec(`
    DELETE FROM managed_tokens WHERE owner_email IS NOT NULL;
    DELETE FROM user_admin_tokens;
    DELETE FROM permission_templates;
    DELETE FROM audit_log WHERE actor_email IS NOT NULL;
    CREATE TABLE admin_token_state (id INTEGER PRIMARY KEY, current_token_enc TEXT NOT NULL);
  `);
  db.prepare('INSERT INTO admin_token_state (id, current_token_enc) VALUES (1, ?)').run(encryptWith(key, LEGACY_SOLO_ADMIN));
  db.close();
}
