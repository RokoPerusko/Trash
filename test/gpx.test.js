import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeToGpx, gpxFileName } from '../public/js/gpx.js';

test('GPX sadrži točke i escapira ime', () => {
  const xml = routeToGpx({
    name: 'A & B <test>',
    points: [
      { lat: 45.1, lon: 16.2 },
      { lat: 45.2, lon: 16.3 },
    ],
  });
  assert.match(xml, /<name>A &amp; B &lt;test&gt;<\/name>/);
  assert.equal((xml.match(/<rtept /g) || []).length, 2);
  assert.match(xml, /lat="45\.100000" lon="16\.200000"/);
});

test('naziv GPX datoteke je siguran', () => {
  assert.equal(gpxFileName('Ruta 1/čućur'), 'Ruta_1_čućur.gpx');
  assert.equal(gpxFileName('../../etc'), 'etc.gpx');
  assert.equal(gpxFileName('***'), 'ruta.gpx');
});
