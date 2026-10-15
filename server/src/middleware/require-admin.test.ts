import '../test-setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ADMIN_EMAILS = 'Boss@x.com, other@x.com';
const { initializeDatabase } = await import('../db/schema.js');
const { requireAdmin } = await import('./require-admin.js');
const db = await import('../db/queries.js');
initializeDatabase();

function run(email: string) {
  const req: any = { user: { email }, path: '/backup/key' };
  let status = 200;
  const res: any = { status(s: number) { status = s; return this; }, json() { return this; } };
  let nextCalled = false;
  requireAdmin(req, res, () => { nextCalled = true; });
  return { status, nextCalled };
}

test('listed admin passes (case-insensitive list)', () => {
  assert.equal(run('boss@x.com').nextCalled, true);
});

test('non-admin gets 403 and a failed audit entry', () => {
  const r = run('user@x.com');
  assert.equal(r.status, 403);
  assert.equal(r.nextCalled, false);
  const log = db.listAuditLog({ action: 'auth.denied', actorEmail: 'user@x.com' });
  assert.equal(log.total, 1);
  assert.equal(log.items[0].success, 0);
});
