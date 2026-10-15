import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, csvRow } from './csv.js';

test('quotes and doubles inner quotes', () => {
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
});

test('defuses spreadsheet formulas', () => {
  for (const bad of ['=1+1', '+SUM(A1)', '-2', '@cmd', '\tx']) {
    assert.ok(csvCell(bad).startsWith(`"'`), bad);
  }
});

test('null and undefined become empty cells', () => {
  assert.equal(csvRow(['a', null, undefined, 3]), '"a","","","3"');
});
