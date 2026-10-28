// Package contracts plus static importer guards. These do not compile Niagara or establish render fidelity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBlankDocument, createF01Document } from '../src/graph/fixtures.ts';
import { insertComponent } from '../src/graph/components.ts';
import type { NodeDefinition } from '../src/model/types.ts';
import type { UnrealEffect } from '../src/export/unreal/types.ts';
import { unrealEffectFrom } from '../src/export/unreal/fromPlan.ts';
import { buildUnrealPackage } from '../src/export/unreal/package.ts';

const importer = readFileSync(new URL('../integrations/unreal/VfxStudioImporter/Source/VfxStudioImporter/Private/VfxNiagaraImporter.cpp', import.meta.url), 'utf8');
const section = (start: string, end: string) => {
  const a = importer.indexOf(start), b = importer.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `importer section ${start}`);
  return importer.slice(a, b);
};
const packaged = (d: ReturnType<typeof createBlankDocument>) => {
  const r = unrealEffectFrom(d);
  assert.ok(r.ok);
  const textures = new Map(r.value.textures.map(t => [t, new Uint8Array([1, 2, 3])]));
  const files = buildUnrealPackage(r.value, textures);
  return { files, ir: JSON.parse(files.find(f => f.path === 'effect.json')!.bytes as string) as UnrealEffect };
};

test('Unreal soft sprites: additive material samples texture and particle alpha as opacity; cached instances refresh their parent', () => {
  const { ir, files } = packaged(insertComponent(createBlankDocument(), 'energy-orb', undefined, { group: true }).doc);
  const soft = ir.emitters.filter(e => e.textureFile === 'soft-glow.png' && e.blend === 'additive');
  assert.ok(soft.length > 0);
  assert.ok(files.some(f => f.path === 'Textures/soft-glow.png'));
  const material = section('UMaterial* GetOrCreateBaseMaterial(', 'UMaterialInstanceConstant* GetOrCreateTextureMaterial(');
  assert.match(material, /BLEND_Additive : BLEND_Translucent/);
  assert.match(material, /bUsedWithNiagaraSprites = true/);
  assert.match(material, /ConnectMaterialExpressions\(TexExpr, TEXT\("A"\), AlphaExpr, TEXT\("A"\)\)/);
  assert.match(material, /ConnectMaterialExpressions\(ParticleColorExpr, TEXT\("A"\), AlphaExpr, TEXT\("B"\)\)/);
  assert.match(material, /ConnectMaterialProperty\(AlphaExpr, TEXT\(""\), MP_Opacity\)/);
  assert.match(material, /ConnectMaterialProperty\(MulRgbExpr, TEXT\(""\), MP_EmissiveColor\)/);
  assert.doesNotMatch(material, /FadeExpr/); // Alpha is applied once by the additive blend, not twice.
  const instance = section('UMaterialInstanceConstant* GetOrCreateTextureMaterial(', 'UTexture2D* ImportTexture(');
  assert.match(instance, /SetMaterialInstanceParent\(Existing, Base\)/);
  assert.match(instance, /SetMaterialInstanceTextureParameterValue\(Existing, TEXT\("Texture"\), Texture\)/);
});

for (const component of ['helix-beam', 'arc-beam', 'light-pulse']) {
  test(`Unreal ${component}: packaged beam geometry has positive widths; baked mesh renderer retains its material and interior fade samples`, () => {
    const { ir } = packaged(insertComponent(createBlankDocument(), component, undefined, { group: true }).doc);
    assert.ok(ir.ribbons.length > 0);
    for (const ribbon of ir.ribbons) {
      assert.ok(ribbon.widthCm > 0);
      assert.ok(ribbon.frames.some(f => (f.paths ?? [{ points: f.points }]).some(p => p.points.length >= 2 && p.points.some(q => q[3] > 0))), ribbon.name);
    }
    const mesh = section('UStaticMesh* BuildRibbonMesh(', 'struct FRibbonSlice');
    assert.match(mesh, /GetStaticMaterials\(\)\.Add\(FStaticMaterial\(Mat,/);
    assert.match(mesh, /MinFadePoints = 17/); // Two-point Pulse/core strips need nonzero interior alpha.
    const renderer = section('void BuildRibbonEmitter(', 'TArray<UNiagaraNodeFunctionCall\*> OrderedModules(');
    assert.match(renderer, /NewObject<UNiagaraMeshRendererProperties>/);
    assert.match(renderer, /M\.Mesh = S\.Mesh/);
    assert.match(renderer, /AddRenderer\(MeshR, Inst\.Version\)/);
  });
}

test('Unreal particle trails: ribbon renderer receives material, link order and a positive width curve', () => {
  const { ir } = packaged(insertComponent(createBlankDocument(), 'energy-orb', undefined, { group: true }).doc);
  assert.ok(ir.trails?.length);
  assert.ok(ir.trails.some(t => t.widthCm > 0 && t.widthOverTrail.some(k => k.v > 0)));
  const trail = section('void BuildParticleTrailEmitter(', 'void ApplyEmitterOverrides(');
  assert.match(trail, /NewObject<UNiagaraRibbonRendererProperties>/);
  assert.match(trail, /Ribbon->Material = TrailMat/);
  assert.match(trail, /Ribbon->bLinkOrderUseUniqueID = true/);
  assert.match(trail, /SetTrailWidthCurve\(Data, WidthKeys\)/);
});

const node = (id: string, type: string, params: NodeDefinition['params'] = {}): NodeDefinition =>
  ({ id, type, definitionVersion: 1, label: id, enabled: true, randomStreamId: `rs-${id}`, params });
const edge = (id: string, s: string, sp: string, t: string, tp: string) =>
  ({ id, source: { nodeId: s, port: sp }, target: { nodeId: t, port: tp }, order: 0 });

for (const count of [1, 3]) {
  test(`Unreal attached sprites: ${count} delayed PathFollower path(s) retain separate sprite emitters and tracks`, () => {
    const d = createF01Document(), g = d.graphs[0];
    g.nodes.push(node('rays', 'RadialPath', { count, mode: 'sphere', lengthMin: 2, lengthMax: 5 }),
      node('window', 'Schedule', { startTicks: 10, durationTicks: 40, mode: 'window' }),
      node('follow', 'PathFollower', { durationTicks: 20 }), node('head', 'SpriteRenderer', { size: 0.3 }));
    g.edges.push(edge('r-center', 'node-source', 'out', 'rays', 'center'), edge('r-follow', 'rays', 'paths', 'follow', 'paths'),
      edge('f-window', 'window', 'window', 'follow', 'window'), edge('head-anchor', 'follow', 'anchor', 'head', 'anchor'),
      edge('head-window', 'window', 'window', 'head', 'window'), edge('head-mat', 'node-material', 'material', 'head', 'material'),
      { ...edge('head-out', 'head', 'visual', 'node-output', 'visual'), order: 1 });
    const { ir } = packaged(d);
    const heads = ir.emitters.filter(e => e.name === 'head' || e.name.startsWith('head_path'));
    assert.equal(heads.length, count);
    for (const head of heads) {
      assert.equal(head.attachToSource, true);
      assert.equal(head.suggestedTemplate, 'SimpleSpriteBurst');
      assert.ok(head.sourceTrack && head.sourceTrack.length > 1);
      assert.ok(head.sourceTrack.some(([, p]) => p.some((v, i) => v !== head.sourceTrack![0][1][i])));
      assert.equal(head.bursts[0].tick, 10);
      assert.equal(head.textureFile, 'soft-glow.png');
    }
    const rider = section('void ApplySpriteSourceTrack(', 'bool ParticleTrailWindow(');
    assert.match(rider, /if \(!bAttached\) return/);
    assert.match(rider, /Data->bLocalSpace = true/);
    assert.match(rider, /TEXT\("Inactive Response"\), TEXT\("NewEnumerator0"\)/);
    assert.match(rider, /ParticleUpdateScript/);
    assert.match(rider, /TEXT\("Particles.Position"\)/);
    assert.match(rider, /SetSourceTrackCurve\(Dyn, TEXT\("Input Position"\), \*Track\)/);
    const curve = section('bool SetSourceTrackCurve(', 'bool SetTrailSourceTrack(');
    assert.match(curve, /TEXT\("Engine.System.Age"\)/);
    assert.match(curve, /Pair\[0\]->AsNumber\(\) \/ 60\.0/);
    const sprites = section('// Material: an MIC over', 'System->RequestCompile(true)');
    assert.match(sprites, /Cast<UNiagaraSpriteRendererProperties>/);
    assert.match(sprites, /Sprite->Material = MIC/);
    assert.ok(sprites.indexOf('ApplySpriteSourceTrack(Data, E)') > sprites.indexOf('ApplyForces(Data, E)'));
  });
}
