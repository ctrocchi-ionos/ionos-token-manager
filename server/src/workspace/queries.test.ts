import '../test-setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import type { NewTokenRow } from './queries.js'; // type-only: erased, does not load the module early

const { openWorkspace } = await import('./registry.js');
const q = await import('./queries.js');

const ws = openWorkspace('q@ionos.com');
const db = ws.db;

function account(id: string, contract: number) {
  q.insertAccount(db, { id, label: `L${contract}`, contract_number: contract, admin_user_id: 'u', token_enc: 'enc', token_id: 'k', issued_at: null, expires_at: null });
}
function token(id: string, accountId: string, over: Partial<NewTokenRow> = {}) {
  q.insertManagedToken(db, {
    id, account_id: accountId, name: id, description: null, ionos_token_id: `t-${id}`, ionos_user_id: `u-${id}`,
    ionos_group_id: `g-${id}`, sub_user_email: `${id}@x`, sub_user_password_enc: 'p', permissions: '{}',
    shared_resources: '[]', template_id: null, ttl_seconds: 60,
    expires_at: new Date(Date.now() + 86400_000).toISOString(), status: 'active', cleanup_on_delete: 1, ...over,
  });
}
const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

account('acc-1', 111);
account('acc-2', 222);

test('contract numbers are unique per workspace', () => {
  assert.throws(() => account('acc-dup', 111), /UNIQUE/);
  assert.equal(q.getAccountByContract(db, 222)?.id, 'acc-2');
});

test('token lists and stats are scoped to one account', () => {
  token('t1', 'acc-1');
  token('t2', 'acc-2');
  assert.deepEqual(q.listManagedTokens(db, { accountId: 'acc-1' }).items.map((t) => t.id), ['t1']);
  assert.equal(q.getTokenStats(db, 'acc-2').total, 1);
});

test('markExpiredTokens only touches the given account', () => {
  token('old1', 'acc-1', { expires_at: ago(1) });
  token('old2', 'acc-2', { expires_at: ago(1) });
  assert.equal(q.markExpiredTokens(db, 'acc-1'), 1);
  assert.equal(q.getManagedTokenById(db, 'old1')!.status, 'expired');
  assert.equal(q.getManagedTokenById(db, 'old2')!.status, 'active');
});

test('tokens holding IONOS access: active, or expired with cleanup pending', () => {
  // acc-1 has t1 (active) and old1 (expired, cleanup on, not cleaned) -> 2
  assert.equal(q.countTokensHoldingIonosAccess(db, 'acc-1'), 2);
  q.updateManagedTokenStatus(db, 't1', 'revoked');
  q.markTokenCleanedUp(db, 'old1');
  assert.equal(q.countTokensHoldingIonosAccess(db, 'acc-1'), 0);
});

test('deleteAccount removes the account and its token rows', () => {
  q.deleteAccount(db, 'acc-1');
  assert.equal(q.getAccount(db, 'acc-1'), undefined);
  assert.equal(q.getManagedTokenById(db, 't1'), undefined);
  assert.ok(q.getManagedTokenById(db, 't2'));
});

test('cleanup due list respects grace days and cleanup flag', () => {
  token('due', 'acc-2', { expires_at: ago(10), status: 'expired' });
  token('recent', 'acc-2', { expires_at: ago(1), status: 'expired' });
  token('keep', 'acc-2', { expires_at: ago(30), status: 'expired', cleanup_on_delete: 0 });
  // 'old2' expired only 1 day ago, so it is not due yet at a 7-day grace
  const due = q.getTokensDueForCleanup(db, 7).map((t) => t.id).sort();
  assert.deepEqual(due, ['due']);
});

test('audit log filters by account', () => {
  q.insertAuditLog(db, { action: 'x', accountId: 'acc-2' });
  q.insertAuditLog(db, { action: 'y' });
  assert.equal(q.listAuditLog(db, { accountId: 'acc-2' }).total, 1);
  assert.equal(q.listAuditLog(db, {}).total, 2);
});

test('custom templates: create, update, delete; built-ins protected', () => {
  const t = q.insertPermissionTemplate(db, { name: 'Mine', permissions: { s3Privilege: true } });
  q.updatePermissionTemplate(db, t.id, { description: 'd' });
  assert.equal(q.getPermissionTemplateById(db, t.id)!.description, 'd');
  const builtin = q.listPermissionTemplates(db).find((x) => x.is_builtin === 1)!;
  assert.equal(q.deletePermissionTemplate(db, builtin.id), false);
  assert.equal(q.deletePermissionTemplate(db, t.id), true);
});
