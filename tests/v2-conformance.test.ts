// 22-CONFORMANCE-FIXTURES F05–F08, F10, F11 (F01–F04 and F09 live in v2-particles / v2-to-particles / v2-controls).
// Expected values come from the plan text, not from running the implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { EffectDocumentV2, NodeDefinition } from '../src/model/types.ts';
import { createF01Document, createBlankDocument } from '../src/graph/fixtures.ts';
import { compileParticlePreview, type ParticlePreviewPlan } from '../src/graph/toParticles.ts';
import { sampleParticlesAtTick } from '../src/runtime/particles.ts';
import { groupSelection } from '../src/graph/groupSelection.ts';
import { duplicateSelection } from '../src/editor/graphOps.ts';
import { insertComponent } from '../src/graph/components.ts';
import { spriteCell } from '../src/assets/spriteLibrary.ts';
import { compileLifeGradient, sampleLifeGradient } from '../src/render/billboardLife.ts';
import { jaggedPath, linePath, pathLength, revealPath } from '../src/runtime/paths.ts';
import { SAMPLES_PER_TICK } from '../src/audio/synthesis.ts';
import { encodeWavPcm16Stereo } from '../src/audio/wav.ts';
import { validateDocument } from '../src/model/document.ts';
import { createRegistry } from '../src/graph/registry.ts';

const registry = createRegistry();
const node = (id: string, type: string, params: NodeDefinition['params'] = {}): NodeDefinition =>
  ({ id, type, definitionVersion: 1, label: id, enabled: true, randomStreamId: `rs-${id}`, params });
const edge = (id: string, s: string, sp: string, t: string, tp: string, order = 0) => ({ id, source: { nodeId: s, port: sp }, target: { nodeId: t, port: tp }, order });
const plan = (d: EffectDocumentV2): ParticlePreviewPlan => { const r = compileParticlePreview(d, { audioHandled: true }); // Sound is parked; visuals only.
 if (!r.ok) assert.fail(JSON.stringify(r.errors)); return r.value; };
const sample = (p: ParticlePreviewPlan, tick: number, emitterId?: string) => {
  const s = emitterId ? p.systems.find(x => x.descriptor.emitterId === emitterId)! : p.systems[0];
  const r = sampleParticlesAtTick(s.descriptor, tick);
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  return r.value.particles;
};

/** F05: a seeded cone burst with an explicit stream "sparks-a". */
function sparks(): EffectDocumentV2 {
  const d = createF01Document();
  const em = d.graphs[0].nodes.find(n => n.id === 'node-emitter')!;
  Object.assign(em.params, { burst: 24, shape: 'cone', direction: [0, 1, 0], coneAngle: 0.6, speedMin: 1, speedMax: 3 });
  em.randomStreamId = 'sparks-a';
  return d;
}
const fingerprint = (p: ParticlePreviewPlan) => sample(p, 20).map(q => ({ position: q.position.map(v => v.toFixed(9)), size: q.size }));

test('F05 graph identity: rename, move, unrelated disabled nodes and grouping keep the sampled particles', () => {
  const base = fingerprint(plan(sparks()));
  assert.equal(base.length, 24);
  const renamed = sparks();
  for (const n of renamed.graphs[0].nodes) n.label = `${n.label} (renamed)`;
  for (const p of Object.values(renamed.editor.graphs['graph-root'].nodes)) { p.x += 500; p.y -= 300; }
  renamed.graphs[0].nodes.push({ ...node('smoke-unrelated', 'Emitter', { burst: 99 }), enabled: false });
  assert.deepEqual(fingerprint(plan(renamed)), base, 'labels, layout and a disabled unrelated node change nothing');
  const g = groupSelection(sparks(), 'graph-root', ['node-emitter', 'node-initial']);
  if (!g.ok) assert.fail(g.message);
  assert.deepEqual(fingerprint(plan(g.doc)), base, 'wrapping the selection in a Group keeps the sampled positions');
});

test('F05 duplicate: normal copy → different stream; Preserve pattern → same samples, distinct object IDs', () => {
  const d = sparks();
  const normal = duplicateSelection(d, 'graph-root', ['node-emitter']);
  const kept = duplicateSelection(d, 'graph-root', ['node-emitter'], { preservePattern: true });
  if (!normal.ok || !kept.ok) assert.fail('duplicate failed');
  const copyOf = (doc: EffectDocumentV2, id: string) => doc.graphs[0].nodes.find(n => n.id === id)!;
  assert.notEqual(copyOf(normal.doc, normal.newIds[0]).randomStreamId, 'sparks-a');
  assert.equal(copyOf(kept.doc, kept.newIds[0]).randomStreamId, 'sparks-a');
  assert.notEqual(kept.newIds[0], 'node-emitter');
  // Wire each copy like the original so it simulates; compare its tick-20 sample with the original's.
  const wire = (doc: EffectDocumentV2, id: string) => {
    doc.graphs[0].edges.push(edge(`e-t-${id}`, 'node-schedule', 'start', id, 'trigger'), edge(`e-a-${id}`, 'node-source', 'out', id, 'anchor'),
      edge(`e-b-${id}`, id, 'particles', `bb-${id}`, 'particles'), edge(`e-m-${id}`, 'node-material', 'material', `bb-${id}`, 'material'), edge(`e-v-${id}`, `bb-${id}`, 'visual', 'node-output', 'visual', 1));
    doc.graphs[0].nodes.push(node(`bb-${id}`, 'BillboardRenderer'));
    return plan(doc);
  };
  const orig = sample(plan(d), 20).map(q => q.position);
  const pk = wire(kept.doc, kept.newIds[0]), pn = wire(normal.doc, normal.newIds[0]);
  const keptSample = sample(pk, 20, kept.newIds[0]), normalSample = sample(pn, 20, normal.newIds[0]);
  assert.deepEqual(keptSample.map(q => q.position), orig, 'Preserve pattern samples the same quantities');
  assert.notDeepEqual(normalSample.map(q => q.position), orig, 'a normal duplicate gets its own pattern');
  const origIds = new Set(sample(plan(d), 20).map(q => q.id));
  assert.ok(keptSample.every(q => !origIds.has(q.id)), 'object IDs stay distinct');
});

test('F06 group equivalence and independent library instances', () => {
  const flat = plan(sparks());
  const g = groupSelection(sparks(), 'graph-root', ['node-emitter', 'node-initial', 'node-billboard', 'node-material']);
  if (!g.ok) assert.fail(g.message);
  assert.deepEqual(fingerprint(plan(g.doc)), fingerprint(flat), 'collapsed group = inline graph');
  // Two inserted instances: changing one gravity leaves the other's plan untouched.
  const two = insertComponent(insertComponent(createBlankDocument(), 'spark-burst', 'a', { group: true }).doc, 'spark-burst', 'b', { group: true }).doc;
  const before = plan(two);
  const gravB = two.graphs.find(x => x.id === 'graph-b')!.nodes.find(n => n.type === 'Gravity')!;
  gravB.params.acceleration = [0, -2, 0];
  const after = plan(two);
  const ops = (p: ParticlePreviewPlan, prefix: string) => p.systems.filter(s => s.id.includes(`${prefix}-`)).map(s => JSON.stringify(s.descriptor.operators));
  assert.deepEqual(ops(after, 'a'), ops(before, 'a'), 'instance a unchanged');
  assert.notDeepEqual(ops(after, 'b'), ops(before, 'b'), 'instance b changed');
});

/** F07: the F01 particle dies at tick 12; its death triggers a burst of 2, speed 0, lifetime 10 ticks. */
function sameTick(swapLayout = false): EffectDocumentV2 {
  const d = createF01Document(), g = d.graphs[0];
  Object.assign(g.nodes.find(n => n.id === 'node-emitter')!.params, { lifetimeMin: 12 / 60, lifetimeMax: 12 / 60 });
  g.nodes.push(node('node-events', 'ParticleEvents', { probability: 1, maxEvents: 256 }),
    node('node-child', 'Emitter', { burst: 2, rate: 0, shape: 'point', speedMin: 0, speedMax: 0, lifetimeMin: 10 / 60, lifetimeMax: 10 / 60, useEventPosition: true }),
    node('node-child-bb', 'BillboardRenderer'));
  g.edges.push(edge('e-ev', 'node-initial', 'particles', 'node-events', 'particles'), edge('e-death', 'node-events', 'death', 'node-child', 'trigger'),
    edge('e-cb', 'node-child', 'particles', 'node-child-bb', 'particles'), edge('e-cm', 'node-material', 'material', 'node-child-bb', 'material'),
    edge('e-cv', 'node-child-bb', 'visual', 'node-output', 'visual', 1));
  if (swapLayout) { const l = d.editor.graphs['graph-root'].nodes; l['node-child'] = { x: -900, y: -900 }; l['node-events'] = { x: 2000, y: 2000 }; }
  return d;
}

test('F07 same-tick event: children are born at the death tick at the death position, once', () => {
  const p = plan(sameTick());
  assert.equal(sample(p, 11, 'node-emitter').length, 1);
  assert.equal(sample(p, 12, 'node-emitter').length, 0, 'parent removed at age >= lifetime');
  const at12 = sample(p, 12, 'node-child'), at13 = sample(p, 13, 'node-child');
  assert.equal(at12.length, 2);
  assert.ok(at12.every(q => q.ageTicks === 0 && q.position.every((v, i) => Math.abs(v - [0, 1, 0][i]) < 1e-9)), 'age 0 at p');
  assert.ok(at13.every(q => q.ageTicks === 1));
  assert.equal(sample(p, 22, 'node-child').length, 0);
  assert.equal(sample(p, 11, 'node-child').length, 0);
  // Seeking back and forth re-samples the same state (no second dispatch); UI positions do not change the order.
  assert.deepEqual(sample(p, 13, 'node-child'), at13);
  assert.deepEqual(plan(sameTick(true)).systems.map(s => s.descriptor), p.systems.map(s => s.descriptor));
});

test('F08 paths: pinned jagged endpoints, reveal .5 = half arc length', () => {
  const line = linePath('p', [-1, 0, 0], [1, 0, 0], 32);
  for (let s = 0; s < 3; s += 0.37) {
    const j = jaggedPath(line, { documentSeed: 42, randomStreamId: 'rs-j', pathOrdinal: 0, amplitude: 0.3, samples: 32, regenerationHz: 12, effectLocalSeconds: s, pinned: true });
    assert.deepEqual(j.points[0], [-1, 0, 0]);
    assert.deepEqual(j.points.at(-1), [1, 0, 0]);
  }
  const half = revealPath(line, 0.5);
  assert.ok(Math.abs(pathLength(half.points) - pathLength(line.points) / 2) < 1e-9);
});

test('F08 materials: 4×4 flipbook frames at ages 0/.5/1-ε are 0/8/15; gradients interpolate in linear RGB', () => {
  const sheet = { id: 'x', file: 'x.png', kind: 'flipbook' as const, cell: [256, 256] as [number, number], columns: 4, rows: 4, blend: 'normal' as const };
  assert.deepEqual([0, 0.5, 1 - 1e-9].map(t => spriteCell(sheet, 'overLife', 24, t, 0, 0, false)), [0, 8, 15]);
  const g = compileLifeGradient({ stops: [{ position: 0, color: { srgb: '#000000', alpha: 1 } }, { position: 1, color: { srgb: '#FFFFFF', alpha: 1 } }] });
  const out = [0, 0, 0, 0];
  sampleLifeGradient(g, 0.5, out);
  assert.equal(out[0], 0.5, 'midpoint of black→white is linear 0.5 (sRGB ≈ 0.735), not the raw hex midpoint');
});

test('F10 audio mapping: tick 24 → sample 19200; 144 ticks → 115200 frames; PCM16 stereo WAV = 44 + 115200·4 bytes', () => {
  assert.equal(24 * SAMPLES_PER_TICK, 19200);
  assert.equal(144 * SAMPLES_PER_TICK, 115200);
  const n = 144 * SAMPLES_PER_TICK;
  assert.equal(encodeWavPcm16Stereo(new Float32Array(n), new Float32Array(n)).length, 44 + 115200 * 4);
});

test('F11 rejection: cycle, missing asset and unknown node version give distinct node-addressed errors', () => {
  const cyc = createF01Document();
  cyc.graphs[0].nodes.push(node('node-loop-a', 'InitialProperties'), node('node-loop-b', 'InitialProperties'));
  cyc.graphs[0].edges.push(edge('l1', 'node-loop-a', 'particles', 'node-loop-b', 'particles'), edge('l2', 'node-loop-b', 'particles', 'node-loop-a', 'particles'));
  const rc = compileParticlePreview(cyc);
  assert.ok(!rc.ok && rc.errors.some(e => e.code === 'GRAPH_CYCLE' && e.nodeId === 'node-loop-a'), JSON.stringify(!rc.ok && rc.errors));

  const missing = createF01Document();
  Object.assign(missing.graphs[0].nodes.find(n => n.id === 'node-material')!.params, { template: 'SpriteTextured', textureAsset: 'not-here' });
  const rm = compileParticlePreview(missing);
  assert.ok(!rm.ok && rm.errors.some(e => e.code === 'MISSING_REFERENCE' && e.nodeId === 'node-material'), JSON.stringify(!rm.ok && rm.errors));

  const version = createF01Document();
  version.graphs[0].nodes.find(n => n.id === 'node-material')!.definitionVersion = 99;
  const rv = validateDocument(version, { registry });
  assert.ok(!rv.ok, 'unknown node version is rejected');
  const vErr = !rv.ok ? rv.errors.find(e => /99|version/i.test(e.message)) : undefined;
  assert.ok(vErr, JSON.stringify(!rv.ok && rv.errors));
  const codes = new Set([rc, rm].flatMap(r => (r.ok ? [] : r.errors.map(e => e.code))));
  assert.ok(codes.has('GRAPH_CYCLE') && codes.has('MISSING_REFERENCE'), 'distinct codes');
});
