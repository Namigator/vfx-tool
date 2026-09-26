import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseSpriteManifest, getSprite, frameOverLife, cellUv, spriteCell } from '../src/assets/spriteLibrary.ts';
import { BUILTIN_SPRITES } from '../src/assets/builtinSprites.generated.ts';

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
  for (const id of ['flame-tongue-a', 'flame-tongue-b', 'smoke-puff', 'foam', 'soft-glow', 'spark-streak', 'electric-arc', 'droplet', 'ripple-ring', 'dissolve-noise']) assert.ok(ids.has(id), id);
  for (const s of manifest.sprites) if (s.kind === 'flipbook') assert.deepEqual([s.columns, s.rows, s.cell[0], s.cell[1]], [4, 4, 256, 256], `${s.id} follows 10-ASSETS 4x4/256`);
  for (const s of manifest.sprites) assert.ok(s.cell[0] * s.columns <= 1024, `${s.id} atlas <= 1024`);
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
  const flame = getSprite(lib, 'flame-tongue-b');
  assert.equal(flame.kind, 'flipbook');
  assert.deepEqual([flame.columns, flame.rows], [4, 4]);
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
  const s = getSprite(parseSpriteManifest(manifest), 'flame-tongue-a');
  assert.equal(frameOverLife(s, 0), 0);
  assert.equal(frameOverLife(s, 0.5), 8);
  assert.equal(frameOverLife(s, 1), 15);
  assert.equal(frameOverLife(s, 7), 15);
  const uv = cellUv(s, 0, 0), W = 256 * 4;
  assert.equal(uv.u0, 0.5 / W);
  assert.equal(uv.u1, 255.5 / W);
  assert.throws(() => cellUv(s, 4, 0), RangeError);
});

test('generated TS sprite table matches the manifest', () => {
  assert.deepEqual(BUILTIN_SPRITES.map(s => [s.id, s.file, s.kind, s.columns, s.rows, s.cell, s.blend]), manifest.sprites.map((s: Record<string, unknown>) => [s.id, s.file, s.kind, s.columns, s.rows, s.cell, s.blend]));
});

test('spriteCell: overLife plays once, fps loops from a random start, variants pick a stable random cell', () => {
  const lib = parseSpriteManifest(manifest), flame = getSprite(lib, 'flame-tongue-a'), glow = getSprite(lib, 'soft-glow');
  assert.equal(spriteCell(flame, 'overLife', 24, 0.99, 3, 0.5, false), 15);
  assert.equal(spriteCell(flame, 'first', 24, 0.7, 3, 0.5, false), 0);
  assert.equal(spriteCell(flame, 'fps', 10, 0, 0.35, 0, false), 3);
  assert.equal(spriteCell(flame, 'fps', 10, 0, 1.75, 0, false), 1, 'loops past 16 frames');
  assert.equal(spriteCell(flame, 'fps', 10, 0, 0, 0.5, true), 8, 'random start');
  assert.equal(spriteCell(glow, 'overLife', 24, 0.9, 1, 0.8, false), 3, 'variants ignore life and use the random pick');
});
