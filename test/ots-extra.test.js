import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapStatus, mapGroups, mapMissions, rbLine } from '../server/ots-extra.js';
import { kindOf } from '../public/js/kinds.js';

test('stanje OTS-a: preuzima verziju, opterećenje i uptime', () => {
  const s = mapStatus({
    ots_version: '1.7.13',
    ots_uptime: 1227176.7,
    cpu_percent: 22.3,
    memory: { percent: 53 },
    disk_usage: { percent: 39 },
    load_avg: [1.2006, 0.7446, 0.6953],
    online_euds: 1,
  });
  assert.equal(s.version, '1.7.13');
  assert.equal(s.uptimeSec, 1227177);
  assert.equal(s.memory, 53);
  assert.deepEqual(s.load, [1.2, 0.74, 0.7]);
  assert.equal(mapStatus(null), null);
});

test('grupe i misije: broje korisnike, podnose prazne i neočekivane zapise', () => {
  const g = mapGroups({
    results: [{ id: 2, name: 'ADS-B', type: 'SYSTEM', users: [1, 2], missions: [] }],
  });
  assert.deepEqual(g[0], {
    id: '2',
    name: 'ADS-B',
    type: 'SYSTEM',
    description: null,
    users: 2,
    missions: 0,
  });
  assert.deepEqual(mapGroups({}), []);
  const m = mapMissions({
    results: [{ name: 'Misija 1', description: 'opis', owner: { x: 1 }, size: 3 }],
  });
  assert.equal(m[0].name, 'Misija 1');
  assert.deepEqual(m[0].fields, { name: 'Misija 1', description: 'opis', size: 3 });
  assert.deepEqual(mapMissions(null), []);
});

test('R&B linija: prepoznaje uobičajene oblike, preskače nevaljane', () => {
  const a = rbLine({
    uid: 'a',
    start: { latitude: 45.8, longitude: 16 },
    end: { lat: 45.9, lon: 16.1 },
  });
  assert.deepEqual(
    [a.from, a.to],
    [
      { lat: 45.8, lon: 16 },
      { lat: 45.9, lon: 16.1 },
    ],
  );
  const b = rbLine({
    start_latitude: 45,
    start_longitude: 15,
    end_latitude: 46,
    end_longitude: 16,
  });
  assert.equal(b.to.lat, 46);
  assert.equal(rbLine({ start: { latitude: 45, longitude: 15 } }), null);
  assert.equal(
    rbLine({ start: { latitude: 999, longitude: 15 }, end: { latitude: 1, longitude: 1 } }),
    null,
  );
  assert.equal(rbLine(null), null);
});

test('vrste: CASEVAC, zrakoplovi i plovila iz CoT-a, dron ima prednost', () => {
  const ctx = { markersPath: '/api/markers', casevacPath: '/api/casevac' };
  assert.equal(kindOf({ from: ['/api/casevac'], type: 'b-r-f-h-c' }, ctx), 'casevac');
  assert.equal(kindOf({ from: ['cot'], type: 'a-n-A-C-F' }, ctx), 'aircraft');
  assert.equal(kindOf({ from: ['cot'], type: 'a-f-A-M-F-Q' }, ctx), 'uav');
  assert.equal(kindOf({ from: ['cot'], type: 'a-n-S-X' }, ctx), 'vessel');
  assert.equal(kindOf({ from: ['/api/eud'], type: 'a-f-G-U-C' }, ctx), 'device');
  assert.equal(kindOf({ from: ['/api/markers'], type: 'a-u-G' }, ctx), 'marker');
});
