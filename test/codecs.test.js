import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codecNames, orderCodecs } from '../public/js/codecs.js';

const caps = {
  codecs: [
    { mimeType: 'video/VP8' },
    { mimeType: 'video/rtx' },
    { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=42e01f' },
    { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=640c1f' },
    { mimeType: 'video/AV1' },
    { mimeType: 'video/red' },
  ],
};

test('kodeci: popis naziva bez pomocnih zapisa i bez duplikata', () => {
  assert.deepEqual(codecNames(caps), ['VP8', 'H264', 'AV1']);
  assert.deepEqual(codecNames(null), []);
});

test('kodeci: automatski stavlja H.264 prvi, konkretan odabir ostavlja samo taj kodek', () => {
  const auto = orderCodecs(caps.codecs, 'auto');
  assert.equal(auto[0].mimeType, 'video/H264');
  assert.equal(auto.length, caps.codecs.length); // rezerva ostaje
  const vp8 = orderCodecs(caps.codecs, 'VP8');
  assert.deepEqual(
    vp8.map((c) => c.mimeType),
    ['video/VP8', 'video/rtx', 'video/red'],
  );
  const h264 = orderCodecs(caps.codecs, 'H264');
  assert.equal(h264.filter((c) => c.mimeType === 'video/H264').length, 2); // svi profili
  assert.equal(orderCodecs(caps.codecs, 'VP9').length, caps.codecs.length); // nema ga: sve
});
