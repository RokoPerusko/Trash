import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseZone,
  parseRoute,
  applyRoutePatch,
  LIMITS,
  zoneAlerts,
  applyZonePatch,
} from '../lib/validate.js';

const pts = [
  { lat: 45, lon: 16 },
  { lat: 45.1, lon: 16.1 },
];

test('ruta: ispravan unos dobiva id, zadanu brzinu i vremena', () => {
  const r = parseRoute({ name: ' Ruta ', points: pts });
  assert.equal(r.error, undefined);
  assert.equal(r.value.name, 'Ruta');
  assert.equal(r.value.speedKmh, 5);
  assert.ok(r.value.id && r.value.createdAt);
});

test('ruta: odbija loš unos', () => {
  assert.ok(parseRoute({ name: '', points: pts }).error);
  assert.ok(parseRoute({ name: 'x'.repeat(LIMITS.nameLen + 1), points: pts }).error);
  assert.ok(parseRoute({ name: 'a', points: [pts[0]] }).error);
  assert.ok(parseRoute({ name: 'a', points: [pts[0], { lat: 999, lon: 0 }] }).error);
  assert.ok(parseRoute({ name: 'a', points: pts, speedKmh: -1 }).error);
  assert.ok(parseRoute({ name: 'a', points: pts, speedKmh: 1e9 }).error);
  assert.ok(parseRoute({ name: 'a', points: 'nije niz' }).error);
  const tooMany = Array.from({ length: LIMITS.routePoints + 1 }, () => pts[0]);
  assert.ok(parseRoute({ name: 'a', points: tooMany }).error);
});

test('ruta: izmjena mijenja samo poslana polja', () => {
  const base = parseRoute({ name: 'A', points: pts, speedKmh: 10 }).value;
  const renamed = applyRoutePatch(base, { name: 'B' });
  assert.equal(renamed.value.name, 'B');
  assert.equal(renamed.value.speedKmh, 10);
  assert.deepEqual(renamed.value.points, pts);
  assert.equal(renamed.value.id, base.id);
  assert.ok(applyRoutePatch(base, { speedKmh: 0 }).error);
  assert.ok(applyRoutePatch(base, { name: '' }).error);
});

test('zona: krug i poligon', () => {
  const c = parseZone({ name: 'k', type: 'circle', center: { lat: 1, lon: 1 }, radiusM: 50 });
  assert.equal(c.value.type, 'circle');
  assert.ok(parseZone({ name: 'k', type: 'circle', center: { lat: 1, lon: 1 }, radiusM: 0 }).error);
  const poly = parseZone({ name: 'p', type: 'polygon', points: [...pts, { lat: 45, lon: 16.2 }] });
  assert.equal(poly.value.type, 'polygon');
  assert.ok(parseZone({ name: 'p', type: 'polygon', points: pts }).error);
  assert.ok(parseZone({ name: 'p', type: 'nepoznato' }).error);
});

test('zone: pravila alarma po smjeru i vrsti objekta', () => {
  const circle = { name: 'Z', type: 'circle', center: { lat: 45, lon: 15 }, radiusM: 100 };
  const z = parseZone(circle).value;
  assert.equal(z.alert, 'both'); // zadano: oba smjera, sve vrste
  assert.deepEqual(z.kinds, []);
  assert.ok(zoneAlerts(z, 'enter', 'uav') && zoneAlerts(z, 'exit', 'device'));

  const onlyEnter = { ...z, alert: 'enter' };
  assert.ok(zoneAlerts(onlyEnter, 'enter', 'uav'));
  assert.ok(!zoneAlerts(onlyEnter, 'exit', 'uav'));
  assert.ok(!zoneAlerts({ ...z, alert: 'off' }, 'enter', 'uav'));

  const dronesOnly = { ...z, kinds: ['uav'] };
  assert.ok(zoneAlerts(dronesOnly, 'enter', 'uav'));
  assert.ok(!zoneAlerts(dronesOnly, 'enter', 'device'));

  // stare zone bez novih polja rade kao prije
  assert.ok(zoneAlerts({ id: 'x' }, 'exit', 'device'));
  assert.equal(parseZone({ ...circle, alert: 'nesto' }).error, 'neispravan način alarma');
  assert.equal(parseZone({ ...circle, kinds: ['marker'] }).error, 'neispravne vrste objekata');

  const patched = applyZonePatch(z, { alert: 'exit', kinds: ['uav'], name: 'Novo' }).value;
  assert.deepEqual([patched.alert, patched.kinds, patched.name], ['exit', ['uav'], 'Novo']);
  assert.equal(patched.type, 'circle');
  assert.equal(applyZonePatch(z, { alert: 'x' }).error, 'neispravan način alarma');
});
