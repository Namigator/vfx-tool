import test from 'node:test';
import assert from 'node:assert/strict';
import type { EffectDocumentV2, NodeDefinition } from '../src/model/types.ts';
import { createF01Document, createL01Document } from '../src/graph/fixtures.ts';
import { compilePathPreview } from '../src/graph/toPaths.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';
import { createL01AudioDocument } from '../src/graph/audioFixtures.ts';
import { compileAudio } from '../src/graph/toAudio.ts';
import { choosePreviewMode, createLightningAudioDemoDocument, createLightningDemoDocument, hasRootAudio, ribbonStyleDiagnostics } from '../src/render/previewMode.ts';
import { RibbonGeometry } from '../src/render/RibbonGeometry.ts';
import { layerRenderOrder, mergeDiagnostics, VISUAL_ORDER_STRIDE } from '../src/render/layerOrder.ts';
import type { Diagnostic } from '../src/model/types.ts';

const find = (d: EffectDocumentV2, id: string) => d.graphs[0].nodes.find(n => n.id === id) as NodeDefinition;

test('F01 stays in point mode and still compiles', () => {
  const d = createF01Document();
  assert.deepEqual(choosePreviewMode(d), { mode: 'points' });
  assert.equal(compileParticlePreview(d).ok, true);
});

test('lightning demo is the shared L01 fixture, not a duplicate construction', () => {
  const d = createLightningDemoDocument();
  assert.deepEqual(d, createL01Document());
  assert.equal(d.id, 'doc-l01');
  assert.notEqual(createLightningDemoDocument(), createLightningDemoDocument(), 'fresh editable copy each call');
});

test('lightning demo chooses mixed mode and renders seven visible ribbon layers from the node graph', () => {
  const d = createLightningDemoDocument();
  assert.deepEqual(choosePreviewMode(d), { mode: 'mixed' });
  const r = compilePathPreview(d, 40);
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  assert.deepEqual(r.value.layers.map(l => l.nodeId), ['node-rib-halo', 'node-rib-outer', 'node-rib-branch-glow', 'node-rib-inner', 'node-rib-fork', 'node-rib-branch-core', 'node-rib-core', 'node-rib-impact-glow', 'node-rib-impact']);
  assert.deepEqual(ribbonStyleDiagnostics(d, r.value.layers), []);
  const g = new RibbonGeometry();
  // The bolt is active at tick 40; the impact glow/core layers have ended.
  for (const l of r.value.layers.filter(l => !l.nodeId.startsWith('node-rib-impact'))) {
    assert.equal(l.active, true);
    const s = g.update(l.paths, { cameraPosition: [4, 3, 2], width: l.width });
    assert.ok(s.indexCount > 0, `${l.nodeId} draws triangles`);
    assert.ok(s.drawnPaths >= 1, `${l.nodeId} draws at least one path`);
  }
  g.dispose();
});

test('browser lightning demo is the shared L01 audio fixture with a compilable root audio mix', () => {
  const d = createLightningAudioDemoDocument();
  assert.deepEqual(d, createL01AudioDocument());
  assert.notEqual(createLightningAudioDemoDocument(), createLightningAudioDemoDocument(), 'fresh editable copy each call');
  assert.equal(hasRootAudio(d), true);
  const a = compileAudio(d);
  if (!a.ok) assert.fail(JSON.stringify(a.errors));
  assert.equal(a.value.mix.sampleRate, 48000);
  assert.equal(a.value.mix.left.length, a.value.mix.right.length);
  assert.ok(a.value.mix.left.length > 0);
  assert.deepEqual(choosePreviewMode(d), { mode: 'mixed' });
  assert.equal(compilePathPreview(d, 0).ok, false, 'visual compile alone must not accept root audio');
  const v = compilePathPreview(d, 0, { audioHandled: true });
  if (!v.ok) assert.fail(JSON.stringify(v.errors));
  assert.deepEqual(ribbonStyleDiagnostics(d, v.value.layers), []);
});

test('hasRootAudio only reports edges into the root EffectOutput audio port', () => {
  assert.equal(hasRootAudio(createF01Document()), false);
  assert.equal(hasRootAudio(createLightningDemoDocument()), false);
  const d = createLightningAudioDemoDocument();
  const root = d.graphs.find(g => g.id === d.rootGraphId)!;
  root.edges = root.edges.filter(e => e.target.port !== 'audio' || !root.nodes.some(n => n.id === e.target.nodeId && n.type === 'EffectOutput'));
  assert.equal(hasRootAudio(d), false);
});

test('path compile is deterministic per tick, so scrubbing needs no replay', () => {
  const d = createLightningDemoDocument();
  const a = compilePathPreview(d, 37), b = compilePathPreview(d, 37);
  assert.deepEqual(a, b);
});

const mixedDocument = (): EffectDocumentV2 => {
  const d = createLightningDemoDocument();
  const f01 = createF01Document().graphs[0];
  const g = d.graphs[0];
  for (const id of ['node-schedule', 'node-emitter', 'node-initial', 'node-material', 'node-billboard']) g.nodes.push(structuredClone(f01.nodes.find(n => n.id === id)!));
  for (const e of f01.edges) g.edges.push({ ...structuredClone(e), id: `f01-${e.id}`, order: e.target.port === 'visual' ? 3 : e.order });
  return d;
};

test('mixed billboard + ribbon documents choose mixed mode and compile both layer kinds', () => {
  const d = mixedDocument();
  assert.deepEqual(choosePreviewMode(d), { mode: 'mixed' });
  assert.equal(compileParticlePreview(d).ok, false, 'ribbon sinks are still errors unless ribbonsHandled');
  const p = compileParticlePreview(d, { ribbonsHandled: true });
  if (!p.ok) assert.fail(JSON.stringify(p.errors));
  const r = compilePathPreview(d, 40);
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  assert.deepEqual(p.value.layers.map(l => l.nodeId), ['node-billboard', 'node-bb-charge-halo', 'node-bb-charge-core']);
  // visualOrder is shared: every root visual sink has a distinct slot across both compilers.
  const orders = [...p.value.layers, ...r.value.layers].map(l => l.visualOrder);
  assert.equal(new Set(orders).size, orders.length);
  assert.deepEqual(r.value.layers.map(l => l.visualOrder), [...r.value.layers.map(l => l.visualOrder)].sort((a, b) => a - b));

  for (const n of d.graphs[0].nodes) if (n.type === 'BillboardRenderer') n.enabled = false;
  assert.deepEqual(choosePreviewMode(d), { mode: 'paths' });

  for (const n of d.graphs[0].nodes) if (n.type === 'BillboardRenderer') n.enabled = true;
  for (const n of d.graphs[0].nodes) if (n.type === 'RibbonRenderer') n.enabled = false;
  assert.deepEqual(choosePreviewMode(d), { mode: 'points' });
  assert.equal(compileParticlePreview(d).ok, true);
});

test('layerRenderOrder: offset dominates, visual connection order breaks ties', () => {
  assert.equal(layerRenderOrder(0, 0), 0);
  assert.ok(layerRenderOrder(0, 1) > layerRenderOrder(0, 0));
  assert.ok(layerRenderOrder(1, 0) > layerRenderOrder(0, VISUAL_ORDER_STRIDE - 1));
  assert.ok(layerRenderOrder(-1, 5) < layerRenderOrder(0, 0));
  assert.throws(() => layerRenderOrder(0, -1), RangeError);
  assert.throws(() => layerRenderOrder(0, 1.5), RangeError);
  assert.throws(() => layerRenderOrder(0, VISUAL_ORDER_STRIDE), RangeError);
  assert.throws(() => layerRenderOrder(Number.NaN, 0), RangeError);
});

test('mergeDiagnostics keeps order and drops exact duplicates only', () => {
  const a: Diagnostic = { code: 'INVALID_VALUE', severity: 'error', nodeId: 'n1', message: 'x' };
  const b: Diagnostic = { code: 'INVALID_VALUE', severity: 'warning', nodeId: 'n1', message: 'x' };
  const c: Diagnostic = { code: 'MISSING_REFERENCE', severity: 'error', message: 'y' };
  assert.deepEqual(mergeDiagnostics([a, b], [{ ...a }, c], []), [a, b, c]);
  assert.deepEqual(mergeDiagnostics(), []);
});

test('unsupported ribbon style values are surfaced, never ignored', () => {
  const d = createLightningDemoDocument();
  const rib = find(d, 'node-rib-core');
  rib.params.widthOverPath = { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 1 }, { x: 1, y: 0 }] };
  rib.params.orientation = 'parallelTransport';
  rib.params.uvMode = 'tile';
  const r = compilePathPreview(d, 0);
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  const diags = ribbonStyleDiagnostics(d, r.value.layers);
  const idx = d.graphs[0].nodes.indexOf(rib);
  assert.deepEqual(diags.map(x => [x.severity, x.nodeId, x.fieldPath]), [
    ['error', 'node-rib-core', `graphs[0].nodes[${idx}].params.widthOverPath`],
    ['error', 'node-rib-core', `graphs[0].nodes[${idx}].params.orientation`],
    ['warning', 'node-rib-core', `graphs[0].nodes[${idx}].params.uvMode`],
  ]);
});

test('inactive window layers carry no paths and draw nothing', () => {
  const d = createLightningDemoDocument();
  const r = compilePathPreview(d, d.durationTicks);
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  const g = new RibbonGeometry();
  for (const l of r.value.layers) {
    assert.equal(l.active, false);
    assert.equal(g.update(l.active ? l.paths : [], { cameraPosition: [0, 0, 5], width: l.width }).indexCount, 0);
  }
  g.dispose();
});
