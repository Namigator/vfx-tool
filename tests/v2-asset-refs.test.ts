import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextureAsset, sha256Hex } from '../src/assets/importTexture.ts';
import { assetReferences, relinkVerdict, removeAssetPatches, replaceAssetPatches } from '../src/model/assetRefs.ts';
import { createF01Document } from '../src/graph/fixtures.ts';
import { DocumentHistory } from '../src/editor/history.ts';
import { validateDocument } from '../src/model/document.ts';
import { createRegistry } from '../src/graph/registry.ts';

const png = (w: number, h: number, fill: number) => { const b = new Uint8Array(96).fill(fill); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };

async function texturedDoc() {
  const r = await createTextureAsset(png(256, 256, 7), { filename: 'a.png', role: 'color', flipbook: { rows: 2, columns: 2 } });
  if (!r.ok) assert.fail(r.message);
  const doc = createF01Document();
  doc.assets.push(r.value.asset);
  const mat = doc.graphs[0].nodes.find(n => n.type === 'Material')!;
  Object.assign(mat.params, { template: 'SpriteTextured', textureAsset: r.value.asset.id });
  return { doc, asset: r.value.asset, mat };
}

test('T19 assets: references are listed; removal is blocked while used, allowed once unused', async () => {
  const { doc, asset, mat } = await texturedDoc();
  const uses = assetReferences(doc, asset.id);
  assert.deepEqual(uses.map(u => [u.nodeId, u.parameter]), [[mat.id, 'textureAsset']]);
  const blocked = removeAssetPatches(doc, asset.id);
  assert.ok(!blocked.ok && blocked.message.includes('textureAsset'));
  const h = new DocumentHistory(doc);
  h.begin('t', 'unuse'); h.apply([{ op: 'set', path: uses[0].path, value: '' }]); h.commit();
  const free = removeAssetPatches(h.snapshot(), asset.id);
  assert.ok(free.ok);
  h.begin('t2', 'remove'); h.apply(free.patches); h.commit();
  assert.equal(h.snapshot().assets.length, 0);
});

test('T19 relink: same bytes restore the asset; different bytes need an explicit Replace, which re-points every use (same grid)', async () => {
  const { doc, asset, mat } = await texturedDoc();
  assert.equal(relinkVerdict(asset, await sha256Hex(png(256, 256, 7))), 'same');
  assert.equal(relinkVerdict(asset, await sha256Hex(png(256, 256, 9))), 'different');
  const other = await createTextureAsset(png(256, 256, 9), { filename: 'b.png', role: 'color', flipbook: { rows: 2, columns: 2 } });
  if (!other.ok) assert.fail(other.message);
  assert.notEqual(other.value.asset.id, asset.id, 'duplicate interpretation of different bytes gets its own id');
  const h = new DocumentHistory(doc);
  h.begin('r', 'replace'); h.apply(replaceAssetPatches(doc, asset.id, other.value.asset)); h.commit();
  const after = h.snapshot();
  assert.equal(after.graphs[0].nodes.find(n => n.id === mat.id)!.params.textureAsset, other.value.asset.id);
  assert.deepEqual(after.assets.map(a => a.id), [other.value.asset.id]);
  assert.ok(validateDocument(after, { registry: createRegistry() }).ok);
  h.undo();
  assert.equal(h.snapshot().graphs[0].nodes.find(n => n.id === mat.id)!.params.textureAsset, asset.id, 'undo restores the old asset');
});
