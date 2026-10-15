import '../test-setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';

// Fake the IONOS HTTP layer: every axios client routes DELETEs through `deleteResponses`.
const calls: string[] = [];
let deleteResponses: Record<string, number> = {};
function httpError(status: number) {
  const e: any = new Error(`HTTP ${status}`);
  e.isAxiosError = true;
  e.response = { status };
  return e;
}
(axios as any).create = () => ({
  delete: async (url: string) => {
    calls.push(url);
    const status = Object.entries(deleteResponses).find(([k]) => url.includes(k))?.[1] ?? 204;
    if (status >= 400) throw httpError(status);
    return { status, headers: {}, data: {} };
  },
});

const { initializeDatabase } = await import('../db/schema.js');
const db = await import('../db/queries.js');
const { encrypt } = await import('./crypto.js');
const { revokeManagedToken } = await import('./token-creator.js');
const { runExpiredSweep } = await import('./expired-sweep.js');
initializeDatabase();

function addToken(id: string, over: Record<string, unknown> = {}) {
  db.insertManagedToken({
    id, name: id, description: null, ionos_token_id: `tid-${id}`, ionos_user_id: `user-${id}`,
    ionos_group_id: `group-${id}`, sub_user_email: `${id}@x`, sub_user_password_enc: encrypt('pw'),
    permissions: '{}', shared_resources: '[]', template_id: null, ttl_seconds: 60,
    expires_at: new Date(Date.now() + 3600_000).toISOString(), status: 'active',
    cleanup_on_delete: 1, owner_email: 'o@x.com', ...over,
  } as any);
}
const statusOf = (id: string) => db.getManagedTokenById(id)!.status;

test('revoke deletes user and group, then marks revoked', async () => {
  calls.length = 0; deleteResponses = {};
  addToken('ok');
  await revokeManagedToken('ok', 'o@x.com', 'admin');
  assert.ok(calls.some((c) => c.includes('/um/users/user-ok')));
  assert.ok(calls.some((c) => c.includes('/um/groups/group-ok')));
  assert.equal(statusOf('ok'), 'revoked');
});

test('revoke does NOT claim success when IONOS refuses to delete the user', async () => {
  deleteResponses = { '/um/users/': 500 };
  addToken('fail');
  await assert.rejects(() => revokeManagedToken('fail', 'o@x.com', 'admin'), /Revoke incomplete/);
  assert.equal(statusOf('fail'), 'active');
  const log = db.listAuditLog({ action: 'token.revoke' });
  assert.ok(log.items.some((e) => e.entity_id === 'fail' && e.success === 0));
});

test('a 404 (already gone) counts as success', async () => {
  deleteResponses = { '/um/users/': 404, '/um/groups/': 404 };
  addToken('gone');
  await revokeManagedToken('gone', 'o@x.com', 'admin');
  assert.equal(statusOf('gone'), 'revoked');
});

test('with cleanup off, the IONOS token itself is deleted', async () => {
  calls.length = 0; deleteResponses = {};
  addToken('keep', { cleanup_on_delete: 0 });
  await revokeManagedToken('keep', 'o@x.com', 'admin');
  assert.ok(calls.some((c) => c.includes('/tokens/tid-keep')));
  assert.ok(!calls.some((c) => c.includes('/um/users/')));
  assert.equal(statusOf('keep'), 'revoked');
});

test('sweep cleans tokens expired longer than the grace period, and only those', async () => {
  deleteResponses = {};
  db.upsertUserAdminToken('o@x.com', {
    currentTokenEnc: encrypt('admin-jwt'), tokenId: 't',
    issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  });
  const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
  addToken('old', { expires_at: ago(10), status: 'expired' });
  addToken('recent', { expires_at: ago(1), status: 'expired' });
  addToken('nocleanup', { expires_at: ago(30), status: 'expired', cleanup_on_delete: 0 });

  const r = await runExpiredSweep();
  assert.equal(r.cleaned, 1);
  assert.ok(db.getManagedTokenById('old')!.cleaned_up_at);
  assert.equal(db.getManagedTokenById('recent')!.cleaned_up_at, null);
  assert.equal(db.getManagedTokenById('nocleanup')!.cleaned_up_at, null);
  assert.equal((await runExpiredSweep()).cleaned, 0); // idempotent
});
