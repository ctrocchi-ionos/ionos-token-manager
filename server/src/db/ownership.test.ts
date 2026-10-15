import '../test-setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const { initializeDatabase } = await import('./schema.js');
const db = await import('./queries.js');
initializeDatabase();

test('custom templates are visible only to their owner; built-ins to everyone', () => {
  db.insertPermissionTemplate({ name: 'Builtin', permissions: {}, isBuiltin: true });
  db.insertPermissionTemplate({ name: 'A only', permissions: {}, ownerEmail: 'a@x.com' });
  db.insertPermissionTemplate({ name: 'B only', permissions: {}, ownerEmail: 'b@x.com' });
  const namesFor = (e: string) => db.listPermissionTemplates(e).map((t) => t.name).sort();
  assert.deepEqual(namesFor('a@x.com'), ['A only', 'Builtin']);
  assert.deepEqual(namesFor('b@x.com'), ['B only', 'Builtin']);
  assert.deepEqual(namesFor('nobody@x.com'), ['Builtin']);
});

test('tokens are scoped to their owner', () => {
  const base = {
    name: 't', description: null, ionos_token_id: 'tid', ionos_user_id: 'u', ionos_group_id: 'g',
    sub_user_email: 'e', sub_user_password_enc: 'p', permissions: '{}', shared_resources: '[]',
    template_id: null, ttl_seconds: 60, expires_at: new Date(Date.now() + 60000).toISOString(),
    status: 'active' as const, cleanup_on_delete: 1,
  };
  db.insertManagedToken({ ...base, id: 'tok-a', owner_email: 'a@x.com' });
  assert.ok(db.getManagedTokenById('tok-a', 'a@x.com'));
  assert.equal(db.getManagedTokenById('tok-a', 'b@x.com'), undefined);
  assert.equal(db.listManagedTokens({ ownerEmail: 'b@x.com' }).total, 0);
});
