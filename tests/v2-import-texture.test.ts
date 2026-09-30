import test from 'node:test';
import assert from 'node:assert/strict';
import { assetSpriteSheet, createTextureAsset, readImageHeader, sha256Hex } from '../src/assets/importTexture.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { validateDocument } from '../src/model/document.ts';
import { createRegistry } from '../src/graph/registry.ts';

const png = (w: number, h: number) => { const b = new Uint8Array(64); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };
const jpeg = (w: number, h: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0]);
const webpX = (w: number, h: number, animated = false) => { const b = new Uint8Array(40); b.set([...'RIFF'].map(c => c.charCodeAt(0)), 0); b.set([...'WEBPVP8X'].map(c => c.charCodeAt(0)), 8); b[20] = animated ? 2 : 0; b.set([(w - 1) & 255, ((w - 1) >> 8) & 255, 0, (h - 1) & 255, ((h - 1) >> 8) & 255, 0], 24); return b; };

test('image headers: PNG, JPEG and static WebP sizes; animated WebP and unknown formats rejected', () => {
  assert.deepEqual(readImageHeader(png(512, 256)), { mime: 'image/png', ext: 'png', width: 512, height: 256 });
  assert.deepEqual(readImageHeader(jpeg(640, 480)), { mime: 'image/jpeg', ext: 'jpg', width: 640, height: 480 });
  assert.deepEqual(readImageHeader(webpX(300, 200)), { mime: 'image/webp', ext: 'webp', width: 300, height: 200 });
  assert.match(readImageHeader(webpX(300, 200, true)) as string, /Animated WebP/);
  assert.match(readImageHeader(new TextEncoder().encode('<svg xmlns=')) as string, /Only PNG/);
});

test('texture import: limits, flipbook grid, stable content-derived IDs, and a valid document reference', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const bad = await createTextureAsset(png(5000, 10), { filename: 'big.png', role: 'color' });
  assert.ok(!bad.ok && /4096/.test(bad.message));
  const grid = await createTextureAsset(png(1000, 1000), { filename: 'x.png', role: 'color', flipbook: { rows: 3, columns: 3 } });
  assert.ok(!grid.ok && /divide/.test(grid.message));
  assert.ok(!(await createTextureAsset(jpeg(64, 64), { filename: 'm.jpg', role: 'mask' })).ok, 'JPEG masks rejected');
  const r = await createTextureAsset(png(1024, 1024), { filename: 'fire.png', role: 'color', flipbook: { rows: 4, columns: 4 } });
  if (!r.ok) assert.fail(r.message);
  const a = r.value.asset;
  assert.equal(a.kind, 'flipbook');
  assert.equal(r.value.path, `assets/${a.sha256}.png`);
  const again = await createTextureAsset(png(1024, 1024), { filename: 'renamed.png', role: 'color', flipbook: { rows: 4, columns: 4 } });
  assert.ok(again.ok && again.value.asset.id === a.id, 'same bytes + interpretation → same ID');
  const mask = await createTextureAsset(png(1024, 1024), { filename: 'fire.png', role: 'mask', flipbook: { rows: 4, columns: 4 } });
  assert.ok(mask.ok && mask.value.asset.id !== a.id && mask.value.asset.sha256 === a.sha256, 'role changes the interpretation ID, not the byte hash');
  const doc = { ...createBlankDocument(), assets: [a] };
  const v = validateDocument(doc, { registry: createRegistry() });
  assert.ok(v.ok, JSON.stringify(!v.ok && v.errors));
  assert.deepEqual(assetSpriteSheet(doc, a.id), { id: a.id, file: `asset:${a.sha256}`, kind: 'flipbook', cell: [256, 256], columns: 4, rows: 4, blend: 'normal' });
  assert.match(assetSpriteSheet(doc, 'nope') as string, /not listed/);
});
