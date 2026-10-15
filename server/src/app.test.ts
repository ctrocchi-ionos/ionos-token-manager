import './test-setup.js';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'net';
import { mockIonos, addTestAccount, fakeJwt } from './test-helpers.js';

const calls = mockIonos((method, url) => {
  if (method === 'GET' && url.startsWith('/um/users/colleague-user')) {
    return { status: 200, data: { id: 'colleague-user', properties: { email: 'tkn-abcd1234@c1000.tokenmanager.internal' } } };
  }
  return { status: 200 };
});
const { createApp } = await import('./app.js');
const { openWorkspace } = await import('./workspace/registry.js');
const q = await import('./workspace/queries.js');
const { encryptWith } = await import('./services/crypto.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
after(() => { server.closeAllConnections(); server.close(); });

const alice = openWorkspace('alice@ionos.com');
const aliceAcc = addTestAccount(alice, 1000);
q.insertManagedToken(alice.db, {
  id: 'alice-token', account_id: aliceAcc, name: 'secret-name', description: null, ionos_token_id: 't', ionos_user_id: 'u',
  ionos_group_id: 'g', sub_user_email: 'e@c1000.tokenmanager.internal', sub_user_password_enc: encryptWith(alice.key, 'pw'),
  permissions: '{}', shared_resources: '[]', template_id: null, ttl_seconds: 60,
  expires_at: new Date(Date.now() + 3600_000).toISOString(), status: 'active', cleanup_on_delete: 1,
});

function call(path: string, user: string, init: RequestInit & { account?: string } = {}) {
  const headers: Record<string, string> = { 'X-Auth-Email': user, 'X-Requested-With': 'token-manager', 'Content-Type': 'application/json' };
  if (init.account) headers['X-DCD-Account'] = init.account;
  return fetch(`${base}${path}`, { ...init, headers });
}

test('health is open and unchanged', async () => {
  const r = await fetch(`${base}/admin/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true, data: { status: 'ok', dbConnected: true } });
});

test("Bob cannot use Alice's account id", async () => {
  const r = await call('/tokens', 'bob@ionos.com', { account: aliceAcc });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error.code, 'ACCOUNT_NOT_FOUND');
});

test("Bob cannot read, regenerate, revoke or dismiss Alice's token", async () => {
  assert.equal((await call('/tokens/alice-token', 'bob@ionos.com')).status, 404);
  assert.equal((await call('/tokens/alice-token/regenerate', 'bob@ionos.com', { method: 'POST' })).status, 404);
  assert.equal((await call('/tokens/alice-token', 'bob@ionos.com', { method: 'DELETE' })).status, 404);
  assert.equal((await call('/tokens/alice-token/dismiss', 'bob@ionos.com', { method: 'DELETE' })).status, 404);
  assert.equal(q.getManagedTokenById(alice.db, 'alice-token')!.status, 'active');
});

test('Bob sees no accounts, no audit, only built-in templates', async () => {
  assert.deepEqual((await (await call('/dcd-accounts', 'bob@ionos.com')).json()).data, []);
  assert.equal((await (await call('/audit', 'bob@ionos.com')).json()).pagination.total, 0);
  const templates = (await (await call('/templates', 'bob@ionos.com')).json()).data;
  assert.ok(templates.every((t: { isBuiltin: boolean }) => t.isBuiltin));
});

test('Alice sees her token through her account', async () => {
  const body = await (await call('/tokens', 'alice@ionos.com', { account: aliceAcc })).json();
  assert.deepEqual(body.data.map((t: { id: string }) => t.id), ['alice-token']);
});

test('token routes that need an account say so', async () => {
  const r = await call('/tokens', 'alice@ionos.com');
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 'ACCOUNT_REQUIRED');
});

test('add DCD account over HTTP, then list it', async () => {
  const r = await call('/dcd-accounts', 'carol@ionos.com', { method: 'POST', body: JSON.stringify({ label: 'Lab', token: fakeJwt({ contractNumber: 2000 }) }) });
  assert.equal(r.status, 201);
  const list = (await (await call('/dcd-accounts', 'carol@ionos.com')).json()).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].label, 'Lab');
  assert.equal(JSON.stringify(list).includes('token_enc'), false);
});

test('resources route rejects odd types', async () => {
  const r = await call('/resources/..%2Fusers', 'alice@ionos.com', { account: aliceAcc });
  assert.equal(r.status, 400);
});

test("a colleague's token sub-user (same contract, other workspace) cannot be deleted as 'external'", async () => {
  const r = await call('/account/external-users/colleague-user', 'alice@ionos.com', { method: 'DELETE', account: aliceAcc });
  assert.equal(r.status, 403);
  assert.ok(!calls.some((c) => c.startsWith('DELETE /um/users/colleague-user')));
});

test('backup and restore endpoints are gone', async () => {
  const key = await call('/admin/backup/key', 'alice@ionos.com');
  assert.equal(key.status, 404);
  assert.equal((await key.json()).error.code, 'NOT_FOUND');
  const restore = await call('/admin/restore', 'alice@ionos.com', { method: 'POST', body: '{}' });
  assert.equal(restore.status, 404);
  assert.equal((await restore.json()).error.code, 'NOT_FOUND');
});

test('my key and my database download, and the database restores over HTTP (upload larger than the 1mb JSON limit)', async () => {
  const key = await call('/backup/key', 'alice@ionos.com');
  assert.equal(key.status, 200);
  assert.match(key.headers.get('content-disposition') ?? '', /tokenmanager-my-key\.key/);
  const keyHex = await key.text();
  assert.match(keyHex, /^[0-9a-f]{64}$/);

  const db = await call('/backup/db', 'alice@ionos.com');
  assert.equal(db.status, 200);
  assert.match(db.headers.get('content-disposition') ?? '', /tokenmanager-my-backup-\d{4}-\d{2}-\d{2}\.db/);
  const bytes = Buffer.from(await db.arrayBuffer());

  const ok = await call('/backup/restore', 'alice@ionos.com', { method: 'POST', body: JSON.stringify({ db: bytes.toString('base64'), key: keyHex }) });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).data.format, 'workspace');

  const big = await call('/backup/restore', 'alice@ionos.com', { method: 'POST', body: JSON.stringify({ db: 'A'.repeat(2_000_000), key: keyHex }) });
  assert.equal(big.status, 400); // reaches the restore code (not a backup), not a 413 from the 1mb limit
  assert.equal((await big.json()).error.code, 'VALIDATION_ERROR');

  const other = await call('/backup/restore', 'bob@ionos.com', { method: 'POST', body: JSON.stringify({ db: bytes.toString('base64'), key: keyHex }) });
  assert.equal(other.status, 403);
  assert.equal((await call('/tokens/alice-token', 'alice@ionos.com')).status, 200);
});

test('dismiss refuses an expired token whose IONOS user still exists', async () => {
  q.insertManagedToken(alice.db, {
    id: 'exp-live-user', account_id: aliceAcc, name: 'exp', description: null, ionos_token_id: 't2', ionos_user_id: 'u2',
    ionos_group_id: 'g2', sub_user_email: 'e2@c1000.tokenmanager.internal', sub_user_password_enc: encryptWith(alice.key, 'pw'),
    permissions: '{}', shared_resources: '[]', template_id: null, ttl_seconds: 60,
    expires_at: new Date(Date.now() - 1000).toISOString(), status: 'expired', cleanup_on_delete: 1,
  });
  const r = await call('/tokens/exp-live-user/dismiss', 'alice@ionos.com', { method: 'DELETE' });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.equal(body.error.message, 'Revoke it first (this removes its IONOS user)');
  assert.ok(q.getManagedTokenById(alice.db, 'exp-live-user'));
});

test('dismiss removes a revoked token', async () => {
  q.insertManagedToken(alice.db, {
    id: 'revoked-one', account_id: aliceAcc, name: 'rev', description: null, ionos_token_id: null, ionos_user_id: 'u3',
    ionos_group_id: 'g3', sub_user_email: 'e3@c1000.tokenmanager.internal', sub_user_password_enc: encryptWith(alice.key, 'pw'),
    permissions: '{}', shared_resources: '[]', template_id: null, ttl_seconds: 60,
    expires_at: new Date(Date.now() + 1000).toISOString(), status: 'revoked', cleanup_on_delete: 1,
  });
  const r = await call('/tokens/revoked-one/dismiss', 'alice@ionos.com', { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal(q.getManagedTokenById(alice.db, 'revoked-one'), undefined);
});

test('bulk-delete by ids ignores tokens of another account in the same workspace', async () => {
  const otherAcc = addTestAccount(alice, 3000);
  q.insertManagedToken(alice.db, {
    id: 'other-acc-token', account_id: otherAcc, name: 'other', description: null, ionos_token_id: 't4', ionos_user_id: 'other-user',
    ionos_group_id: 'other-group', sub_user_email: 'e4@c3000.tokenmanager.internal', sub_user_password_enc: encryptWith(alice.key, 'pw'),
    permissions: '{}', shared_resources: '[]', template_id: null, ttl_seconds: 60,
    expires_at: new Date(Date.now() + 3600_000).toISOString(), status: 'active', cleanup_on_delete: 1,
  });
  const before = calls.length;
  const r = await call('/tokens/bulk-delete', 'alice@ionos.com', { method: 'POST', account: aliceAcc, body: JSON.stringify({ ids: ['other-acc-token'] }) });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).data, { deleted: 0, errors: [] });
  assert.equal(q.getManagedTokenById(alice.db, 'other-acc-token')!.status, 'active');
  assert.ok(!calls.slice(before).some((c) => c.includes('other-user')));
});

async function downloadBackup(user: string): Promise<string> {
  const key = await (await call('/backup/key', user)).text();
  const db = Buffer.from(await (await call('/backup/db', user)).arrayBuffer());
  return JSON.stringify({ db: db.toString('base64'), key });
}

test('restore is refused with 409 while a newer token still has a live IONOS user', async () => {
  const backup = await downloadBackup('alice@ionos.com');
  q.insertManagedToken(alice.db, {
    id: 'after-backup', account_id: aliceAcc, name: 'made-later', description: null, ionos_token_id: 't5', ionos_user_id: 'u5',
    ionos_group_id: 'g5', sub_user_email: 'e5@c1000.tokenmanager.internal', sub_user_password_enc: encryptWith(alice.key, 'pw'),
    permissions: '{}', shared_resources: '[]', template_id: null, ttl_seconds: 60,
    expires_at: new Date(Date.now() + 3600_000).toISOString(), status: 'active', cleanup_on_delete: 1,
  });
  const r = await call('/backup/restore', 'alice@ionos.com', { method: 'POST', body: backup });
  assert.equal(r.status, 409);
  const body = await r.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'RESTORE_WOULD_ORPHAN');
  assert.deepEqual(body.error.details.tokens, [{ id: 'after-backup', name: 'made-later' }]);
  assert.equal((await call('/tokens/after-backup', 'alice@ionos.com')).status, 200); // nothing changed
});

test('a user with no DCD account can restore their backup (fresh copy of the app)', async () => {
  const erin = openWorkspace('erin@ionos.com');
  const acc = addTestAccount(erin, 2500);
  const backup = await downloadBackup('erin@ionos.com');
  q.deleteAccount(erin.db, acc); // as on a fresh copy: no account yet
  assert.deepEqual((await (await call('/dcd-accounts', 'erin@ionos.com')).json()).data, []);

  const r = await call('/backup/restore', 'erin@ionos.com', { method: 'POST', body: backup });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.accounts, 1);
  assert.equal((await (await call('/dcd-accounts', 'erin@ionos.com')).json()).data.length, 1);
});
