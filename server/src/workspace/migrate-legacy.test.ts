import '../test-setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { buildLegacyDb, LEGACY_ALICE_ADMIN } from '../test-helpers.js';

const { config } = await import('../config.js');
const { migrateLegacyDatabase } = await import('./migrate-legacy.js');
const { openWorkspace, closeAllWorkspaces } = await import('./registry.js');
const q = await import('./queries.js');
const { getAccountAdminToken, toAccountResponse } = await import('../services/dcd-accounts.js');
const { decryptWith } = await import('../services/crypto.js');

const legacyPath = join(config.dataDir, 'tokenmanager.db');
const master = config.getEncryptionKey();
const aliceAdmin = LEGACY_ALICE_ADMIN;
const buildLegacy = (key: Buffer, opts: { ownerless?: boolean } = {}) => buildLegacyDb(legacyPath, key, opts);

function resetData() {
  closeAllWorkspaces();
  for (const f of readdirSync(config.dataDir)) if (f.startsWith('tokenmanager.db')) rmSync(join(config.dataDir, f));
  rmSync(join(config.dataDir, 'workspaces'), { recursive: true, force: true });
}

test('wrong master key: aborts and leaves the legacy file untouched', () => {
  buildLegacy(Buffer.alloc(32, 9)); // encrypted with a different key
  assert.throws(() => migrateLegacyDatabase(), /cannot be decrypted/);
  assert.ok(existsSync(legacyPath));
  assert.ok(!existsSync(join(config.dataDir, 'workspaces')));
  resetData();
});

test('ownerless tokens without LEGACY_OWNER_EMAIL: aborts before writing anything', () => {
  buildLegacy(master, { ownerless: true });
  assert.throws(() => migrateLegacyDatabase(), /LEGACY_OWNER_EMAIL/);
  assert.ok(existsSync(legacyPath));
  assert.ok(!existsSync(join(config.dataDir, 'workspaces')));
  resetData();
});

test('splits owners into private workspaces and re-encrypts secrets', () => {
  buildLegacy(master);
  const r = migrateLegacyDatabase();
  assert.deepEqual(r, { migrated: true, owners: 2, tokens: 3, skippedTokens: 1 });
  assert.ok(!existsSync(legacyPath));
  assert.ok(readdirSync(config.dataDir).some((f) => f.startsWith('tokenmanager.db.migrated-')));

  const alice = openWorkspace('alice@ionos.com');
  const bob = openWorkspace('bob@ionos.com');

  const main = q.getAccountByContract(alice.db, 10000001)!;
  assert.equal(getAccountAdminToken(alice, main.id), aliceAdmin);
  assert.equal(q.getManagedTokenById(alice.db, 'a1')!.account_id, main.id);
  assert.equal(decryptWith(alice.key, q.getManagedTokenById(alice.db, 'a1')!.sub_user_password_enc), 'pw-a1');

  const placeholder = q.getAccountByContract(alice.db, 777)!;
  assert.equal(toAccountResponse(alice, placeholder).hasToken, false);
  assert.equal(q.getManagedTokenById(alice.db, 'a2')!.account_id, placeholder.id);

  assert.equal(q.getManagedTokenById(alice.db, 'b1'), undefined);
  assert.ok(q.getManagedTokenById(bob.db, 'b1'));
  assert.equal(q.getManagedTokenById(alice.db, 'x1'), undefined);

  assert.ok(q.templateExistsByName(alice.db, 'Alice custom'));
  assert.equal(q.templateExistsByName(bob.db, 'Alice custom'), false);
  assert.equal(q.listAuditLog(bob.db, { action: 'token.create' }).total, 1);
});

test('running again is a no-op', () => {
  assert.deepEqual(migrateLegacyDatabase(), { migrated: false, owners: 0, tokens: 0, skippedTokens: 0 });
});

test('LEGACY_OWNER_EMAIL receives ownerless tokens; earlier backups are never overwritten', () => {
  const before = readdirSync(config.dataDir).filter((f) => f.startsWith('tokenmanager.db.migrated-')).length;
  process.env.LEGACY_OWNER_EMAIL = 'Legacy@IONOS.com';
  buildLegacy(master, { ownerless: true }); // e.g. a rollback + redeploy recreated the file
  const r = migrateLegacyDatabase();
  delete process.env.LEGACY_OWNER_EMAIL;
  // alice and bob are already marked migrated: nothing re-imported. x1 (no contract) is reported again as not in the workspace.
  assert.deepEqual(r, { migrated: true, owners: 3, tokens: 1, skippedTokens: 1 });
  const legacyWs = openWorkspace('legacy@ionos.com');
  assert.ok(q.getManagedTokenById(legacyWs.db, 'o1'));
  // Audit entries from before actors were recorded go to the legacy owner too, like the ownerless tokens
  assert.equal(q.listAuditLog(legacyWs.db, { action: 'token.create.single-user-era' }).total, 1);
  assert.equal(q.listAuditLog(openWorkspace('alice@ionos.com').db, { action: 'token.create.single-user-era' }).total, 0);
  const after = readdirSync(config.dataDir).filter((f) => f.startsWith('tokenmanager.db.migrated-')).length;
  assert.equal(after, before + 1);
});
