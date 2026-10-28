import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineM,
  bearingDeg,
  pointInPolygon,
  zoneContains,
  routeLegs,
  routeLength,
  sampleRoute,
  elevationStats,
  formatDistance,
  formatDuration,
  travelSeconds,
  circlePoints,
} from '../public/js/geo.js';

const near = (actual, expected, tol) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} nije unutar ${tol} od ${expected}`);

test('haversine: 1 stupanj geografske širine je oko 111,19 km', () => {
  near(haversineM(45, 16, 46, 16), 111195, 100);
  assert.equal(haversineM(45, 16, 45, 16), 0);
});

test('azimut: sjever, istok, jug, zapad', () => {
  near(bearingDeg(45, 16, 46, 16), 0, 0.01);
  near(bearingDeg(0, 16, 0, 17), 90, 0.01);
  near(bearingDeg(46, 16, 45, 16), 180, 0.01);
  near(bearingDeg(0, 17, 0, 16), 270, 0.01);
});

test('točka u poligonu i krugu', () => {
  const square = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 2 },
    { lat: 2, lon: 2 },
    { lat: 2, lon: 0 },
  ];
  assert.equal(pointInPolygon(1, 1, square), true);
  assert.equal(pointInPolygon(3, 1, square), false);
  const circle = { type: 'circle', center: { lat: 45, lon: 16 }, radiusM: 1000 };
  assert.equal(zoneContains(circle, 45.001, 16), true);
  assert.equal(zoneContains(circle, 45.02, 16), false);
});

test('dionice i duljina rute', () => {
  const pts = [
    { lat: 45, lon: 16 },
    { lat: 46, lon: 16 },
    { lat: 46, lon: 17 },
  ];
  const legs = routeLegs(pts);
  assert.equal(legs.length, 2);
  near(legs[0].dist, 111195, 100);
  near(legs[0].bearing, 0, 0.01);
  near(legs[1].bearing, 90, 0.5);
  near(routeLength(pts), legs[0].dist + legs[1].dist, 0.001);
  assert.equal(routeLength([{ lat: 1, lon: 1 }]), 0);
});

test('uzorkovanje rute: krajevi i broj uzoraka', () => {
  const pts = [
    { lat: 45, lon: 16 },
    { lat: 46, lon: 16 },
  ];
  const s = sampleRoute(pts, 10);
  assert.equal(s.length, 11);
  near(s[0].lat, 45, 1e-9);
  near(s[10].lat, 46, 1e-9);
  near(s[5].lat, 45.5, 1e-6);
  near(s[10].dist, routeLength(pts), 0.001);
});

test('uzorkovanje rute: sve točke na istom mjestu ne ruši', () => {
  const s = sampleRoute(
    [
      { lat: 1, lon: 1 },
      { lat: 1, lon: 1 },
    ],
    5,
  );
  assert.equal(s.length, 2);
});

test('uspon i spust', () => {
  const st = elevationStats([100, 120, 110, 150, 140]);
  assert.equal(st.ascent, 60);
  assert.equal(st.descent, 20);
  assert.equal(st.min, 100);
  assert.equal(st.max, 150);
  assert.deepEqual(elevationStats([]), { ascent: 0, descent: 0, min: 0, max: 0 });
});

test('formatiranje', () => {
  assert.equal(formatDistance(450), '450 m');
  assert.equal(formatDistance(1500), '1.50 km');
  assert.equal(formatDuration(20), '< 1 min');
  assert.equal(formatDuration(3900), '1 h 05 min');
  assert.equal(formatDuration(600), '10 min');
  assert.equal(formatDuration(Infinity), '—');
  assert.equal(travelSeconds(5000, 5), 3600);
  assert.equal(travelSeconds(5000, 0), Infinity);
});

test('obrub kruga: sve točke su na udaljenosti radijusa i krug je zatvoren', () => {
  const center = { lat: 45.8, lon: 15.97 };
  const pts = circlePoints(center, 500, 32);
  assert.equal(pts.length, 33);
  for (const p of pts) near(haversineM(center.lat, center.lon, p.lat, p.lon), 500, 0.5);
  near(pts[0].lat, pts[32].lat, 1e-9);
  near(pts[0].lon, pts[32].lon, 1e-9);
});
