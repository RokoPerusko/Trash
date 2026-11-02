import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionStore,
  createAttemptLimiter,
  parseCookies,
  sessionCookie,
  clientIp,
  isLoopbackHost,
} from '../lib/auth.js';

test('sesija: token radi do isteka, zatim ne', () => {
  let t = 1000;
  const store = createSessionStore({ ttlMs: 500, now: () => t });
  const token = store.create({ username: 'ana' });
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(store.get(token).username, 'ana');
  t += 499;
  assert.ok(store.get(token));
  t += 2;
  assert.equal(store.get(token), null);
  assert.equal(store.size(), 0);
});

test('sesija: nepoznat, prazan i odjavljen token ne vrijede', () => {
  const store = createSessionStore({ ttlMs: 1000 });
  assert.equal(store.get('nepoznato'), null);
  assert.equal(store.get(''), null);
  assert.equal(store.get(undefined), null);
  const token = store.create({ username: 'ana' });
  store.destroy(token);
  assert.equal(store.get(token), null);
});

test('sesija: najviše max sesija, najstarija ispada', () => {
  const store = createSessionStore({ ttlMs: 1000, max: 2 });
  const a = store.create({ username: 'a' });
  store.create({ username: 'b' });
  store.create({ username: 'c' });
  assert.equal(store.size(), 2);
  assert.equal(store.get(a), null);
});

test('ograničenje pokušaja: blokira nakon max neuspjeha i otpušta nakon prozora', () => {
  let t = 0;
  const lim = createAttemptLimiter({ windowMs: 1000, max: 3, now: () => t });
  for (let i = 0; i < 2; i++) lim.fail('ip');
  assert.equal(lim.retryAfterMs('ip'), 0);
  lim.fail('ip');
  assert.equal(lim.retryAfterMs('ip'), 1000);
  assert.equal(lim.retryAfterMs('drugi'), 0);
  t += 1001;
  assert.equal(lim.retryAfterMs('ip'), 0);
});

test('ograničenje pokušaja: uspješna prijava briše brojač', () => {
  const lim = createAttemptLimiter({ windowMs: 1000, max: 2 });
  lim.fail('k');
  lim.fail('k');
  assert.ok(lim.retryAfterMs('k') > 0);
  lim.clear('k');
  assert.equal(lim.retryAfterMs('k'), 0);
});

test('kolačići: parsiranje i zastavice', () => {
  assert.deepEqual(parseCookies('a=1; tak_session=abc; x=y=z'), {
    a: '1',
    tak_session: 'abc',
    x: 'y=z',
  });
  assert.deepEqual(parseCookies(undefined), {});
  const c = sessionCookie('tok', { maxAgeSec: 60, secure: true });
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Strict/);
  assert.match(c, /Secure/);
  assert.doesNotMatch(sessionCookie('tok', { maxAgeSec: 60, secure: false }), /Secure/);
});

test('IP klijenta: X-Forwarded-For se vjeruje samo iza vlastitog proxyja', () => {
  const req = {
    headers: { 'x-forwarded-for': '6.6.6.6, 10.0.0.5' },
    socket: { remoteAddress: '1.2.3.4' },
  };
  assert.equal(clientIp(req, false), '1.2.3.4');
  assert.equal(clientIp(req, true), '10.0.0.5');
});

test('loopback adrese', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
});

test('kolacic ima zadani Path=/ ili put podputanje', () => {
  assert.match(sessionCookie('tok', { maxAgeSec: 60, secure: true }), /Path=\/;/);
  assert.match(
    sessionCookie('tok', { maxAgeSec: 60, secure: true, path: '/karta/' }),
    /Path=\/karta\/;/,
  );
});
