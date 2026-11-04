import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, isLoopbackHost } from '../lib/auth.js';

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
