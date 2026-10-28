import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, KINDS } from '../public/js/kinds.js';

const ctx = { markersPath: '/api/markers' };

test('marker se prepoznaje po izvoru', () => {
  assert.equal(kindOf({ from: ['/api/markers'], type: 'a-u-G' }, ctx), 'marker');
});

test('dron se prepoznaje po CoT tipu (nepokretna krila i rotor)', () => {
  assert.equal(kindOf({ from: ['/api/eud'], type: 'a-f-A-M-F-Q' }, ctx), 'uav');
  assert.equal(kindOf({ from: ['/api/eud'], type: 'a-f-A-M-H-Q' }, ctx), 'uav');
});

test('običan uređaj i zrakoplov s posadom nisu dron', () => {
  assert.equal(kindOf({ from: ['/api/eud'], type: 'a-f-G-U-C' }, ctx), 'device');
  assert.equal(kindOf({ from: ['/api/eud'], type: 'a-f-A-C-F' }, ctx), 'device');
  assert.equal(kindOf({ from: [], type: null }, ctx), 'device');
});

test('svaka vrsta ima oznake potrebne sučelju', () => {
  for (const k of Object.values(KINDS)) {
    assert.ok(k.label && k.plural && k.shape);
  }
});
