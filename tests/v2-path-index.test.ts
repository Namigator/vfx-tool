// Path index control (user 2026-10-07): PathFollower Stagger (departures by path number), Colour by path (each path's
// riders take its colour, fading in), colour over window on PointLight / MotionTrail, MergePaths "join" (one
// continuous path, no hand-off) and smooth MotionTrails.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { EffectDocumentV2, NodeDefinition } from '../src/model/types.ts';
import { compileParticlePreview, type ParticlePreviewPlan } from '../src/graph/toParticles.ts';
import { createF01Document } from '../src/graph/fixtures.ts';
import { gradientAt, pathColors, pathTintAmount, tintedColor } from '../src/graph/pathColor.ts';
import { joinPaths } from '../src/runtime/paths.ts';
import { smoothTrail } from '../src/render/particleTrails.ts';

const node = (id: string, type: string, params: NodeDefinition['params'] = {}): NodeDefinition =>
  ({ id, type, definitionVersion: 1, label: id, enabled: true, randomStreamId: `rs-${id}`, params });
const edge = (id: string, s: string, sp: string, t: string, tp: string, order = 0) =>
  ({ id, source: { nodeId: s, port: sp }, target: { nodeId: t, port: tp }, order });
const root = (d: EffectDocumentV2) => d.graphs[0];
const set = (d: EffectDocumentV2, id: string, params: NodeDefinition['params']) => Object.assign(root(d).nodes.find(n => n.id === id)!.params, params);
const plan = (d: EffectDocumentV2): ParticlePreviewPlan => {
  const r = compileParticlePreview(d);
  if (!r.ok) assert.fail(`compile failed: ${JSON.stringify(r.errors, null, 1)}`);
  return r.value;
};

/** 3 disc rays from Source -> PathFollower (window 10..80, Travel 20) carrying the F01 emitter; arrivals burst emitter 2. */
function raysDoc(follower: NodeDefinition['params'], mutate?: (d: EffectDocumentV2) => void): EffectDocumentV2 {
  const d = createF01Document();
  const g = root(d);
  g.nodes.push(node('node-rad', 'RadialPath', { count: 3, mode: 'disc', lengthMin: 2, lengthMax: 2 }), node('node-fw', 'Schedule', { startTicks: 10, durationTicks: 70, mode: 'window' }),
    node('node-follow', 'PathFollower', { durationTicks: 20, ...follower }));
  g.edges.push(edge('e-rs', 'node-source', 'out', 'node-rad', 'center'), edge('e-fw', 'node-fw', 'window', 'node-follow', 'window'), edge('e-rf', 'node-rad', 'paths', 'node-follow', 'paths'));
  g.edges = g.edges.filter(e => e.id !== 'edge-anchor');
  g.edges.push(edge('e-fa', 'node-follow', 'anchor', 'node-emitter', 'anchor'));
  set(d, 'node-emitter', { burst: 0, rate: 30 });
  set(d, 'node-schedule', { mode: 'window', durationTicks: 90 });
  const trig = g.edges.find(e => e.id === 'edge-trigger')!; trig.source.port = 'window'; trig.target.port = 'window';
  g.nodes.push(node('node-em2', 'Emitter', { burst: 2, rate: 0, useEventPosition: true }), node('node-init2', 'InitialProperties'), node('node-bb2', 'BillboardRenderer'));
  g.edges.push(edge('e-arr', 'node-follow', 'arrival', 'node-em2', 'trigger'), edge('e-e2', 'node-em2', 'particles', 'node-init2', 'particles'), edge('e-i2', 'node-init2', 'particles', 'node-bb2', 'particles'),
    edge('e-m2', 'node-material', 'material', 'node-bb2', 'material'), edge('e-v2', 'node-bb2', 'visual', 'node-output', 'visual', 1));
  d.durationTicks = 120;
  mutate?.(d);
  return d;
}
const arrivalTicks = (p: ParticlePreviewPlan) => p.systems.find(s => s.id === 'node-init2')!.descriptor.bursts.map(b => b.tick).sort((a, b) => a - b);
const tracks = (p: ParticlePreviewPlan) => { const d = p.systems.find(s => s.id === 'node-initial')!.descriptor; return [d.sourceTrack!, ...(d.extraSourceTracks ?? [])]; };
const near = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

test('Stagger: path k leaves k x stagger ticks later and holds at its start meanwhile; arrivals (and triggered bursts) follow', () => {
  const p = plan(raysDoc({ stagger: 6 }));
  assert.deepEqual(arrivalTicks(p), [30, 36, 42]);
  const t = tracks(p);
  // Path 2 waits 12 ticks at the Source, path 0 is already moving.
  assert.ok(near(t[2].positions[5], t[2].positions[0]));
  assert.ok(!near(t[0].positions[5], t[0].positions[0]));
  const f = p.followers.find(x => x.nodeId === 'node-follow')!;
  assert.equal(f.pathCount, 3);
  // Reverse: the last path leaves first.
  const r = plan(raysDoc({ stagger: 6, staggerOrder: 'reverse' }));
  assert.ok(near(tracks(r)[0].positions[5], tracks(r)[0].positions[0]), 'path 0 waits in reverse order');
  assert.deepEqual(arrivalTicks(r), [30, 36, 42]);
});

test('Colour by path: riders get one colour per path (rainbow or gradient) and fade in from each departure', () => {
  const p = plan(raysDoc({ pathColor: 'rainbow', pathColorTicks: 12, stagger: 4 }));
  const layer = p.layers.find(l => l.nodeId === 'node-billboard')!;
  assert.ok(layer.pathTint);
  assert.equal(layer.pathTint!.colors.length, 3);
  assert.equal(new Set(layer.pathTint!.colors.map(c => c.srgb)).size, 3, 'three different colours');
  assert.deepEqual(layer.pathTint!.from, [10, 14, 18]);
  assert.equal(layer.pathTint!.ticks, 12);
  // Arrival bursts are not riders: no tint.
  assert.equal(p.layers.find(l => l.nodeId === 'node-bb2')!.pathTint, undefined);
  const g = plan(raysDoc({ pathColor: 'gradient', pathGradient: { stops: [{ position: 0, color: { srgb: '#FF0000', alpha: 1 } }, { position: 1, color: { srgb: '#0000FF', alpha: 1 } }] } }));
  const gl = g.layers.find(l => l.nodeId === 'node-billboard')!.pathTint!;
  assert.deepEqual([gl.colors[0].srgb, gl.colors[2].srgb], ['#FF0000', '#0000FF']);
  assert.equal(plan(raysDoc({})).layers.find(l => l.nodeId === 'node-billboard')!.pathTint, undefined, 'off by default');
});

test('pathColor helpers: amounts over the fade, blends in linear light, gradient sampling', () => {
  const t = { colors: [{ srgb: '#00FF00', alpha: 1 }], from: [10], ticks: 10 };
  assert.equal(pathTintAmount(t, 0, 5), 0);
  assert.equal(pathTintAmount(t, 0, 15), 0.5);
  assert.equal(pathTintAmount(t, 0, 40), 1);
  assert.equal(pathTintAmount({ ...t, ticks: 0 }, 0, 0), 1, '0 ticks = path colour at once');
  assert.equal(tintedColor({ srgb: '#FF0000', alpha: 0.5 }, t, 0, 30).srgb, '#00FF00');
  assert.equal(tintedColor({ srgb: '#FF0000', alpha: 0.5 }, t, 0, 30).alpha, 0.5);
  assert.equal(gradientAt({ stops: [{ position: 0, color: { srgb: '#000000', alpha: 1 } }, { position: 1, color: { srgb: '#FFFFFF', alpha: 1 } }] }, 0.5).srgb, '#BCBCBC');
  assert.equal(pathColors('off', { stops: [] }, 3), undefined);
  assert.equal(pathColors('rainbow', { stops: [] }, 6)!.length, 6);
});

test('PointLight and MotionTrail colour over window; riding lights carry their path number', () => {
  const ramp = { stops: [{ position: 0, color: { srgb: '#FF4FC8', alpha: 1 } }, { position: 1, color: { srgb: '#30E0FF', alpha: 1 } }] };
  const p = plan(raysDoc({ pathColor: 'rainbow' }, d => {
    const g = root(d);
    g.nodes.push(node('node-light', 'PointLight', { colorOverWindow: ramp }), node('node-mt', 'MotionTrail', { colorOverWindow: structuredClone(ramp) }), node('node-lw', 'Schedule', { startTicks: 10, durationTicks: 40, mode: 'window' }));
    g.edges.push(edge('e-la', 'node-follow', 'anchor', 'node-light', 'anchor'), edge('e-lw', 'node-lw', 'window', 'node-light', 'window'), edge('e-lv', 'node-light', 'visual', 'node-output', 'visual', 2),
      edge('e-ta', 'node-follow', 'anchor', 'node-mt', 'anchor'), edge('e-tm', 'node-material', 'material', 'node-mt', 'material'), edge('e-tw', 'node-lw', 'window', 'node-mt', 'window'), edge('e-tv', 'node-mt', 'visual', 'node-output', 'visual', 3));
  }));
  assert.equal(p.lights.length, 3);
  assert.deepEqual(p.lights.map(l => l.pathTrack), [0, 1, 2]);
  assert.ok(p.lights.every(l => l.colorOverWindow?.stops[1].color.srgb === '#30E0FF' && l.pathTint));
  const trail = p.trails.find(t => t.nodeId === 'node-mt')!;
  assert.deepEqual(trail.window, [10, 50]);
  assert.equal(trail.colorOverWindow!.stops[0].color.srgb, '#FF4FC8');
  assert.equal(trail.pathTint!.colors.length, 3);
  // White (the default) adds nothing.
  const plain = plan(raysDoc({}, d => {
    root(d).nodes.push(node('node-light', 'PointLight', {}), node('node-lw', 'Schedule', { startTicks: 10, durationTicks: 40, mode: 'window' }));
    root(d).edges.push(edge('e-la', 'node-follow', 'anchor', 'node-light', 'anchor'), edge('e-lw', 'node-lw', 'window', 'node-light', 'window'), edge('e-lv', 'node-light', 'visual', 'node-output', 'visual', 2));
  }));
  assert.ok(plain.lights.every(l => l.colorOverWindow === undefined && l.pathTint === undefined));
});

test('MergePaths join: two paths become one continuous path a follower walks without a hand-off', () => {
  const a = { id: 'a', points: [[0, 0, 0], [1, 0, 0]] as [number, number, number][], widthScale: 1, opacityScale: 1 };
  const b = { id: 'b', points: [[1, 0, 0], [1, 1, 0], [1, 2, 0]] as [number, number, number][], widthScale: 2, opacityScale: 1 };
  const j = joinPaths([a, b]);
  assert.equal(j.length, 1);
  assert.deepEqual(j[0].points, [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 2, 0]], 'the shared joint point appears once');
  assert.equal(j[0].widthScale, 1);
  assert.deepEqual(joinPaths([]), []);
  // In a document: LinePath Source->Target joined with a HelixPath Target->floor, walked by one follower.
  const d = createF01Document();
  const g = root(d);
  g.nodes.push(node('node-line', 'LinePath'), node('node-floor', 'OffsetAnchor', { offset: [0, 0, 0], dropToGround: true }), node('node-helix', 'HelixPath', { radius: 0.5, turns: 2, taper: 'both' }),
    node('node-join', 'MergePaths', { mode: 'join' }), node('node-fw', 'Schedule', { startTicks: 0, durationTicks: 60, mode: 'window' }), node('node-follow', 'PathFollower', { durationTicks: 40 }));
  g.edges.push(edge('e1', 'node-source', 'out', 'node-line', 'start'), edge('e2', 'node-target', 'out', 'node-line', 'end'), edge('e3', 'node-target', 'out', 'node-floor', 'anchor'),
    edge('e4', 'node-target', 'out', 'node-helix', 'start'), edge('e5', 'node-floor', 'out', 'node-helix', 'end'),
    edge('e6', 'node-line', 'paths', 'node-join', 'paths', 0), edge('e7', 'node-helix', 'paths', 'node-join', 'paths', 1),
    edge('e8', 'node-join', 'paths', 'node-follow', 'paths'), edge('e9', 'node-fw', 'window', 'node-follow', 'window'));
  g.edges = g.edges.filter(e => e.id !== 'edge-anchor');
  g.edges.push(edge('e10', 'node-follow', 'anchor', 'node-emitter', 'anchor'));
  const p = plan(d);
  const f = p.followers.find(x => x.nodeId === 'node-follow')!;
  assert.equal(f.pathCount, 1, 'one continuous path');
  const t = tracks(p)[0];
  const tgt = d.anchors.find(x => x.id === 'target')!.position;
  // Ends on the floor under the Target.
  assert.ok(Math.abs(t.positions[40][1]) < 1e-6 && Math.abs(t.positions[40][0] - tgt[0]) < 1e-6);
  // Reverse order: starts with the helix (at the Target).
  set(d, 'node-join', { reverse: true });
  const r = tracks(plan(d))[0];
  assert.ok(near(r.positions[0], tgt));
});

test('MotionTrail smoothing: a Catmull-Rom curve through the recorded points', () => {
  const pts: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
  const s = smoothTrail(pts, 4);
  assert.equal(s.length, 13);
  for (let i = 0; i < pts.length; i++) assert.ok(near(s[i * 4], pts[i]), `passes through point ${i}`);
  assert.deepEqual(smoothTrail(pts.slice(0, 2)), pts.slice(0, 2), 'two points stay a line');
});

test('exports: each path emitter takes its settled path colour, reported as approximated', async () => {
  const { robloxEffectFrom } = await import('../src/export/roblox/fromPlan.ts');
  const { unrealEffectFrom } = await import('../src/export/unreal/fromPlan.ts');
  const d = raysDoc({ pathColor: 'rainbow', pathColorTicks: 10 });
  const rbx = robloxEffectFrom(d), ue = unrealEffectFrom(d);
  assert.ok(rbx.ok && ue.ok);
  if (!rbx.ok || !ue.ok) return;
  const rCols = rbx.value.emitters.filter(e => e.name.startsWith('node_billboard') || e.name.startsWith('node-billboard')).map(e => JSON.stringify(e.color));
  assert.equal(rCols.length, 3);
  assert.equal(new Set(rCols).size, 3, 'three colours in Roblox');
  assert.ok(rbx.value.report.some(r => /Colour by path/.test(r.message)));
  assert.ok(ue.value.report.some(r => /Colour by path/.test(r.message)));
});

test('Tidy up: columns follow the data flow, nothing overlaps, unconnected nodes still get a place', async () => {
  const { tidyLayout, TIDY_DEFAULT_SIZE } = await import('../src/model/tidyLayout.ts');
  const nodes = ['a', 'b', 'mat', 'c', 'out', 'lone'].map(id => ({ id }));
  const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'mat', target: 'c' }, { source: 'c', target: 'out' }];
  const p = tidyLayout(nodes, edges);
  assert.ok(p.a.x < p.b.x && p.b.x < p.c.x && p.c.x < p.out.x, 'left to right');
  assert.equal(p.mat.x, p.b.x, 'a source sits next to its consumer');
  assert.ok(p.lone);
  const boxes = Object.values(p);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const A = boxes[i], B = boxes[j];
    assert.ok(Math.abs(A.x - B.x) >= TIDY_DEFAULT_SIZE.width || Math.abs(A.y - B.y) >= TIDY_DEFAULT_SIZE.height, 'no overlap');
  }
});

test('Orbit after arrival: riders circle their path start at the arrival radius and height', () => {
  const p = plan(raysDoc({ orbitSpeed: 2 }));
  const t = tracks(p);
  const c = t[0].positions[0];
  const atArrive = t[0].positions[20], later = t[0].positions[50];
  const r = (q: readonly number[]) => Math.hypot(q[0] - c[0], q[2] - c[2]);
  assert.ok(Math.abs(r(later) - r(atArrive)) < 1e-6, 'same radius');
  assert.ok(Math.abs(later[1] - atArrive[1]) < 1e-9, 'same height');
  assert.ok(!near(later, atArrive), 'it moved round');
  // Arrival timing is unchanged by orbiting.
  assert.deepEqual(arrivalTicks(p), arrivalTicks(plan(raysDoc({}))));
});
