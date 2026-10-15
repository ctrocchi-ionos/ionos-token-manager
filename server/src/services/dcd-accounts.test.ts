import '../test-setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeJwt, mockIonos, addTestAccount } from '../test-helpers.js';

let verifyStatus = 200;
mockIonos(() => ({ status: verifyStatus }));

const { openWorkspace } = await import('../workspace/registry.js');
const q = await import('../workspace/queries.js');
const svc = await import('./dcd-accounts.js');

const ws = openWorkspace('acc@ionos.com');

test('add: stores the account with the token encrypted by the workspace key', async () => {
  verifyStatus = 200;
  const raw = fakeJwt({ contractNumber: 500 });
  const a = await svc.addAccount(ws, '  Prod  ', `${raw}\n`);
  assert.equal(a.label, 'Prod');
  assert.equal(a.contract_number, 500);
  assert.notEqual(a.token_enc, raw);
  assert.equal(svc.getAccountAdminToken(ws, a.id), raw);
});

test('add: empty label falls back to the contract number', async () => {
  const a = await svc.addAccount(ws, '', fakeJwt({ contractNumber: 501 }));
  assert.equal(a.label, 'Contract 501');
});

test('add: same contract twice is refused with 409', async () => {
  await assert.rejects(() => svc.addAccount(ws, 'again', fakeJwt({ contractNumber: 500 })), (e: any) => e.code === 'ACCOUNT_EXISTS' && e.statusCode === 409);
});

test('add: garbage, expired, or IONOS-rejected tokens are refused with 400', async () => {
  await assert.rejects(() => svc.addAccount(ws, 'x', 'not-a-jwt'), (e: any) => e.code === 'INVALID_TOKEN');
  await assert.rejects(() => svc.addAccount(ws, 'x', fakeJwt({ contractNumber: 502, expInSeconds: -10 })), /expired/);
  verifyStatus = 401;
  await assert.rejects(() => svc.addAccount(ws, 'x', fakeJwt({ contractNumber: 503 })), (e: any) => e.code === 'INVALID_TOKEN');
  verifyStatus = 200;
  assert.equal(q.getAccountByContract(ws.db, 503), undefined);
});

test('add: IONOS unreachable gives 502, not 400', async () => {
  verifyStatus = 500;
  await assert.rejects(() => svc.addAccount(ws, 'x', fakeJwt({ contractNumber: 504 })), (e: any) => e.statusCode === 502);
  verifyStatus = 200;
});

test('replace: a token from another contract is refused and the old token keeps working', async () => {
  const a = q.getAccountByContract(ws.db, 500)!;
  const before = svc.getAccountAdminToken(ws, a.id);
  await assert.rejects(() => svc.replaceAccountToken(ws, a.id, fakeJwt({ contractNumber: 999 })), /belongs to contract 999/);
  assert.equal(svc.getAccountAdminToken(ws, a.id), before);
  const fresh = fakeJwt({ contractNumber: 500 });
  await svc.replaceAccountToken(ws, a.id, fresh);
  assert.equal(svc.getAccountAdminToken(ws, a.id), fresh);
});

test('admin token errors are explicit', () => {
  const expired = addTestAccount(ws, 600, { expired: true });
  const empty = addTestAccount(ws, 601, { noToken: true });
  assert.throws(() => svc.getAccountAdminToken(ws, expired), (e: any) => e.code === 'ACCOUNT_TOKEN_EXPIRED');
  assert.throws(() => svc.getAccountAdminToken(ws, empty), (e: any) => e.code === 'NOT_CONFIGURED');
  assert.throws(() => svc.getAccountAdminToken(ws, 'nope'), (e: any) => e.code === 'NOT_FOUND');
});

test('remove: refused while a token still holds an IONOS user; allowed after revoke', () => {
  const id = addTestAccount(ws, 700);
  q.insertManagedToken(ws.db, {
    id: 'tok-700', account_id: id, name: 'n', description: null, ionos_token_id: 't', ionos_user_id: 'u', ionos_group_id: 'g',
    sub_user_email: 'e', sub_user_password_enc: 'p', permissions: '{}', shared_resources: '[]', template_id: null,
    ttl_seconds: 60, expires_at: new Date(Date.now() + 3600_000).toISOString(), status: 'active', cleanup_on_delete: 1,
  });
  assert.throws(() => svc.removeAccount(ws, id), (e: any) => e.code === 'ACCOUNT_IN_USE');
  q.updateManagedTokenStatus(ws.db, 'tok-700', 'revoked');
  svc.removeAccount(ws, id);
  assert.equal(q.getAccount(ws.db, id), undefined);
});

test("another user's workspace cannot see or use this account", () => {
  const other = openWorkspace('someone-else@ionos.com');
  const mine = q.getAccountByContract(ws.db, 500)!;
  assert.throws(() => svc.getAccountAdminToken(other, mine.id), (e: any) => e.code === 'NOT_FOUND');
  assert.equal(q.listAccounts(other.db).length, 0);
});

test('response shape', () => {
  const a = q.getAccountByContract(ws.db, 500)!;
  const r = svc.toAccountResponse(ws, a);
  assert.equal(r.hasToken, true);
  assert.equal(r.expired, false);
  assert.equal(r.contractNumber, 500);
  assert.ok(r.daysRemaining >= 0);
  assert.equal('token_enc' in r, false);
  assert.ok(!JSON.stringify(r).includes(a.token_enc!));
  const dead = q.getAccountByContract(ws.db, 600)!;
  assert.equal(svc.toAccountResponse(ws, dead).expired, true);
});

test('replacing the token of a migrated placeholder drops "(needs token)" from its label', async () => {
  const id = addTestAccount(ws, 800, { noToken: true });
  q.renameAccount(ws.db, id, 'Contract 800 (needs token)');
  const a = await svc.replaceAccountToken(ws, id, fakeJwt({ contractNumber: 800 }));
  assert.equal(a.label, 'Contract 800');
});
