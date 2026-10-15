import '../test-setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const { encrypt, decrypt } = await import('./crypto.js');

test('encrypt/decrypt round trip', () => {
  const enc = encrypt('secret value');
  assert.notEqual(enc, 'secret value');
  assert.equal(decrypt(enc), 'secret value');
});

test('same input gives different ciphertext (random IV)', () => {
  assert.notEqual(encrypt('x'), encrypt('x'));
});

test('tampered ciphertext is rejected', () => {
  const [iv, tag, data] = encrypt('hello world').split(':');
  const flipped = Buffer.from(data, 'base64');
  flipped[0] ^= 1;
  assert.throws(() => decrypt(`${iv}:${tag}:${flipped.toString('base64')}`));
});
