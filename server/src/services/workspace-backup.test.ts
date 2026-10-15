import '../test-setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { addTestAccount, buildLegacyDb } from '../test-helpers.js';

const { openWorkspace } = await import('../workspace/registry.js');
const q = await import('../workspace/queries.js');
const { encryptWith, decryptWith } = await import('./crypto.js');
const { getAccountAdminToken } = await import('./dcd-accounts.js');
const { snapshotWorkspace, restoreWorkspace } = await import('./workspace-backup.js');

const alice = openWorkspace('alice@ionos.com');
const aliceAcc = addTestAccount(alice, 4000);
const adminBefore = getAccountAdminToken(alice, aliceAcc);
q.insertManagedToken(alice.db, {
  id: 'tok-1', account_id: aliceAcc, name: 'ci', description: null, ionos_token_id: 't', ionos_user_id: 'u', ionos_group_id: 'g',
  sub_user_email: 'tkn-x@c4000.tokenmanager.internal', sub_user_password_enc: encryptWith(alice.key, 'pw-1'),
  permissions: '{}', shared_resources: '[]', template_id: null, ttl_seconds: 60,
  expires_at: new Date(Date.now() + 3600_000).toISOString(), status: 'active', cleanup_on_delete: 1,
});

/** A backup as if made on another copy of the app: same user, different master key (so a different "my key"). */
async function backupFromAnotherCopy(): Promise<{ file: Buffer; keyHex: string }> {
  const { dir, file } = await snapshotWorkspace(alice);
  const foreign = randomBytes(32);
  const db = new Database(file);
  for (const r of db.prepare('SELECT id, token_enc FROM dcd_accounts WHERE token_enc IS NOT NULL').all() as Array<{ id: string; token_enc: string }>) {
    db.prepare('UPDATE dcd_accounts SET token_enc = ? WHERE id = ?').run(encryptWith(foreign, decryptWith(alice.key, r.token_enc)), r.id);
  }
  for (const r of db.prepare('SELECT id, sub_user_password_enc AS p FROM managed_tokens').all() as Array<{ id: string; p: string }>) {
    db.prepare('UPDATE managed_tokens SET sub_user_password_enc = ? WHERE id = ?').run(encryptWith(foreign, decryptWith(alice.key, r.p)), r.id);
  }
  db.close();
  const bytes = readFileSync(file);
  rmSync(dir, { recursive: true, force: true });
  return { file: bytes, keyHex: foreign.toString('hex') };
}

test('restores a backup made on another copy of the app, replacing current data', async () => {
  const b = await backupFromAnotherCopy();
  q.updateManagedTokenStatus(alice.db, 'tok-1', 'revoked'); // changes made after the backup...
  q.insertPermissionTemplate(alice.db, { name: 'after-backup', permissions: {} });

  const r = restoreWorkspace(alice, b.file, b.keyHex);
  assert.deepEqual(r, { format: 'workspace', accounts: 1, tokens: 1, templates: 0, skipped: 0 });
  assert.equal(q.getManagedTokenById(alice.db, 'tok-1')!.status, 'active'); // ...are gone
  assert.equal(q.templateExistsByName(alice.db, 'after-backup'), false);
  assert.equal(getAccountAdminToken(alice, aliceAcc), adminBefore); // secrets readable with this app's key
  assert.equal(decryptWith(alice.key, q.getManagedTokenById(alice.db, 'tok-1')!.sub_user_password_enc), 'pw-1');
  assert.equal(q.listAuditLog(alice.db, { action: 'workspace.restore' }).total, 1);
});

test('a wrong key is refused and nothing changes', async () => {
  const b = await backupFromAnotherCopy();
  q.insertPermissionTemplate(alice.db, { name: 'keep-me', permissions: {} });
  assert.throws(() => restoreWorkspace(alice, b.file, randomBytes(32).toString('hex')), /does not match/);
  assert.ok(q.templateExistsByName(alice.db, 'keep-me'));
});

test("another user's backup is refused", async () => {
  const bob = openWorkspace('bob@ionos.com');
  addTestAccount(bob, 5000);
  const { dir, file } = await snapshotWorkspace(bob);
  assert.throws(() => restoreWorkspace(alice, readFileSync(file), bob.key.toString('hex')), (e: any) => e.code === 'FORBIDDEN');
  rmSync(dir, { recursive: true, force: true });
  assert.ok(q.getAccount(alice.db, aliceAcc));
});

test('garbage files and malformed keys are refused', () => {
  assert.throws(() => restoreWorkspace(alice, Buffer.from('hello'), 'a'.repeat(64)), /not a Token Manager backup/);
  assert.throws(() => restoreWorkspace(alice, Buffer.from('hello'), 'not-hex'), /64 hex/);
});

test('an old whole-app backup restores only my own rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-'));
  const path = join(dir, 'old.db');
  const legacyKey = randomBytes(32);
  buildLegacyDb(path, legacyKey);
  // Every pre-upgrade user has this flag; the restore must still import (it clears and re-sets the flag)
  alice.db.prepare("INSERT OR REPLACE INTO workspace_meta (key, value) VALUES ('legacy_migrated', 'then')").run();
  const r = restoreWorkspace(alice, readFileSync(path), legacyKey.toString('hex'));
  assert.equal(r.format, 'legacy');
  assert.ok(alice.db.prepare("SELECT 1 FROM workspace_meta WHERE key = 'legacy_migrated'").get()); // set again afterwards
  assert.equal(r.tokens, 2); // a1, a2 (x1 skipped: unknown contract)
  assert.equal(r.skipped, 1);
  assert.ok(q.getManagedTokenById(alice.db, 'a1'));
  assert.equal(q.getManagedTokenById(alice.db, 'b1'), undefined); // bob's row stays out
  assert.equal(q.getManagedTokenById(alice.db, 'tok-1'), undefined); // replaced, not merged

  const carol = openWorkspace('carol@ionos.com');
  assert.throws(() => restoreWorkspace(carol, readFileSync(path), legacyKey.toString('hex')), /no data for your account/);
  rmSync(dir, { recursive: true, force: true });
});

test('a workspace-format restore keeps the legacy_migrated flag, so a redeploy never re-runs the migration', async () => {
  alice.db.prepare("INSERT OR REPLACE INTO workspace_meta (key, value) VALUES ('legacy_migrated', 'then')").run();
  const b = await backupFromAnotherCopy();
  restoreWorkspace(alice, b.file, b.keyHex);
  assert.ok(alice.db.prepare("SELECT 1 FROM workspace_meta WHERE key = 'legacy_migrated'").get());
});

test('a backup from a newer app version is refused and nothing changes', async () => {
  const b = await backupFromAnotherCopy();
  const dir = mkdtempSync(join(tmpdir(), 'newer-'));
  const path = join(dir, 'newer.db');
  writeFileSync(path, b.file);
  const db = new Database(path);
  db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(999);
  db.close();
  q.insertPermissionTemplate(alice.db, { name: 'still-here', permissions: {} });
  assert.throws(() => restoreWorkspace(alice, readFileSync(path), b.keyHex), /newer version/);
  assert.ok(q.templateExistsByName(alice.db, 'still-here'));
  rmSync(dir, { recursive: true, force: true });
});

test('a failed restore rolls back completely', async () => {
  const rbAcc = addTestAccount(alice, 4100);
  q.insertManagedToken(alice.db, {
    id: 'tok-rb', account_id: rbAcc, name: 'rb', description: null, ionos_token_id: 't', ionos_user_id: 'u', ionos_group_id: 'g',
    sub_user_email: 'tkn-y@c4000.tokenmanager.internal', sub_user_password_enc: encryptWith(alice.key, 'pw-rb'),
    permissions: '{}', shared_resources: '[]', template_id: null, ttl_seconds: 60,
    expires_at: new Date(Date.now() + 3600_000).toISOString(), status: 'active', cleanup_on_delete: 1,
  });
  const b = await backupFromAnotherCopy();
  const dir = mkdtempSync(join(tmpdir(), 'broken-'));
  const path = join(dir, 'broken.db');
  writeFileSync(path, b.file);
  const db = new Database(path);
  db.prepare("UPDATE managed_tokens SET sub_user_password_enc = 'garbage' WHERE id = 'tok-rb'").run();
  db.close();
  q.insertPermissionTemplate(alice.db, { name: 'survivor', permissions: {} });
  assert.throws(() => restoreWorkspace(alice, readFileSync(path), b.keyHex), /could not be restored; nothing was changed/);
  assert.ok(q.templateExistsByName(alice.db, 'survivor'));
  assert.ok(q.getManagedTokenById(alice.db, 'tok-rb'));
  rmSync(dir, { recursive: true, force: true });
});

test('a database that only looks like a backup is refused cleanly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-'));
  const path = join(dir, 'fake.db');
  const db = new Database(path);
  db.exec("CREATE TABLE workspace_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO workspace_meta VALUES ('owner_email', 'alice@ionos.com')");
  db.close();
  const warn = console.warn;
  console.warn = () => {}; // the unexpected-error warning is expected here
  try {
    assert.throws(() => restoreWorkspace(alice, readFileSync(path), 'a'.repeat(64)), /damaged or is not a Token Manager backup/);
  } finally { console.warn = warn; }
  rmSync(dir, { recursive: true, force: true });
});

test("the backup's owner email is compared after normalising it", async () => {
  const { dir, file } = await snapshotWorkspace(alice);
  const db = new Database(file);
  db.prepare("UPDATE workspace_meta SET value = ' Alice@IONOS.com ' WHERE key = 'owner_email'").run();
  db.close();
  const bytes = readFileSync(file);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(restoreWorkspace(alice, bytes, alice.key.toString('hex')).format, 'workspace');
});
