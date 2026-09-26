import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const committed = 'assets/sprites';
const manifest = JSON.parse(readFileSync(join(committed, 'manifest.json'), 'utf8'));

test('sprite manifest entries point at real PNGs with matching dimensions', () => {
  const ids = new Set<string>();
  for (const s of manifest.sprites) {
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
    ids.add(s.id);
    const buf = readFileSync(join(committed, s.file));
    assert.equal(buf.subarray(1, 4).toString(), 'PNG');
    assert.equal(buf.readUInt32BE(16), s.cell[0] * s.columns, `${s.id} width`);
    assert.equal(buf.readUInt32BE(20), s.cell[1] * s.rows, `${s.id} height`);
  }
  for (const id of ['flame-tongue-t0', 'smoke-puff', 'soft-glow', 'spark-streak', 'electric-arc', 'dissolve-noise']) assert.ok(ids.has(id), id);
});

test('baker is deterministic and matches the committed sheets', () => {
  const out = mkdtempSync(join(tmpdir(), 'sprites-'));
  execFileSync(process.execPath, ['tools/bake-sprites.mjs', out]);
  for (const s of manifest.sprites) {
    assert.ok(existsSync(join(out, s.file)), s.file);
    assert.ok(readFileSync(join(out, s.file)).equals(readFileSync(join(committed, s.file))), `${s.file} differs — rebake and commit`);
  }
});
