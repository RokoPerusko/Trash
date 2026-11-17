import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustCap,
  effectiveLevel,
  initialCap,
  scaleFor,
  wantedLevel,
} from '../public/js/quality.js';
import { createQualityBook } from '../server/quality.js';

test('kvaliteta: nacini slanja (automatski, uvijek HD, uvijek niska)', () => {
  const o = { selected: 'high', hdRequested: false, mode: 'auto' };
  assert.equal(wantedLevel(o), 'low');
  assert.equal(wantedLevel({ ...o, hdRequested: true }), 'high');
  assert.equal(wantedLevel({ ...o, mode: 'high' }), 'high');
  assert.equal(wantedLevel({ ...o, mode: 'low', hdRequested: true }), 'low'); // niska ignorira zahtjeve
  assert.equal(wantedLevel({ selected: 'high', hdRequested: false }), 'low'); // zadano je automatski
  assert.equal(wantedLevel({ selected: 'low', hdRequested: true, mode: 'auto' }), 'low');
});

test('kvaliteta: losa mreza snizuje razinu tek nakon dva losa uzorka, vraca nakon mirnog razdoblja', () => {
  const good = { selected: 'high', loss: 0 };
  const bad = { selected: 'high', loss: 0.2 };
  let s = initialCap('high');
  s = adjustCap(s, bad);
  assert.equal(s.cap, 'high'); // jedan los uzorak ne mijenja nista
  s = adjustCap(s, bad);
  assert.equal(s.cap, 'low');
  s = adjustCap(s, bad); // ne ide ispod najnize
  s = adjustCap(s, bad);
  assert.equal(s.cap, 'low');
  for (let i = 0; i < 6; i++) s = adjustCap(s, good);
  assert.equal(s.cap, 'low'); // povratak tek nakon dovoljno mirnih uzoraka
  s = adjustCap(s, good);
  assert.equal(s.cap, 'high');
  assert.equal(effectiveLevel({ selected: 'high', hdRequested: true, mode: 'auto' }, 'low'), 'low');
  assert.equal(
    effectiveLevel({ selected: 'high', hdRequested: true, mode: 'auto' }, 'high'),
    'high',
  );
  assert.equal(
    effectiveLevel({ selected: 'high', hdRequested: false, mode: 'auto' }, 'high'),
    'low',
  );
});

test('kvaliteta: smanjenje slike prema razini', () => {
  assert.equal(scaleFor('low', 720), 3);
  assert.equal(scaleFor('high', 720), 1); // nikad povecanje
});

test('HD zahtjevi gledatelja istjecu i mogu se povuci', () => {
  let t = 1_000_000;
  const book = createQualityBook(() => t);
  assert.deepEqual(book.status('a'), { hd: false, viewers: 0 });
  book.request('a', 'v1', true);
  book.request('a', 'v2', true);
  assert.deepEqual(book.status('a'), { hd: true, viewers: 2 });
  book.request('a', 'v1', false);
  assert.equal(book.status('a').viewers, 1);
  t += 16_000; // zahtjev nije obnovljen
  assert.deepEqual(book.status('a'), { hd: false, viewers: 0 });
  assert.equal(book.status('b').hd, false);
});
