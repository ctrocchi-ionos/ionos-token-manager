import '../test-setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PROXY_SECRET = 'x'.repeat(32);
const { ssoAuth, assertSafeAuthConfig } = await import('./sso-auth.js');

const SECRET = { 'x-proxy-secret': 'x'.repeat(32) };

function run(headers: Record<string, string>) {
  const req: any = { headers, method: 'GET', path: '/api/x', ip: '1.2.3.4' };
  let status = 200;
  let body: any;
  const res: any = { status(s: number) { status = s; return this; }, json(b: unknown) { body = b; return this; } };
  let nextCalled = false;
  ssoAuth(req, res, () => { nextCalled = true; });
  return { status, body, nextCalled, user: req.user };
}

test('when PROXY_SECRET is set: rejects a missing or wrong secret', () => {
  assert.equal(run({ 'x-auth-email': 'a@ionos.com' }).status, 401);
  assert.equal(run({ 'x-auth-email': 'a@ionos.com', 'x-proxy-secret': 'nope' }).status, 401);
});

test('accepts one email, trimmed and lower-cased', () => {
  const r = run({ ...SECRET, 'x-auth-email': ' A@IONOS.com ' });
  assert.equal(r.nextCalled, true);
  assert.equal(r.user.email, 'a@ionos.com');
});

test('rejects a header carrying two emails (duplicated header)', () => {
  assert.equal(run({ ...SECRET, 'x-auth-email': 'a@ionos.com, b@ionos.com' }).status, 401);
});

test('rejects things that are not an email', () => {
  for (const bad of ['', 'bob', 'bob@', '@ionos.com', 'a b@ionos.com', `${'x'.repeat(250)}@ionos.com`]) {
    assert.equal(run({ ...SECRET, 'x-auth-email': bad }).status, 401, bad);
  }
});

test('DEV_AUTH_EMAIL is ignored unless ALLOW_DEV_AUTH=1', () => {
  process.env.DEV_AUTH_EMAIL = 'dev@ionos.com';
  assert.equal(run({ ...SECRET }).status, 401);
  process.env.ALLOW_DEV_AUTH = '1';
  assert.equal(run({ ...SECRET }).user.email, 'dev@ionos.com');
  delete process.env.ALLOW_DEV_AUTH;
});

test('startup check: dev login never in production; a proxy secret, if used, is long', () => {
  assert.throws(() => assertSafeAuthConfig({ proxySecret: '', devAuth: true, nodeEnv: 'production' }), /ALLOW_DEV_AUTH/);
  assert.throws(() => assertSafeAuthConfig({ proxySecret: 'short', devAuth: false, nodeEnv: 'production' }), /32 characters/);
  assert.doesNotThrow(() => assertSafeAuthConfig({ proxySecret: '', devAuth: false, nodeEnv: 'production' }));
  assert.doesNotThrow(() => assertSafeAuthConfig({ proxySecret: '', devAuth: true, nodeEnv: undefined }));
});
