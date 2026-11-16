import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAlerts, matchAlert } from '../public/js/alert-filter.js';

const rows = [
  { key: 'a', deviceId: 'd1', deviceName: 'Dron 1', title: 'Dron 1 ušao u zonu' },
  { key: 'b', deviceId: 'd2', deviceName: 'iPhone', title: 'iPhone: baterija 10 %' },
  { key: 'c', deviceId: 'd2', deviceName: 'iPhone', title: 'iPhone ne javlja' },
  { key: 'd', deviceId: null, title: 'Hitni poziv' },
];

test('alarmi: skriveni i utisani se odvajaju, ostali ostaju', () => {
  const s = splitAlerts(rows, { hidden: new Set(['a']), muted: new Set(['d2']) });
  assert.deepEqual(
    s.visible.map((r) => r.key),
    ['d'],
  );
  assert.deepEqual(
    s.mutedRows.map((r) => r.key),
    ['b', 'c'],
  );
  assert.equal(s.hiddenCount, 1);
});

test('alarmi: pretraga po nazivu uredjaja i tekstu, bez obzira na velika slova', () => {
  assert.ok(matchAlert(rows[1], 'IPHONE'));
  assert.ok(matchAlert(rows[0], 'zonu'));
  assert.ok(!matchAlert(rows[0], 'iphone'));
  assert.ok(matchAlert(rows[3], ''));
});
