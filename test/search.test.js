import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchLocal } from '../public/js/search-core.js';
import { mapPlaces } from '../server/geocode.js';

const data = {
  items: [
    { id: 'u1', name: 'Demo dron', kind: 'uav' },
    { id: 'u2', name: 'iPhone Roko', kind: 'device' },
    { id: 'u3', name: 'Dronovi skladište', kind: 'marker' },
  ],
  zones: [{ id: 'z1', name: 'Skladište Žitnjak' }],
  routes: [{ id: 'r1', name: 'Ruta do Čakovca' }],
};

test('pretraga: pocetak rijeci ispred sredine, radi bez kvacica, po grupama', () => {
  const r = searchLocal('dron', data);
  assert.deepEqual(
    r.map((x) => x.id),
    ['u3', 'u1'],
  ); // pocetak naziva ide ispred pocetka kasnije rijeci
  const s = searchLocal('skladiste', data); // bez kvacice
  assert.deepEqual(
    s.map((x) => [x.group, x.id]),
    [
      ['Objekti', 'u3'],
      ['Zone', 'z1'],
    ],
  );
  assert.equal(searchLocal('cakov', data)[0].id, 'r1');
  assert.deepEqual(searchLocal('', data), []);
  assert.deepEqual(searchLocal('xyz', data), []);
});

test('geokodiranje: odgovor Nominatima u popis mjesta, neispravni zapisi se izbacuju', () => {
  const places = mapPlaces([
    { display_name: 'Zagreb, Hrvatska', lat: '45.8131', lon: '15.9775', type: 'city' },
    { display_name: 'Bez koordinata', lat: 'x', lon: '1' },
    { lat: '1', lon: '2' },
  ]);
  assert.equal(places.length, 1);
  assert.deepEqual([places[0].lat, places[0].lon], [45.8131, 15.9775]);
  assert.deepEqual(mapPlaces(null), []);
});
