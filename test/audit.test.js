import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAudit } from '../lib/audit.js';

test('zapisnik pise jednu JSON liniju po dogadjaju', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'audit-'));
  try {
    const file = join(dir, 'audit.log');
    const audit = createAudit({ file, log: () => {} });
    await audit.record('ana', '1.2.3.4', 'zona.dodana', { id: 'z1', name: 'a\nb' });
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 1);
    const e = JSON.parse(lines[0]);
    assert.equal(e.user, 'ana');
    assert.equal(e.action, 'zona.dodana');
    assert.equal(e.name, 'a\nb'); // novi redak ostaje unutar jedne linije
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('zapisnik se rotira kad prijeđe ogranicenje', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'audit-'));
  try {
    const file = join(dir, 'audit.log');
    const audit = createAudit({ file, maxBytes: 200, log: () => {} });
    for (let i = 0; i < 10; i++) await audit.record('ana', '::1', 'test', { i });
    assert.ok((await readFile(`${file}.1`, 'utf8')).length > 0);
    assert.ok((await readFile(file, 'utf8')).length <= 400);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('zapisnik skracuje preduge vrijednosti', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'audit-'));
  try {
    const file = join(dir, 'audit.log');
    const audit = createAudit({ file, log: () => {} });
    await audit.record('ana', '::1', 'test', { name: 'x'.repeat(5000) });
    assert.equal(JSON.parse(await readFile(file, 'utf8')).name.length, 200);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
