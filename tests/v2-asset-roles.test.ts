import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextureAsset } from '../src/assets/importTexture.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { validateDocument } from '../src/model/document.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';
import { assetComponent } from '../src/graph/assetComponent.ts';
import { insertComponent } from '../src/graph/components.ts';
import { dataTextureFile } from '../src/graph/materialSprite.ts';
import { BUILTIN_MESHES } from '../src/render/builtinMeshes.ts';
import type { AssetReference, EffectDocumentV2 } from '../src/model/types.ts';

const png = (w: number, h: number, fill: number) => { const b = new Uint8Array(96).fill(fill); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };
const asset = async (role: 'color' | 'mask' | 'normal' | 'noise', fill: number): Promise<AssetReference> => {
  const r = await createTextureAsset(png(256, 256, fill), { filename: `${role}.png`, role });
  if (!r.ok) assert.fail(r.message);
  return r.value.asset;
};
const add = (doc: EffectDocumentV2, a: AssetReference) => {
  const t = assetComponent(a);
  if (typeof t === 'string') assert.fail(t);
  return insertComponent({ ...doc, assets: [...doc.assets, a] }, t, undefined, { group: true }).doc;
};
const compiled = (doc: EffectDocumentV2) => {
  const r = compileParticlePreview(doc);
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  return r.value;
};

test('10 texture roles: normal and noise import as data interpretations and resolve only for their own role', async () => {
  const normal = await asset('normal', 1), noise = await asset('noise', 2), color = await asset('color', 3);
  assert.equal(normal.colorSpace, 'normal');
  assert.equal(noise.interpretation.colorSpace, 'noise');
  const doc = { assets: [normal, noise, color] };
  assert.deepEqual(dataTextureFile(doc, normal.id, 'normal'), { file: `asset:${normal.sha256}` });
  assert.equal(dataTextureFile(doc, '', 'noise'), null);
  assert.match((dataTextureFile(doc, color.id, 'normal') as { error: string }).error, /imported as color/);
  assert.match((dataTextureFile(doc, noise.id, 'normal') as { error: string }).error, /role normal/);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 64, 0, 64, 3, 0, 0, 0, 0]);
  assert.ok(!(await createTextureAsset(jpeg, { filename: 'n.jpg', role: 'normal' })).ok, 'JPEG normal maps rejected');
});

test('10 Add to effect: each asset kind/role inserts a compiling component that uses the asset', async () => {
  const blank = createBlankDocument();
  const registry = createRegistry();
  for (const role of ['color', 'mask', 'normal', 'noise'] as const) {
    const a = await asset(role, 10 + role.length);
    const doc = add(blank, a);
    const v = validateDocument(doc, { registry });
    assert.ok(v.ok, `${role}: ${JSON.stringify(!v.ok && v.errors)}`);
    const plan = compiled(doc);
    if (role === 'normal') assert.equal(plan.meshes?.[0]?.normalMap, `asset:${a.sha256}`, 'normal map reaches the mesh layer');
    else if (role === 'noise') assert.equal(plan.layers[0].noiseTexture, `asset:${a.sha256}`, 'noise replaces the dissolve pattern');
    else assert.equal(plan.layers[0].sprite?.sheet.file, `asset:${a.sha256}`, `${role} texture is drawn`);
    if (role === 'mask') assert.equal(plan.layers[0].blend, 'additive');
    assert.ok(doc.controls.length >= 3, 'the component publishes knobs');
  }
});

test('10 a wrong-role asset on normalAsset is a named reference error, not a silent fallback', async () => {
  const color = await asset('color', 40);
  const t = assetComponent(await asset('normal', 41));
  if (typeof t === 'string') assert.fail(t);
  const doc = insertComponent({ ...createBlankDocument(), assets: [color] }, t, undefined, { group: true }).doc;
  for (const g of doc.graphs) for (const n of g.nodes) if (n.type === 'Material') n.params.normalAsset = color.id;
  const r = compileParticlePreview(doc);
  assert.ok(!r.ok && r.errors.some(e => /normalAsset/.test(e.fieldPath ?? '') && /imported as color/.test(e.message)), JSON.stringify(!r.ok && r.errors));
});

test('10 included geometry has a plane', () => {
  assert.ok((BUILTIN_MESHES as readonly string[]).includes('plane'));
  const spec = [...createRegistry().values()].find(s => s.type === 'MeshRenderer')!;
  assert.ok((spec.parameters.find(p => p.id === 'mesh')!.choices as string[]).includes('plane'));
});
