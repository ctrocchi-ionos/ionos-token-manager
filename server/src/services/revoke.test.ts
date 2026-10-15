import '../test-setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mockIonos, addTestAccount } from '../test-helpers.js';
import type { NewTokenRow } from '../workspace/queries.js';

let deleteStatus: Record<string, number> = {};
const calls = mockIonos((method, url) => {
  if (method === 'DELETE') {
    const hit = Object.entries(deleteStatus).find(([k]) => url.includes(k));
    return { status: hit ? hit[1] : 204 };
  }
  return { status: 200 };
});

const { openWorkspace } = await import('../workspace/registry.js');
const q = await import('../workspace/queries.js');
const { encryptWith } = await import('./crypto.js');
const { revokeManagedToken, regenerateToken } = await import('./token-creator.js');
const { runExpiredSweep } = await import('./expired-sweep.js');

const ws = openWorkspace('owner@ionos.com');
const acc = addTestAccount(ws, 100);

function addToken(id: string, over: Partial<NewTokenRow> = {}, w = ws, accountId = acc) {
  q.insertManagedToken(w.db, {
    id, account_id: accountId, name: id, description: null, ionos_token_id: `tid-${id}`, ionos_user_id: `user-${id}`,
    ionos_group_id: `group-${id}`, sub_user_email: `${id}@x`, sub_user_password_enc: encryptWith(w.key, 'pw'),
    permissions: '{}', shared_resources: '[]', template_id: null, ttl_seconds: 60,
    expires_at: new Date(Date.now() + 3600_000).toISOString(), status: 'active', cleanup_on_delete: 1, ...over,
  });
}
const statusOf = (id: string, w = ws) => q.getManagedTokenById(w.db, id)!.status;
const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

test('revoke deletes user and group, then marks revoked', async () => {
  calls.length = 0; deleteStatus = {};
  addToken('ok');
  await revokeManagedToken(ws, 'ok');
  assert.ok(calls.some((c) => c.includes('/um/users/user-ok')));
  assert.ok(calls.some((c) => c.includes('/um/groups/group-ok')));
  assert.equal(statusOf('ok'), 'revoked');
});

test('revoke does NOT claim success when IONOS refuses to delete the user', async () => {
  deleteStatus = { '/um/users/': 500 };
  addToken('fail');
  await assert.rejects(() => revokeManagedToken(ws, 'fail'), /Revoke incomplete/);
  assert.equal(statusOf('fail'), 'active');
  assert.ok(q.listAuditLog(ws.db, { action: 'token.revoke' }).items.some((e) => e.entity_id === 'fail' && e.success === 0));
});

test('a 404 (already gone) counts as success', async () => {
  deleteStatus = { '/um/users/': 404, '/um/groups/': 404 };
  addToken('gone');
  await revokeManagedToken(ws, 'gone');
  assert.equal(statusOf('gone'), 'revoked');
});

test('with cleanup off, the IONOS token itself is deleted', async () => {
  calls.length = 0; deleteStatus = {};
  addToken('keep', { cleanup_on_delete: 0 });
  await revokeManagedToken(ws, 'keep');
  assert.ok(calls.some((c) => c.includes('/tokens/tid-keep')));
  assert.ok(!calls.some((c) => c.includes('/um/users/')));
  assert.equal(statusOf('keep'), 'revoked');
});

test("expired account token: revoke fails clearly; other accounts unaffected", async () => {
  deleteStatus = {};
  const dead = addTestAccount(ws, 101, { expired: true });
  addToken('on-dead', {}, ws, dead);
  await assert.rejects(() => revokeManagedToken(ws, 'on-dead'), (e: any) => e.code === 'ACCOUNT_TOKEN_EXPIRED');
  assert.equal(statusOf('on-dead'), 'active');
  addToken('on-live');
  await revokeManagedToken(ws, 'on-live');
  assert.equal(statusOf('on-live'), 'revoked');
});

test('regenerate refuses revoked tokens', async () => {
  await assert.rejects(() => regenerateToken(ws, 'ok'), /revoked/);
});

test('unknown token id is a 404', async () => {
  await assert.rejects(() => revokeManagedToken(ws, 'nope'), (e: any) => e.code === 'NOT_FOUND');
});

test('sweep: cleans per workspace with that account, skips accounts whose token expired', async () => {
  deleteStatus = {};
  const dead = q.getAccountByContract(ws.db, 101)!.id;
  addToken('old', { expires_at: ago(10), status: 'expired' });
  addToken('recent', { expires_at: ago(1), status: 'expired' });
  addToken('old-dead', { expires_at: ago(10), status: 'expired' }, ws, dead);

  const other = openWorkspace('second@ionos.com');
  const otherAcc = addTestAccount(other, 100); // same contract number, different user: fully separate
  addToken('old-other', { expires_at: ago(10), status: 'expired' }, other, otherAcc);

  const r = await runExpiredSweep();
  assert.equal(r.cleaned, 2);
  assert.equal(r.skipped, 1);
  assert.ok(q.getManagedTokenById(ws.db, 'old')!.cleaned_up_at);
  assert.ok(q.getManagedTokenById(other.db, 'old-other')!.cleaned_up_at);
  assert.equal(q.getManagedTokenById(ws.db, 'recent')!.cleaned_up_at, null);
  assert.equal(q.getManagedTokenById(ws.db, 'old-dead')!.cleaned_up_at, null);
  assert.equal((await runExpiredSweep()).cleaned, 0); // idempotent
});
