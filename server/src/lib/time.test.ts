import test from 'node:test';
import assert from 'node:assert/strict';
import { isoUtc } from './time.js';

test('SQLite UTC timestamps get a zone; ISO values and null pass through', () => {
  assert.equal(isoUtc('2026-10-16 08:30:00'), '2026-10-16T08:30:00Z');
  assert.equal(isoUtc('2026-10-16 08:30:00.123'), '2026-10-16T08:30:00.123Z');
  assert.equal(isoUtc('2026-10-16T08:30:00.000Z'), '2026-10-16T08:30:00.000Z');
  assert.equal(isoUtc(null), null);
  assert.equal(new Date(isoUtc('2026-10-16 08:30:00')).toISOString(), '2026-10-16T08:30:00.000Z');
});
