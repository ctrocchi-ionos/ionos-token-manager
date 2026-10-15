import '../test-setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mockIonos, addTestAccount, fakeJwt } from '../test-helpers.js';

const subUserJwt = fakeJwt({ contractNumber: 300, kid: 'new-token-kid' });
mockIonos((method, url) => {
  if (method === 'POST' && url === '/um/users') return { status: 201, data: { id: 'ionos-user-1' } };
  if (method === 'POST' && url === '/um/groups') return { status: 201, data: { id: 'ionos-group-1' } };
  if (method === 'POST') return { status: 201 };
  if (method === 'GET' && url === '/tokens/generate') return { status: 200, data: { token: subUserJwt } };
  return { status: 200 };
});

const { openWorkspace } = await import('../workspace/registry.js');
const q = await import('../workspace/queries.js');
const { decryptWith } = await import('./crypto.js');
const { createManagedToken } = await import('./token-creator.js');

test('create stores the token under the account, password encrypted with the workspace key', async () => {
  const ws = openWorkspace('maker@ionos.com');
  const acc = addTestAccount(ws, 300);
  const adminToken = fakeJwt({ contractNumber: 300 });
  const r = await createManagedToken(ws, acc, adminToken, { name: 'CI', permissions: { s3Privilege: true }, ttlSeconds: 3600 });
  assert.equal(r.accountId, acc);
  assert.equal(r.tokenValue, subUserJwt);
  assert.match(r.subUserEmail, /^tkn-[0-9a-f]{8}@c300\.tokenmanager\.internal$/);
  const row = q.getManagedTokenById(ws.db, r.id)!;
  assert.equal(row.account_id, acc);
  assert.equal(row.ionos_token_id, 'new-token-kid');
  assert.equal(decryptWith(ws.key, row.sub_user_password_enc).length, 32);
  assert.ok(q.listAuditLog(ws.db, { action: 'token.create', accountId: acc }).total === 1);
});
