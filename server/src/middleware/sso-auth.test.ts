import '../test-setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PROXY_SECRET = 's3cret-value';
const { ssoAuth } = await import('./sso-auth.js');

function run(headers: Record<string, string>) {
  const req: any = { headers, method: 'GET', path: '/api/x', ip: '1.2.3.4' };
  let status = 200;
  const res: any = { status(s: number) { status = s; return this; }, json() { return this; } };
  let nextCalled = false;
  ssoAuth(req, res, () => { nextCalled = true; });
  return { status, nextCalled, user: req.user };
}

test('rejects when proxy secret is missing', () => {
  const r = run({ 'x-auth-email': 'a@b.com' });
  assert.equal(r.status, 401);
  assert.equal(r.nextCalled, false);
});

test('rejects a wrong proxy secret', () => {
  assert.equal(run({ 'x-auth-email': 'a@b.com', 'x-proxy-secret': 'nope' }).status, 401);
});

test('accepts correct secret and lower-cases the email', () => {
  const r = run({ 'x-auth-email': ' A@B.com ', 'x-proxy-secret': 's3cret-value' });
  assert.equal(r.nextCalled, true);
  assert.equal(r.user.email, 'a@b.com');
});

test('rejects a missing email even with the right secret', () => {
  assert.equal(run({ 'x-proxy-secret': 's3cret-value' }).status, 401);
});

test('DEV_AUTH_EMAIL is ignored unless ALLOW_DEV_AUTH=1', () => {
  process.env.DEV_AUTH_EMAIL = 'dev@x.com';
  assert.equal(run({ 'x-proxy-secret': 's3cret-value' }).status, 401);
  process.env.ALLOW_DEV_AUTH = '1';
  const r = run({ 'x-proxy-secret': 's3cret-value' });
  assert.equal(r.user.email, 'dev@x.com');
});
