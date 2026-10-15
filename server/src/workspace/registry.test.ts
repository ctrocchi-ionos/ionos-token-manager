import '../test-setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';

const reg = await import('./registry.js');

test('case and whitespace variants of an email open the same workspace', () => {
  const a = reg.openWorkspace('Bob@IONOS.com ');
  const b = reg.openWorkspace('bob@ionos.com');
  assert.equal(a, b);
  assert.equal(a.email, 'bob@ionos.com');
  assert.match(a.id, /^[0-9a-f]{32}$/);
});

test('different users get different folders, files and keys', () => {
  const a = reg.openWorkspace('alice@ionos.com');
  const b = reg.openWorkspace('carol@ionos.com');
  assert.notEqual(a.id, b.id);
  assert.notDeepEqual(a.key, b.key);
  assert.notEqual(a.db.name, b.db.name);
});

test('workspace folder is private to the server user', () => {
  const ws = reg.openWorkspace('dave@ionos.com');
  const mode = statSync(join(reg.workspacesRoot(), ws.id)).mode & 0o777;
  assert.equal(mode, 0o700);
});

test('built-in templates are seeded once per workspace', () => {
  const ws = reg.openWorkspace('erin@ionos.com');
  reg.closeAllWorkspaces();
  const again = reg.openWorkspace('erin@ionos.com'); // seeding runs again, must not duplicate
  const n = (again.db.prepare('SELECT COUNT(*) AS c FROM permission_templates WHERE is_builtin = 1').get() as { c: number }).c;
  assert.equal(n, 9);
  assert.equal(ws.id, again.id);
});

test('a workspace file whose recorded owner differs is refused', () => {
  const ws = reg.openWorkspace('frank@ionos.com');
  const file = ws.db.name;
  reg.closeAllWorkspaces();
  const raw = new Database(file);
  raw.prepare("UPDATE workspace_meta SET value = 'mallory@ionos.com' WHERE key = 'owner_email'").run();
  raw.close();
  assert.throws(() => reg.openWorkspace('frank@ionos.com'), /different user/);
});

test('listWorkspaceEmails finds every valid workspace', () => {
  reg.openWorkspace('gina@ionos.com');
  const emails = reg.listWorkspaceEmails();
  assert.ok(emails.includes('gina@ionos.com'));
  assert.ok(emails.includes('bob@ionos.com'));
  assert.ok(!emails.includes('mallory@ionos.com'));
});

test('hardenDataDir keeps workspaces usable across restarts', async () => {
  const { config } = await import('../config.js');
  reg.openWorkspace('restart@ionos.com');
  reg.closeAllWorkspaces();
  config.hardenDataDir();
  assert.equal(statSync(reg.workspacesRoot()).mode & 0o777, 0o700);
  assert.doesNotThrow(() => reg.openWorkspace('restart@ionos.com'));
});

test('a workspace nobody uses is closed after the idle time, and reopens on the next use', () => {
  const { ws, release } = reg.acquireWorkspace('idle@ionos.com');
  ws.db.prepare("INSERT INTO workspace_meta (key, value) VALUES ('marker', 'kept')").run();
  const later = Date.now() + reg.IDLE_CLOSE_MS + 1000;
  reg.closeIdleWorkspaces(later);
  assert.ok(reg.isWorkspaceOpen('idle@ionos.com'), 'still held: must not close');
  release();
  reg.closeIdleWorkspaces(later);
  assert.equal(reg.isWorkspaceOpen('idle@ionos.com'), false);
  assert.equal(ws.db.open, false);
  const again = reg.openWorkspace('idle@ionos.com');
  assert.equal((again.db.prepare("SELECT value FROM workspace_meta WHERE key = 'marker'").get() as { value: string }).value, 'kept');
});

test('a recently used workspace stays open', () => {
  const { release } = reg.acquireWorkspace('busy@ionos.com');
  release();
  reg.closeIdleWorkspaces(Date.now() + 1000);
  assert.ok(reg.isWorkspaceOpen('busy@ionos.com'));
});

test('closeWorkspaceIfUnused closes only a workspace nobody holds', () => {
  const { release } = reg.acquireWorkspace('held@ionos.com');
  reg.closeWorkspaceIfUnused('held@ionos.com');
  assert.ok(reg.isWorkspaceOpen('held@ionos.com'));
  release();
  release(); // a second release changes nothing
  reg.closeWorkspaceIfUnused('held@ionos.com');
  assert.equal(reg.isWorkspaceOpen('held@ionos.com'), false);
});

test('the expiry sweep closes the workspaces it opened, and leaves open ones open', async () => {
  const { runExpiredSweep } = await import('../services/expired-sweep.js');
  reg.openWorkspace('swept-closed@ionos.com');
  reg.closeAllWorkspaces();
  reg.openWorkspace('swept-open@ionos.com');
  await runExpiredSweep();
  assert.equal(reg.isWorkspaceOpen('swept-closed@ionos.com'), false);
  assert.ok(reg.isWorkspaceOpen('swept-open@ionos.com'));
});
