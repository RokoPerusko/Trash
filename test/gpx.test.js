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

import { splitTrack, trackToGpx, trackToKml } from '../public/js/gpx.js';

test('trag: dionice se dijele na prekidu signala, GPX i KML imaju sve tocke', () => {
  const t0 = Date.UTC(2026, 10, 16, 10, 0, 0);
  const pts = [
    { t: t0, lat: 45.1, lon: 15.1, alt: 100 },
    { t: t0 + 60_000, lat: 45.2, lon: 15.2, alt: 110 },
    { t: t0 + 20 * 60_000, lat: 45.3, lon: 15.3, alt: null }, // prekid > 5 min
    { t: t0 + 21 * 60_000, lat: 45.4, lon: 15.4, alt: null },
  ];
  assert.equal(splitTrack(pts).length, 2);
  const gpx = trackToGpx('Dron <1>', pts);
  assert.equal((gpx.match(/<trkpt /g) || []).length, 4);
  assert.equal((gpx.match(/<trkseg>/g) || []).length, 2);
  assert.ok(
    gpx.includes('Dron &lt;1&gt;') && gpx.includes('<time>2026-11-16T10:00:00.000Z</time>'),
  );
  const kml = trackToKml('Dron', pts);
  assert.equal((kml.match(/<Placemark>/g) || []).length, 2);
  assert.ok(kml.includes('15.100000,45.100000,100'));
  assert.equal(gpxFileName('Dron 1', 'kml'), 'Dron_1.kml');
});
