import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoDrone } from '../server/demo.js';
import { kindOf } from '../public/js/kinds.js';

test('demo dron: kruzi iznad Zagreba, prepoznaje se kao dron, baterija pada', () => {
  const t0 = 1_700_000_000_000;
  const a = demoDrone(t0, t0);
  const b = demoDrone(t0 + 5 * 60_000, t0);
  assert.equal(kindOf(a), 'uav');
  for (const d of [a, b]) {
    assert.ok(Math.abs(d.lat - 45.813) < 0.02 && Math.abs(d.lon - 15.977) < 0.02);
    assert.ok(d.telemetry.course >= 0 && d.telemetry.course < 360);
  }
  assert.notEqual(a.lat, b.lat);
  assert.equal(a.telemetry.battery, 100);
  assert.equal(b.telemetry.battery, 95);
});
