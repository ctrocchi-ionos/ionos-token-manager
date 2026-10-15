import test from 'node:test';
import assert from 'node:assert/strict';
import { requireCsrfHeader } from './csrf.js';

function run(method: string, headers: Record<string, string> = {}) {
  let status = 200;
  let nextCalled = false;
  const res: any = { status(s: number) { status = s; return this; }, json() { return this; } };
  requireCsrfHeader({ method, headers } as any, res, () => { nextCalled = true; });
  return { status, nextCalled };
}

test('GET/HEAD/OPTIONS pass without the header', () => {
  for (const m of ['GET', 'HEAD', 'OPTIONS']) assert.equal(run(m).nextCalled, true);
});

test('state-changing methods need X-Requested-With: token-manager', () => {
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(run(m).status, 403, m);
    assert.equal(run(m, { 'x-requested-with': 'XMLHttpRequest' }).status, 403, m);
    assert.equal(run(m, { 'x-requested-with': 'token-manager' }).nextCalled, true, m);
  }
});
