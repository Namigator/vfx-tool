// PathFollower follows EVERY path of its set (5 rays = 5 moving sources, 5 arrivals); PathSplitter chooses which paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { EffectDocumentV2, NodeDefinition } from '../src/model/types.ts';
import { compileParticlePreview, type ParticlePreviewPlan } from '../src/graph/toParticles.ts';
import { compilePathPreview } from '../src/graph/toPaths.ts';
import { createF01Document } from '../src/graph/fixtures.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { ParticleSimulation, sampleParticlesAtTick, validateParticleDescriptor, type ParticleEmitterDescriptor } from '../src/runtime/particles.ts';
import { radialPaths } from '../src/runtime/radial.ts';
import { pathLength, splitPaths, type SplitOptions } from '../src/runtime/pathSplit.ts';
import type { PathData } from '../src/runtime/paths.ts';
import { robloxEffectFrom } from '../src/export/roblox/fromPlan.ts';
import { unrealEffectFrom } from '../src/export/unreal/fromPlan.ts';
import { eventTick, type TimingContext } from '../src/graph/eventTiming.ts';

const node = (id: string, type: string, params: NodeDefinition['params'] = {}, enabled = true): NodeDefinition =>
  ({ id, type, definitionVersion: 1, label: id, enabled, randomStreamId: `rs-${id}`, params });
const edge = (id: string, s: string, sp: string, t: string, tp: string, order = 0) =>
  ({ id, source: { nodeId: s, port: sp }, target: { nodeId: t, port: tp }, order });
const root = (d: EffectDocumentV2) => d.graphs[0];
const set = (d: EffectDocumentV2, id: string, params: NodeDefinition['params']) => Object.assign(root(d).nodes.find(n => n.id === id)!.params, params);
const compile = (d: EffectDocumentV2) => compileParticlePreview(d);
const plan = (d: EffectDocumentV2): ParticlePreviewPlan => {
  const r = compile(d);
  if (!r.ok) assert.fail(`compile failed: ${JSON.stringify(r.errors, null, 1)}`);
  return r.value;
};
const sys = (p: ParticlePreviewPlan, id: string) => p.systems.find(s => s.id === id)!.descriptor;

/**
 * RadialPath (`rays` rays from Source) [-> PathSplitter] -> PathFollower (window 10..50, Travel 20) with
 * emitter 1 (rate 60) riding the follower and emitter 2 (burst 4, event position) fired by each arrival.
 */
function raysDoc(rays: number, opts: { split?: Record<string, string | number>; follower?: Record<string, number>; mutate?: (d: EffectDocumentV2) => void } = {}): EffectDocumentV2 {
  const d = createF01Document();
  const g = root(d);
  g.nodes.push(node('node-rad', 'RadialPath', { count: rays, mode: 'sphere', lengthMin: 2, lengthMax: 5 }), node('node-fw', 'Schedule', { startTicks: 10, durationTicks: 40, mode: 'window' }), node('node-follow', 'PathFollower', { durationTicks: 20, ...opts.follower }));
  g.edges.push(edge('e-rs', 'node-source', 'out', 'node-rad', 'center'), edge('e-fw', 'node-fw', 'window', 'node-follow', 'window'));
  if (opts.split) {
    g.nodes.push(node('node-split', 'PathSplitter', opts.split));
    g.edges.push(edge('e-rsp', 'node-rad', 'paths', 'node-split', 'paths'), edge('e-sf', 'node-split', 'paths', 'node-follow', 'paths'));
  } else g.edges.push(edge('e-rf', 'node-rad', 'paths', 'node-follow', 'paths'));
  // Emitter 1: continuous, riding the follower.
  g.edges = g.edges.filter(e => e.id !== 'edge-anchor');
  g.edges.push(edge('e-fa', 'node-follow', 'anchor', 'node-emitter', 'anchor'));
  set(d, 'node-emitter', { burst: 0, rate: 60 });
  set(d, 'node-schedule', { mode: 'window', durationTicks: 60 });
  const trig = g.edges.find(e => e.id === 'edge-trigger')!; trig.source.port = 'window'; trig.target.port = 'window';
  // Emitter 2: an impact burst where each path ends.
  g.nodes.push(node('node-em2', 'Emitter', { burst: 4, rate: 0, useEventPosition: true }), node('node-init2', 'InitialProperties'), node('node-bb2', 'BillboardRenderer'));
  g.edges.push(edge('e-arr', 'node-follow', 'arrival', 'node-em2', 'trigger'), edge('e-e2', 'node-em2', 'particles', 'node-init2', 'particles'), edge('e-i2', 'node-init2', 'particles', 'node-bb2', 'particles'),
    edge('e-m2', 'node-material', 'material', 'node-bb2', 'material'), edge('e-v2', 'node-bb2', 'visual', 'node-output', 'visual', 1));
  opts.mutate?.(d);
  return d;
}

const tracksOf = (d: ParticleEmitterDescriptor) => [d.sourceTrack!, ...(d.extraSourceTracks ?? [])];

test('5 rays: the follower-anchored emitter becomes 5 moving sources, each emitting the full rate', () => {
  const p = plan(raysDoc(5));
  const d = sys(p, 'node-initial');
  const tr = tracksOf(d);
  assert.equal(tr.length, 5);
  assert.ok(tr.every(t => t.startTick === 10 && t.positions.length === 40));
  // Every track starts at the Source anchor and ends at its own ray end (all different).
  assert.ok(tr.every(t => t.positions[0].every((v, i) => Math.abs(v - [0, 1, 0][i]) < 1e-9)));
  const ends = new Set(tr.map(t => t.positions[t.positions.length - 1].map(v => v.toFixed(6)).join()));
  assert.equal(ends.size, 5);
  // Five times the particles of one source, births exactly on each track's position.
  const at = 30;
  const snap = sampleParticlesAtTick(d, at);
  assert.ok(snap.ok);
  const single = sampleParticlesAtTick({ ...d, extraSourceTracks: undefined }, at);
  assert.ok(single.ok);
  assert.equal(snap.value.particles.length, 5 * single.value.particles.length);
  const born = snap.value.births.map(id => snap.value.particles.find(q => q.id === id)!);
  assert.equal(born.length % 5, 0);
  assert.ok(born.length >= 5);
  const want = new Set(tr.map(t => t.positions[at - t.startTick].map(v => v.toFixed(6)).join()));
  assert.deepEqual(new Set(born.map(q => q.position.map(v => v.toFixed(6)).join())), want);
  // Deterministic.
  assert.deepEqual(sampleParticlesAtTick(d, 45), sampleParticlesAtTick(d, 45));
  // The descriptor validates (and stays valid after a JSON round trip).
  assert.ok(validateParticleDescriptor(JSON.parse(JSON.stringify(d))).ok);
});

test('5 rays: 5 arrival bursts, one at each ray end', () => {
  const p = plan(raysDoc(5));
  const d = sys(p, 'node-init2');
  assert.equal(d.bursts.length, 5);
  assert.ok(d.bursts.every(b => b.tick === 30 && b.count === 4));
  const ends = tracksOf(sys(p, 'node-initial')).map(t => t.positions[t.positions.length - 1]);
  assert.deepEqual(new Set(d.bursts.map(b => b.position!.map(v => v.toFixed(6)).join())), new Set(ends.map(e => e.map(v => v.toFixed(6)).join())));
  const snap = sampleParticlesAtTick(d, 30);
  assert.ok(snap.ok);
  assert.equal(snap.value.particles.length, 20, '4 particles per arrival x 5');
  assert.equal(new Set(d.bursts.map(b => b.eventRandomKey)).size, 5, 'distinct event identities');
});

test('speed mode: each ray takes its own length / speed, so the arrival bursts land at different ticks', () => {
  const speed = 4;
  const d = raysDoc(5, { follower: { speed }, mutate: x => set(x, 'node-fw', { durationTicks: 100 }) });
  const p = plan(d);
  const rays = radialPaths([0, 1, 0], { documentSeed: d.seed, randomStreamId: 'rs-node-rad', mode: 'sphere', count: 5, lengthMin: 2, lengthMax: 5, coneAngle: Math.PI / 6, orientation: [0, 0, 0, 1] });
  const travel = rays.map(r => Math.max(1, Math.min(600, Math.round((pathLength(r) / speed) * 60))));
  assert.ok(new Set(travel).size > 1, 'the fixture has rays of different lengths');
  const b = sys(p, 'node-init2').bursts;
  assert.deepEqual(b.map(x => x.tick).sort((x, y) => x - y), travel.map(t => 10 + t).sort((x, y) => x - y));
  // Each burst sits at the end of the ray that arrives then.
  for (const [i, r] of rays.entries()) {
    const hit = b.find(x => x.tick === 10 + travel[i] && x.position!.every((v, k) => Math.abs(v - r.points[1][k]) < 1e-6));
    assert.ok(hit, `ray ${i} arrival at its end`);
  }
  // Follower info reports every path.
  const f = p.followers[0];
  assert.equal(f.pathCount, 5);
  assert.deepEqual(f.travels, travel);
  assert.ok(f.lengths.every((l, i) => Math.abs(l - pathLength(rays[i])) < 1e-6));
});

test('a Schedule started by the arrival starts at the EARLIEST arrival and warns when arrivals differ', () => {
  const build = (follower: Record<string, number>) => raysDoc(5, {
    follower,
    mutate: d => {
      const g = root(d);
      g.nodes.push(node('node-after', 'Schedule', { startTicks: 5, durationTicks: 10, mode: 'window' }));
      g.edges.push(edge('e-after', 'node-follow', 'arrival', 'node-after', 'trigger'));
    },
  });
  const differing = compile(build({ speed: 2 }));
  assert.ok(differing.ok);
  const warn = differing.warnings.find(w => /arrivals at different ticks/.test(w.message));
  assert.ok(warn, 'warning present');
  assert.match(warn.message, /PathFollower "node-follow" has 5 arrivals at different ticks/);
  assert.equal(warn.severity, 'warning');
  // Duration mode: all arrivals coincide, no warning.
  const same = compile(build({}));
  assert.ok(same.ok);
  assert.equal(same.warnings.some(w => /arrivals at different ticks/.test(w.message)), false);
  // eventTick resolves to the earliest arrival.
  const ctx: TimingContext = {
    type: id => (id === 'f' ? 'PathFollower' : id === 'w' ? 'Schedule' : undefined),
    raw: (id, p) => ({ 'f.speed': 1, 'f.durationTicks': 20, 'w.startTicks': 10 } as Record<string, number>)[`${id}.${p}`],
    source: (id, port) => (id === 'f' && port === 'window' ? { nodeId: 'w', port: 'window' } : id === 'f' && port === 'paths' ? { nodeId: 'p', port: 'paths' } : undefined),
    pathLengths: () => [3, 1, 2],
  };
  assert.equal(eventTick(ctx, 'f', 'arrival'), 10 + 60, 'the 1 m path at 1 m/s = 60 ticks is the first arrival');
});

test('single path: no extra tracks, old arrival burst identity, plain descriptor', () => {
  const d = createF01Document();
  const g = root(d);
  g.nodes.push(node('node-line', 'LinePath', { samples: 8 }), node('node-fw', 'Schedule', { startTicks: 10, durationTicks: 40, mode: 'window' }), node('node-follow', 'PathFollower', { durationTicks: 20 }));
  g.edges = g.edges.filter(e => e.id !== 'edge-anchor' && e.id !== 'edge-trigger');
  g.edges.push(edge('e-ls', 'node-source', 'out', 'node-line', 'start'), edge('e-le', 'node-target', 'out', 'node-line', 'end'), edge('e-fp', 'node-line', 'paths', 'node-follow', 'paths'),
    edge('e-fw', 'node-fw', 'window', 'node-follow', 'window'), edge('e-arr', 'node-follow', 'arrival', 'node-emitter', 'trigger'), edge('e-fa', 'node-follow', 'anchor', 'node-emitter', 'anchor'));
  set(d, 'node-emitter', { burst: 12, useEventPosition: true });
  const p = plan(d);
  const s = sys(p, 'node-initial');
  assert.equal(s.extraSourceTracks, undefined);
  assert.equal(s.sourceTrack!.positions.length, 40);
  assert.deepEqual(s.bursts, [{ tick: 30, eventRandomKey: JSON.stringify(['arrival', 'rs-node-follow', 30]), count: 12, position: [0, 1, 5] }]);
  assert.equal(p.followers[0].pathCount, 1);
  assert.deepEqual(p.followers[0].travels, [20]);
});

test('an emitter riding the follower also bursts once per path on its own track at that path\'s arrival', () => {
  const p = plan(raysDoc(3, { follower: { speed: 4 }, mutate: d => {
    set(d, 'node-fw', { durationTicks: 100 });
    const g = root(d);
    g.edges.push(edge('e-arr1', 'node-follow', 'arrival', 'node-emitter', 'trigger', 1));
    set(d, 'node-emitter', { burst: 3, rate: 0, useEventPosition: false });
    const w = g.edges.find(e => e.id === 'edge-trigger');
    if (w) g.edges = g.edges.filter(e => e !== w);
  } }));
  const d = sys(p, 'node-initial');
  assert.equal(d.bursts.length, 3);
  assert.deepEqual(d.bursts.map(b => b.track).sort(), [0, 1, 2]);
  assert.ok(d.bursts.every(b => b.position === undefined));
  const snap = sampleParticlesAtTick(d, Math.max(...d.bursts.map(b => b.tick)));
  assert.ok(snap.ok);
  // Each burst spawned once (3 particles), on its own track, not 3 x 3.
  assert.equal(snap.value.particles.length, 9);
  const created = ParticleSimulation.create(d);
  assert.ok(created.ok);
});

test('flashes and impulses get one tick per distinct arrival tick', () => {
  const mk = (follower: Record<string, number>) => plan(raysDoc(4, { follower, mutate: d => {
    const g = root(d);
    g.nodes.push(node('node-flash', 'ScreenFlash', { durationTicks: 10 }));
    g.edges.push(edge('e-fl', 'node-follow', 'arrival', 'node-flash', 'trigger'), edge('e-fo', 'node-flash', 'presentation', 'node-output', 'presentation'));
  } })).presentation.flashes.map(f => f.tick);
  assert.deepEqual(mk({}), [30], 'all four arrive together: one flash');
  const ticks = mk({ speed: 2 });
  assert.equal(new Set(ticks).size, ticks.length, 'distinct ticks only');
  assert.ok(ticks.length > 1);
});

test('sprites and trails on a follower ride every path in one system; point lights become one per path within the budget', () => {
  const p = plan(raysDoc(3, { mutate: d => {
    const g = root(d);
    g.nodes.push(node('node-core', 'SpriteRenderer', { size: 0.3 }), node('node-light', 'PointLight', {}), node('node-win', 'Schedule', { startTicks: 10, durationTicks: 30, mode: 'window' }),
      node('node-mt', 'MotionTrail', {}));
    g.edges.push(edge('e-ca', 'node-follow', 'anchor', 'node-core', 'anchor'), edge('e-cm', 'node-material', 'material', 'node-core', 'material'), edge('e-cw', 'node-win', 'window', 'node-core', 'window'),
      edge('e-cv', 'node-core', 'visual', 'node-output', 'visual', 2),
      edge('e-la', 'node-follow', 'anchor', 'node-light', 'anchor'), edge('e-lw', 'node-win', 'window', 'node-light', 'window'), edge('e-lv', 'node-light', 'visual', 'node-output', 'visual', 3),
      edge('e-ta', 'node-follow', 'anchor', 'node-mt', 'anchor'), edge('e-tm', 'node-material', 'material', 'node-mt', 'material'), edge('e-tw', 'node-win', 'window', 'node-mt', 'window'), edge('e-tv', 'node-mt', 'visual', 'node-output', 'visual', 4));
  } }));
  const core = sys(p, 'node-core');
  assert.equal(tracksOf(core).length, 3);
  assert.equal(core.attachToSource, true);
  assert.equal(p.layers.filter(l => l.nodeId === 'node-core').length, 1, 'one layer draws all the sprites');
  assert.equal(snapCount(core, 20), 3, 'three sprites, one per path');
  const trail = sys(p, 'node-mt');
  assert.equal(tracksOf(trail).length, 3);
  assert.equal(p.trails.filter(t => t.nodeId === 'node-mt').length, 1);
  assert.equal(p.lights.length, 3);
  assert.deepEqual(p.lights.map(l => l.track?.positions.at(-1)).map(v => v?.map(x => x.toFixed(4)).join()).filter((v, i, a) => a.indexOf(v) === i).length, 3);
  // More paths than the light budget allows: a BUDGET_EXCEEDED error, nothing silently dropped.
  const r = compile(raysDoc(5, { mutate: d => {
    const g = root(d);
    g.nodes.push(node('node-light', 'PointLight', {}), node('node-win', 'Schedule', { startTicks: 10, durationTicks: 30, mode: 'window' }));
    g.edges.push(edge('e-la', 'node-follow', 'anchor', 'node-light', 'anchor'), edge('e-lw', 'node-win', 'window', 'node-light', 'window'), edge('e-lv', 'node-light', 'visual', 'node-output', 'visual', 3));
  } }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some(e => e.code === 'BUDGET_EXCEEDED' && /point lights/.test(e.message)));
});

const snapCount = (d: ParticleEmitterDescriptor, tick: number) => {
  const s = sampleParticlesAtTick(d, tick);
  assert.ok(s.ok);
  return s.value.particles.length;
};

test('a particle budget counts every track', () => {
  const r = compile(raysDoc(128, { mutate: d => { set(d, 'node-emitter', { rate: 240, lifetimeMin: 2, lifetimeMax: 2 }); } }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some(e => e.code === 'BUDGET_EXCEEDED'));
});

test('descriptor validation: extraSourceTracks needs sourceTrack, burst track stays in range', () => {
  const base = { documentSeed: 1, durationTicks: 60, emitterId: 'e', randomStreamId: 'rs', shape: 'point', sourcePosition: [0, 0, 0], initialVelocity: { kind: 'vector', value: [0, 0, 0] }, bursts: [{ tick: 5, eventRandomKey: 'k', count: 1 }], lifetimeTicks: { min: 10, max: 10 }, size: { min: 0.1, max: 0.1 }, operators: [] };
  const tk = { startTick: 0, positions: [[0, 0, 0], [1, 0, 0]] };
  assert.equal(validateParticleDescriptor({ ...base, extraSourceTracks: [tk] }).ok, false);
  assert.ok(validateParticleDescriptor({ ...base, sourceTrack: tk, extraSourceTracks: [tk] }).ok);
  assert.equal(validateParticleDescriptor({ ...base, sourceTrack: tk, extraSourceTracks: [] }).ok, false);
  assert.equal(validateParticleDescriptor({ ...base, bursts: [{ tick: 5, eventRandomKey: 'k', count: 1, track: -1 }] }).ok, false);
});

// ---------------- PathSplitter ----------------

const lines = (lens: number[]): PathData[] => lens.map((l, i) => ({ id: `p${i}`, points: [[0, 0, 0], [l, 0, 0]], widthScale: 1, opacityScale: 1 }));
const split = (paths: PathData[], o: Partial<SplitOptions>) => splitPaths(paths, { documentSeed: 42, randomStreamId: 'rs-x', mode: 'range', from: 0, count: 1, step: 2, offset: 0, ...o });
const ids = (ps: PathData[]) => ps.map(p => p.id);

test('PathSplitter range, everyNth, longest, shortest keep the original order; rest is the complement', () => {
  const ps = lines([3, 1, 4, 1.5, 5, 9]);
  assert.deepEqual(ids(split(ps, { mode: 'range', from: 1, count: 3 }).chosen), ['p1', 'p2', 'p3']);
  assert.deepEqual(ids(split(ps, { mode: 'range', from: 4, count: 10 }).chosen), ['p4', 'p5'], 'clamped to the set');
  assert.deepEqual(ids(split(ps, { mode: 'range', from: 10, count: 2 }).chosen), [], 'past the end');
  assert.deepEqual(ids(split(ps, { mode: 'range', from: 1, count: 3 }).rest), ['p0', 'p4', 'p5']);
  assert.deepEqual(ids(split(ps, { mode: 'everyNth', step: 2, offset: 0 }).chosen), ['p0', 'p2', 'p4']);
  assert.deepEqual(ids(split(ps, { mode: 'everyNth', step: 3, offset: 1 }).chosen), ['p1', 'p4']);
  assert.deepEqual(ids(split(ps, { mode: 'everyNth', step: 1, offset: 5 }).chosen), ['p5']);
  assert.deepEqual(ids(split(ps, { mode: 'longest', count: 2 }).chosen), ['p4', 'p5']);
  assert.deepEqual(ids(split(ps, { mode: 'shortest', count: 2 }).chosen), ['p1', 'p3']);
  assert.deepEqual(ids(split(lines([2, 2, 2]), { mode: 'longest', count: 1 }).chosen), ['p0'], 'ties: lower index first');
  assert.deepEqual(ids(split(ps, { mode: 'shortest', count: 1 }).rest), ['p0', 'p2', 'p3', 'p4', 'p5']);
});

test('PathSplitter random: seeded, stable, the right count, changes with seed or stream', () => {
  const ps = lines(Array.from({ length: 20 }, (_, i) => 1 + i));
  const a = split(ps, { mode: 'random', count: 5 });
  assert.equal(a.chosen.length, 5);
  assert.equal(a.rest.length, 15);
  assert.deepEqual(a, split(ps, { mode: 'random', count: 5 }), 'same inputs, same pick');
  const order = ids(a.chosen).map(s => Number(s.slice(1)));
  assert.deepEqual(order, [...order].sort((x, y) => x - y), 'original order');
  assert.notDeepEqual(ids(split(ps, { mode: 'random', count: 5, randomStreamId: 'rs-y' }).chosen), ids(a.chosen));
  assert.notDeepEqual(ids(split(ps, { mode: 'random', count: 5, documentSeed: 43 }).chosen), ids(a.chosen));
  // Growing the count only adds paths.
  const more = new Set(ids(split(ps, { mode: 'random', count: 8 }).chosen));
  assert.ok(ids(a.chosen).every(i => more.has(i)));
});

test('PathSplitter rejects out-of-range settings', () => {
  assert.throws(() => split(lines([1]), { count: 0 }), RangeError);
  assert.throws(() => split(lines([1]), { step: 0, mode: 'everyNth' }), RangeError);
  assert.throws(() => split(lines([1]), { mode: 'nope' as never }), RangeError);
});

test('PathSplitter node: registry spec, bypass when disabled, feeds the follower so only the chosen paths fly', () => {
  const spec = createRegistry().get('PathSplitter@1');
  assert.ok(spec);
  assert.deepEqual(spec.inputs.map(p => [p.id, p.type, p.required]), [['paths', 'paths', true]]);
  assert.deepEqual(spec.outputs.map(p => p.id), ['paths', 'rest']);
  assert.deepEqual(spec.parameters.find(x => x.id === 'mode')!.choices, ['range', 'everyNth', 'random', 'longest', 'shortest']);
  assert.equal(spec.disabledBehavior, 'bypass');
  // range count 2 of 5 rays: 2 sources, 2 arrival bursts.
  const p = plan(raysDoc(5, { split: { mode: 'range', from: 1, count: 2 } }));
  assert.equal(tracksOf(sys(p, 'node-initial')).length, 2);
  assert.equal(sys(p, 'node-init2').bursts.length, 2);
  assert.equal(p.followers[0].pathCount, 2);
  // Disabled splitter passes everything through.
  const off = plan(raysDoc(5, { split: { mode: 'range', count: 2 }, mutate: d => { root(d).nodes.find(n => n.id === 'node-split')!.enabled = false; } }));
  assert.equal(tracksOf(sys(off, 'node-initial')).length, 5);
  // The chosen/rest outputs are available to the path probe (works anywhere paths flow, not only into a follower).
  const d = raysDoc(5, { split: { mode: 'everyNth', step: 2, offset: 0 } });
  const chosen = compilePathPreview(d, 0, { probe: { nodeId: 'node-split', port: 'paths' } });
  const rest = compilePathPreview(d, 0, { probe: { nodeId: 'node-split', port: 'rest' } });
  assert.ok(chosen.ok && rest.ok);
  assert.deepEqual(chosen.value.probe!.map(x => x.id), ['p0', 'p2', 'p4']);
  assert.deepEqual(rest.value.probe!.map(x => x.id), ['p1', 'p3']);
});

test('exporters emit one source per path (each its own moving route), as the editor does', () => {
  const d = raysDoc(5);
  const rbx = robloxEffectFrom(d), ue = unrealEffectFrom(d);
  assert.ok(rbx.ok && ue.ok);
  // Unreal/Godot IR: the follower emitter appears 5 times, each with its own route ending at its ray's end.
  const ueRiders = ue.value.emitters.filter(e => e.sourceTrack?.length);
  assert.equal(ueRiders.length, 5);
  assert.equal(new Set(ueRiders.map(e => e.sourceTrack!.at(-1)![1].join())).size, 5);
  assert.equal(new Set(ueRiders.map(e => e.name)).size, 5);
  const rbxRiders = rbx.value.emitters.filter(e => e.path?.length);
  assert.equal(rbxRiders.length, 5);
  assert.equal(new Set(rbxRiders.map(e => e.path!.at(-1)![1].join())).size, 5);
  for (const report of [rbx.value.report, ue.value.report]) assert.equal(report.some(r => /first path only/.test(r.message)), false);
  // A single path stays one emitter.
  const one = unrealEffectFrom(raysDoc(1));
  assert.ok(one.ok);
  assert.equal(one.value.emitters.filter(e => e.sourceTrack?.length).length, 1);
});
