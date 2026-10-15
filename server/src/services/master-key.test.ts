import '../test-setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const mk = await import('./master-key.js');

function place() {
  const root = mkdtempSync(join(tmpdir(), 'mk-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  return { dataDir, dotEnvPath: join(root, '.env') };
}
const K1 = 'a'.repeat(64);
const K2 = 'b'.repeat(64);

test('uses the key from .env / the environment', () => {
  const p = place();
  assert.deepEqual(mk.resolveMasterKey({ envKey: K1, ...p }), { key: K1, source: 'env' });
});

test('falls back to the old key file in the data folder', () => {
  const p = place();
  writeFileSync(join(p.dataDir, 'encryption.key'), `${K2}\n`);
  assert.deepEqual(mk.resolveMasterKey({ envKey: '', ...p }), { key: K2, source: 'data-file' });
});

test('new install with a .env file: generates a key, appends it to .env, keeps a copy', () => {
  const p = place();
  writeFileSync(p.dotEnvPath, 'DEV_AUTH_EMAIL=me@ionos.com\n');
  const r = mk.resolveMasterKey({ envKey: '', ...p });
  assert.equal(r.source, 'generated-env');
  assert.match(r.key, /^[0-9a-f]{64}$/);
  const env = readFileSync(p.dotEnvPath, 'utf-8');
  assert.ok(env.includes('DEV_AUTH_EMAIL=me@ionos.com'));
  assert.ok(env.includes(`ENCRYPTION_KEY=${r.key}`));
  // safety copy next to the data, in case a managed .env is ever rebuilt without the key
  assert.equal(readFileSync(join(p.dataDir, 'encryption.key'), 'utf-8').trim(), r.key);
});

test('new install without a .env file: key goes to the data folder (no .env is created)', () => {
  const p = place();
  const r = mk.resolveMasterKey({ envKey: '', ...p });
  assert.equal(r.source, 'generated-data-file');
  assert.equal(readFileSync(join(p.dataDir, 'encryption.key'), 'utf-8').trim(), r.key);
  assert.ok(!existsSync(p.dotEnvPath));
});

test('missing key while data exists: refuses and generates nothing', () => {
  const p = place();
  mkdirSync(join(p.dataDir, 'workspaces', 'abc'), { recursive: true });
  writeFileSync(p.dotEnvPath, '');
  assert.throws(() => mk.resolveMasterKey({ envKey: '', ...p }), /already has data/);
  assert.equal(readFileSync(p.dotEnvPath, 'utf-8'), '');
  assert.ok(!existsSync(join(p.dataDir, 'encryption.key')));
});

test('fingerprint: same key passes, a different key is refused, an existing fingerprint is never overwritten', () => {
  const p = place();
  mk.verifyMasterKey(K1, p.dataDir); // no fingerprint yet: nothing to check
  mk.recordMasterKey(K1, p.dataDir);
  mk.verifyMasterKey(K1, p.dataDir);
  assert.throws(() => mk.verifyMasterKey(K2, p.dataDir), /does not match/);
  mk.recordMasterKey(K2, p.dataDir); // must not replace the K1 fingerprint
  mk.verifyMasterKey(K1, p.dataDir);
});

test('a fingerprint alone counts as existing data', () => {
  const p = place();
  mk.recordMasterKey(K1, p.dataDir);
  assert.throws(() => mk.resolveMasterKey({ envKey: '', ...p }), /already has data/);
});

test('a legacy tokenmanager.db without any key: refuses, writes no key, leaves the db untouched', () => {
  const p = place();
  const db = join(p.dataDir, 'tokenmanager.db');
  writeFileSync(db, 'legacy-db-bytes');
  writeFileSync(p.dotEnvPath, 'DEV_AUTH_EMAIL=me@ionos.com\n');
  assert.throws(() => mk.resolveMasterKey({ envKey: '', ...p }), /already has data/);
  assert.ok(!existsSync(join(p.dataDir, 'encryption.key')));
  assert.equal(readFileSync(p.dotEnvPath, 'utf-8'), 'DEV_AUTH_EMAIL=me@ionos.com\n');
  assert.equal(readFileSync(db, 'utf-8'), 'legacy-db-bytes');
});

/** A workspace file on disk (as the app writes it) whose one secret is encrypted with `master`'s workspace key. */
async function workspaceOnDisk(dataDir: string, master: string, withSecret = true) {
  const Database = (await import('better-sqlite3')).default;
  const { workspaceIdFor } = await import('../workspace/registry.js');
  const { initializeWorkspaceSchema } = await import('../workspace/schema.js');
  const { deriveWorkspaceKey, encryptWith } = await import('./crypto.js');
  const email = 'someone@ionos.com';
  const id = workspaceIdFor(email);
  mkdirSync(join(dataDir, 'workspaces', id), { recursive: true });
  const db = new Database(join(dataDir, 'workspaces', id, 'workspace.db'));
  initializeWorkspaceSchema(db);
  db.prepare("INSERT INTO workspace_meta (key, value) VALUES ('owner_email', ?)").run(email);
  if (withSecret) {
    const enc = encryptWith(deriveWorkspaceKey(Buffer.from(master, 'hex'), id), 'admin-jwt');
    db.prepare("INSERT INTO dcd_accounts (id, label, contract_number, token_enc) VALUES ('a', 'A', 1, ?)").run(enc);
  }
  db.close();
}

test('no fingerprint but workspaces exist: a key that cannot read their secrets is refused, nothing is written', async () => {
  const p = place();
  await workspaceOnDisk(p.dataDir, K1);
  assert.throws(() => mk.verifyMasterKey(K2, p.dataDir), /cannot read the existing data/);
  assert.ok(!existsSync(join(p.dataDir, 'key-check')));
  mk.verifyMasterKey(K1, p.dataDir); // the right key passes, so it can then be recorded
});

test('no fingerprint and workspaces without any secret: nothing to check, the key is accepted', async () => {
  const p = place();
  await workspaceOnDisk(p.dataDir, K1, false);
  mk.verifyMasterKey(K2, p.dataDir);
});
