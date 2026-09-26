import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseSpriteManifest, getSprite, frameOverLife, cellUv } from '../src/assets/spriteLibrary.ts';

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

test('spriteLibrary parses the committed manifest and rejects unknown ids', () => {
  const lib = parseSpriteManifest(manifest);
  const flame = getSprite(lib, 'flame-tongue-t1');
  assert.equal(flame.kind, 'flipbook');
  assert.deepEqual([flame.columns, flame.rows], [12, 8]);
  assert.throws(() => getSprite(lib, 'nope'), /unknown sprite id "nope"/);
});

test('spriteLibrary validates entries', () => {
  const ok = { id: 'a', file: 'a.png', kind: 'variants', cell: [8, 8], columns: 2, rows: 1 };
  assert.throws(() => parseSpriteManifest({}), /sprites/);
  assert.throws(() => parseSpriteManifest({ sprites: [ok, ok] }), /duplicate/);
  assert.throws(() => parseSpriteManifest({ sprites: [{ ...ok, kind: 'gif' }] }), /kind/);
  assert.throws(() => parseSpriteManifest({ sprites: [{ ...ok, cell: [0, 8] }] }), /cell/);
  assert.throws(() => parseSpriteManifest({ sprites: [{ ...ok, file: 'a.jpg' }] }), /png/);
});

test('flipbook frame over life and inset cell UVs', () => {
  const s = getSprite(parseSpriteManifest(manifest), 'flame-tongue-t0');
  assert.equal(frameOverLife(s, 0), 0);
  assert.equal(frameOverLife(s, 0.5), 6);
  assert.equal(frameOverLife(s, 1), 11);
  assert.equal(frameOverLife(s, 7), 11);
  const uv = cellUv(s, 0, 0), W = 40 * 12, H = 96 * 8;
  assert.equal(uv.u0, 0.5 / W);
  assert.equal(uv.u1, 39.5 / W);
  assert.equal(uv.v1, 95.5 / H);
  assert.throws(() => cellUv(s, 12, 0), RangeError);
});
