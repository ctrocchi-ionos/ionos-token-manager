import '../test-setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'timers/promises';
import { mockIonos, addTestAccount, fakeJwt } from '../test-helpers.js';
import type { NewTokenRow } from '../workspace/queries.js';

/** A request to IONOS that waits until the test lets it through. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => { open = r; });
  return { opened, open };
}
let holdGenerate: Promise<void> | undefined;
let holdUserDelete: Promise<void> | undefined;
const freshJwt = fakeJwt({ contractNumber: 100, kid: 'regenerated-kid', expInSeconds: 30 * 86400 });

const calls = mockIonos(async (method, url) => {
  if (method === 'GET' && url === '/tokens/generate') {
    if (holdGenerate) await holdGenerate;
    return { status: 200, data: { token: freshJwt } };
  }
  if (method === 'DELETE' && url.startsWith('/um/users/') && holdUserDelete) await holdUserDelete;
  return { status: method === 'DELETE' ? 204 : 200 };
});

const { openWorkspace } = await import('../workspace/registry.js');
const q = await import('../workspace/queries.js');
const { encryptWith } = await import('./crypto.js');
const { regenerateToken, revokeManagedToken } = await import('./token-creator.js');
const { runExpiredSweep } = await import('./expired-sweep.js');

const ws = openWorkspace('racer@ionos.com');
const acc = addTestAccount(ws, 100);
const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

function addToken(id: string, over: Partial<NewTokenRow> = {}) {
  q.insertManagedToken(ws.db, {
    id, account_id: acc, name: id, description: null, ionos_token_id: `old-${id}`, ionos_user_id: `user-${id}`,
    ionos_group_id: `group-${id}`, sub_user_email: `${id}@x`, sub_user_password_enc: encryptWith(ws.key, 'pw'),
    permissions: '{}', shared_resources: '[]', template_id: null, ttl_seconds: 60,
    expires_at: new Date(Date.now() + 3600_000).toISOString(), status: 'active', cleanup_on_delete: 1, ...over,
  });
}
const row = (id: string) => q.getManagedTokenById(ws.db, id);

test('the sweep does not delete the IONOS user of a token regenerated while it runs', async () => {
  calls.length = 0;
  addToken('regen-first', { expires_at: ago(10), status: 'expired' });
  const g = gate();
  holdGenerate = g.opened;
  const regen = regenerateToken(ws, 'regen-first');
  await tick(); // regenerate is now waiting for IONOS
  const sweep = runExpiredSweep(); // it reads the token as due for cleanup...
  await tick();
  g.open(); // ...then the regenerate finishes
  holdGenerate = undefined;
  const [, r] = await Promise.all([regen, sweep]);

  assert.equal(r.cleaned, 0);
  assert.ok(!calls.includes('DELETE /um/users/user-regen-first'));
  assert.equal(row('regen-first')!.status, 'active');
  assert.equal(row('regen-first')!.cleaned_up_at, null);
  assert.equal(row('regen-first')!.ionos_token_id, 'regenerated-kid');
});

test('a regenerate that arrives while the sweep is removing the IONOS user waits, then refuses', async () => {
  calls.length = 0;
  addToken('sweep-first', { expires_at: ago(10), status: 'expired' });
  const g = gate();
  holdUserDelete = g.opened;
  const sweep = runExpiredSweep();
  await tick(); // the sweep is now deleting the sub-user
  const regen = regenerateToken(ws, 'sweep-first');
  await tick();
  g.open();
  holdUserDelete = undefined;
  assert.equal((await sweep).cleaned, 1);
  await assert.rejects(regen, /cleaned up/);
  assert.ok(!calls.includes('GET /tokens/generate'));
  assert.ok(row('sweep-first')!.cleaned_up_at);
});

test('a revoke that arrives during a regenerate wins: the token ends revoked, its IONOS user deleted', async () => {
  calls.length = 0;
  addToken('both');
  const g = gate();
  holdGenerate = g.opened;
  const regen = regenerateToken(ws, 'both');
  await tick();
  const revoke = revokeManagedToken(ws, 'both');
  await tick();
  g.open();
  holdGenerate = undefined;
  await Promise.all([regen, revoke]);

  assert.equal(row('both')!.status, 'revoked');
  assert.ok(calls.includes('DELETE /um/users/user-both'));
  assert.ok(calls.indexOf('GET /tokens/generate') < calls.indexOf('DELETE /um/users/user-both'));
});

test('a token removed while it is being regenerated (e.g. by a restore) is not revived, and the new IONOS token is deleted', async () => {
  calls.length = 0;
  addToken('wiped');
  const g = gate();
  holdGenerate = g.opened;
  const regen = regenerateToken(ws, 'wiped');
  await tick();
  q.deleteManagedToken(ws.db, 'wiped'); // not under the token lock, like a restore
  g.open();
  holdGenerate = undefined;
  await assert.rejects(regen, (e: any) => e.code === 'TOKEN_CHANGED' && e.statusCode === 409);
  assert.equal(row('wiped'), undefined);
  assert.ok(calls.includes('DELETE /tokens/regenerated-kid'));
});

test('recording a regenerated token never brings a revoked or cleaned-up token back', () => {
  addToken('rev', { status: 'revoked' });
  assert.equal(q.updateManagedTokenIonosId(ws.db, 'rev', 'new', new Date().toISOString()), false);
  assert.equal(row('rev')!.status, 'revoked');
  addToken('clean', { status: 'expired', expires_at: ago(10) });
  q.markTokenCleanedUp(ws.db, 'clean');
  assert.equal(q.updateManagedTokenIonosId(ws.db, 'clean', 'new', new Date().toISOString()), false);
  assert.equal(row('clean')!.status, 'expired');
  addToken('live');
  assert.equal(q.updateManagedTokenIonosId(ws.db, 'live', 'new', new Date().toISOString()), true);
});
