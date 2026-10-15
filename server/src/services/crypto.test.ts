import '../test-setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const { encryptWith, decryptWith, deriveWorkspaceKey } = await import('./crypto.js');
const master = Buffer.alloc(32, 7);

test('encryptWith/decryptWith round trip', () => {
  const enc = encryptWith(master, 'secret value');
  assert.notEqual(enc, 'secret value');
  assert.equal(decryptWith(master, enc), 'secret value');
});

test('same input gives different ciphertext (random IV)', () => {
  assert.notEqual(encryptWith(master, 'x'), encryptWith(master, 'x'));
});

test('tampered ciphertext is rejected', () => {
  const [iv, tag, data] = encryptWith(master, 'hello world').split(':');
  const flipped = Buffer.from(data, 'base64');
  flipped[0] ^= 1;
  assert.throws(() => decryptWith(master, `${iv}:${tag}:${flipped.toString('base64')}`));
});

test('workspace keys are deterministic, distinct per workspace, and not the master key', () => {
  const a1 = deriveWorkspaceKey(master, 'ws-a');
  const a2 = deriveWorkspaceKey(master, 'ws-a');
  const b = deriveWorkspaceKey(master, 'ws-b');
  assert.equal(a1.length, 32);
  assert.deepEqual(a1, a2);
  assert.notDeepEqual(a1, b);
  assert.notDeepEqual(a1, master);
});

test("one workspace's key cannot read another workspace's secret", () => {
  const enc = encryptWith(deriveWorkspaceKey(master, 'ws-a'), 'token');
  assert.throws(() => decryptWith(deriveWorkspaceKey(master, 'ws-b'), enc));
});

test('rejects keys that are not 32 bytes', () => {
  assert.throws(() => encryptWith(Buffer.alloc(16), 'x'), /32 bytes/);
  assert.throws(() => deriveWorkspaceKey(Buffer.alloc(16), 'ws'), /32 bytes/);
});

test('a truncated auth tag is rejected (only full 16-byte tags are accepted)', () => {
  const [iv, tag, data] = encryptWith(master, 'hello world').split(':');
  const short = Buffer.from(tag, 'base64').subarray(0, 4).toString('base64');
  assert.throws(() => decryptWith(master, `${iv}:${short}:${data}`));
});
