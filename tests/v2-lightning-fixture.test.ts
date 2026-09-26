import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePathPreview, type PathPreviewLayer } from '../src/graph/toPaths.ts';
import { createL01Document } from '../src/graph/fixtures.ts';
import { revealPath } from '../src/runtime/paths.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';
import { sampleParticlesAtTick } from '../src/runtime/particles.ts';
import { choosePreviewMode } from '../src/render/previewMode.ts';
import { compileLifeCurve, lifeFraction, sampleLifeCurve } from '../src/render/billboardLife.ts';

const CHARGE = ['node-bb-charge-halo', 'node-bb-charge-core'];
const charge = () => {
  const r = compileParticlePreview(createL01Document(), { ribbonsHandled: true });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  return r.value;
};

const TRUNK = ['node-rib-halo', 'node-rib-outer', 'node-rib-inner', 'node-rib-core'];
const ORDER = ['node-rib-halo', 'node-rib-outer', 'node-rib-branch-glow', 'node-rib-inner', 'node-rib-fork', 'node-rib-branch-core', 'node-rib-core'];

const IMPACT_GLOW = 'node-rib-impact-glow';
const IMPACT = 'node-rib-impact';
const IMPACTS = [IMPACT_GLOW, IMPACT];
const total = (layers: { paths: unknown[] }[]) => layers.reduce((s, l) => s + l.paths.length, 0);

const BOLT = [...TRUNK, 'node-rib-branch-glow', 'node-rib-branch-core', 'node-rib-fork'];

test('L01 validates and compiles at tick 40 into seven active nonempty bolt layers plus idle impact glow/core layers', () => {
  const r = compilePathPreview(createL01Document(), 40);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  assert.deepEqual(r.value.layers.map(l => l.nodeId), [...ORDER, ...IMPACTS]);
  for (const l of r.value.layers.filter(l => !IMPACTS.includes(l.nodeId))) {
    assert.ok(l.active, l.nodeId);
    assert.ok(l.paths.length > 0 && l.paths.every(p => p.points.length >= 2), l.nodeId);
  }
  for (const id of IMPACTS) {
    const impact: PathPreviewLayer = r.value.layers.find(l => l.nodeId === id)!;
    assert.equal(impact.active, false, id);
    assert.equal(impact.paths.length, 0, id);
  }
  assert.equal(total(r.value.layers), 39);
});

test('L01 trunk and branch ribbons share one editable Schedule window: visible ticks 24-62 only', () => {
  const d = createL01Document();
  const sched = d.graphs[0].nodes.find(n => n.id === 'node-bolt-window')!;
  assert.equal(sched.type, 'Schedule');
  assert.deepEqual(sched.params, { startTicks: 24, durationTicks: 39, mode: 'window' });
  const wired = d.graphs[0].edges.filter(e => e.source.nodeId === 'node-bolt-window').map(e => e.target.nodeId).sort();
  assert.deepEqual(wired, [...BOLT].sort());
  const at = (tick: number) => {
    const r = compilePathPreview(createL01Document(), tick);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
    return r.value;
  };
  for (const [tick, on] of [[0, false], [23, false], [24, true], [62, true], [63, false]] as const) {
    const v = at(tick);
    for (const id of BOLT) {
      const l = v.layers.find(l => l.nodeId === id)!;
      assert.equal(l.active, on, `tick ${tick} ${id}`);
      assert.equal(l.paths.length > 0, on, `tick ${tick} ${id}`);
      if (on) assert.deepEqual(l.window, { startTick: 24, endTick: 63 });
    }
  }
  // Fork timing explicitly: 7 fork paths only inside ticks 24-62.
  for (const [tick, n] of [[23, 0], [24, 7], [62, 7], [63, 0]] as const) {
    assert.equal(at(tick).layers.find(l => l.nodeId === 'node-rib-fork')!.paths.length, n, `fork tick ${tick}`);
  }
  assert.equal(total(at(63).layers), 0);
  // Editing the one shared Schedule moves every bolt layer together.
  const e = createL01Document();
  (e.graphs[0].nodes.find(n => n.id === 'node-bolt-window')!.params as Record<string, unknown>).startTicks = 0;
  const r = compilePathPreview(e, 0);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  for (const id of BOLT) assert.ok(r.value.layers.find(l => l.nodeId === id)!.active, id);
});

test('L01 impact sparks begin when the revealed bolt reaches the target, ticks 26-38', () => {
  const at = (tick: number) => {
    const r = compilePathPreview(createL01Document(), tick);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
    return r.value;
  };
  for (const tick of [0, 23, 24, 25, 38, 60]) {
    const v = at(tick);
    for (const id of IMPACTS) assert.equal(v.layers.find(l => l.nodeId === id)!.paths.length, 0, `tick ${tick} ${id}`);
    // Before the bolt window nothing is visible, fork ribbon included.
    assert.equal(total(v.layers), tick < 24 ? 0 : 39, `tick ${tick}`);
  }
  for (const tick of [26, 30, 37]) {
    const v = at(tick);
    const glow = v.layers.find(l => l.nodeId === IMPACT_GLOW)!;
    const impact = v.layers.find(l => l.nodeId === IMPACT)!;
    for (const l of [glow, impact]) {
      assert.ok(l.active, l.nodeId);
      assert.deepEqual(l.window, { startTick: 26, endTick: 38 });
      assert.equal(l.paths.length, 10, l.nodeId);
      assert.equal(l.blend, 'additive');
    }
    assert.equal(total(v.layers), 59);
    // Both layers share one RadialPath: soft wide cyan glow under a thin bright white core.
    assert.deepEqual(glow.paths, impact.paths);
    assert.equal(glow.renderOrderOffset, 7);
    assert.equal(impact.renderOrderOffset, 8);
    assert.equal(glow.width, 0.06);
    assert.equal(impact.width, 0.02);
    assert.equal(glow.opacity, 0.32);
    assert.equal(impact.opacity, 0.9);
    for (const p of impact.paths) {
      assert.equal(p.points.length, 2);
      assert.ok(Math.hypot(p.points[0][0] - 1.6, p.points[0][1] - 0.8, p.points[0][2]) < 1e-9, 'starts at the target');
      const [x, y, z] = p.points[1];
      const len = Math.hypot(x - 1.6, y - 0.8, z);
      assert.ok(len >= 0.18 - 1e-9 && len <= 0.45 + 1e-9, `len ${len}`);
      assert.ok(Math.abs(z) < 1e-9, `disc rotated into the XY view plane: z ${z}`);
    }
  }
  assert.deepEqual(at(26).layers.find(l => l.nodeId === IMPACT)!.paths, at(37).layers.find(l => l.nodeId === IMPACT)!.paths);
});

test('L01 trunk layers share one bowed trunk; branches and forks are separate path sets', () => {
  const r = compilePathPreview(createL01Document(), 30);
  assert.ok(r.ok);
  const by = (id: string) => r.value.layers.find(l => l.nodeId === id)!;
  for (const id of TRUNK) assert.equal(by(id).paths.length, 1, id);
  assert.equal(by('node-rib-branch-core').paths.length, 14);
  assert.deepEqual(by('node-rib-branch-glow').paths, by('node-rib-branch-core').paths);
  assert.equal(by('node-rib-fork').paths.length, 7);
  assert.notDeepEqual(by('node-rib-fork').paths, by('node-rib-branch-core').paths);
  const trunk = by('node-rib-core').paths[0].points;
  assert.equal(trunk.length, 42);
  const maxY = Math.max(...trunk.map(p => p[1]));
  assert.ok(maxY > 0.8 + 0.2, `trunk bows/jags upward: ${maxY}`);
});

test('L01 bolt stays path-based; the only particle nodes are the generic charge chain', () => {
  const nodes = createL01Document().graphs.flatMap(g => g.nodes);
  const types = nodes.map(n => n.type);
  assert.ok(types.includes('BezierPath') && types.includes('JaggedPath'));
  assert.equal(types.filter(t => t === 'BranchPath').length, 2);
  assert.deepEqual(nodes.filter(n => n.type === 'BillboardRenderer').map(n => n.id), CHARGE);
  assert.deepEqual(nodes.filter(n => n.type === 'Emitter').map(n => n.id), ['node-charge-emitter']);
  assert.equal(types.filter(t => t === 'InitialProperties').length, 2);
});

test('L01 root is mixed: path compile skips charge billboards, point compile skips ribbons', () => {
  const d = createL01Document();
  assert.deepEqual(choosePreviewMode(d), { mode: 'mixed' });
  const plan = charge();
  assert.deepEqual(plan.layers.map(l => l.nodeId), CHARGE);
  assert.equal(plan.systems.length, 2);
  for (const s of plan.systems) assert.deepEqual(s.descriptor.sourcePosition, [-1.6, 0.8, 0]);
  const paths = compilePathPreview(d, 30);
  assert.ok(paths.ok, JSON.stringify(!paths.ok && paths.errors));
  assert.ok(!paths.value.layers.some(l => CHARGE.includes(l.nodeId)));
  // Charge layers draw below every bolt and impact ribbon.
  const ribbonMin = Math.min(...paths.value.layers.map(l => l.renderOrderOffset));
  for (const l of plan.layers) assert.ok(l.renderOrderOffset < ribbonMin, l.nodeId);
  const [halo, core] = plan.layers;
  assert.ok(halo.renderOrderOffset < core.renderOrderOffset, 'halo under core');
  assert.equal(halo.blend, 'additive');
  assert.equal(core.blend, 'additive');
  const size = (id: string) => plan.systems.find(s => s.id === id)!.descriptor.size.max;
  assert.ok(size('node-charge-halo-props') > size('node-charge-core-props'), 'halo wider than core');
});

test('L01 charge overlaps the first strike tick, ends by tick 25, and the bolt is visible at tick 26', () => {
  const plan = charge();
  const live = (tick: number) => plan.systems.map(s => {
    const r = sampleParticlesAtTick(s.descriptor, tick);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
    return r.value.particles.length;
  });
  for (const tick of [0, 1, 12, 23, 24]) for (const n of live(tick)) assert.ok(n >= 1, `tick ${tick} live charge`);
  for (const tick of [25, 26, 40]) assert.deepEqual(live(tick), [0, 0], `tick ${tick} charge ended`);
  const r = compilePathPreview(createL01Document(), 26);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  for (const id of BOLT) assert.ok(r.value.layers.find(l => l.nodeId === id)!.paths.some(p => p.points.length >= 2), `bolt ${id} at 26`);
  // Charge timing is editable: a longer Emitter lifetime extends the layers.
  const e = createL01Document();
  (e.graphs[0].nodes.find(n => n.id === 'node-charge-emitter')!.params as Record<string, unknown>).lifetimeMax = 0.5;
  (e.graphs[0].nodes.find(n => n.id === 'node-charge-emitter')!.params as Record<string, unknown>).lifetimeMin = 0.5;
  const longer = compileParticlePreview(e, { ribbonsHandled: true });
  assert.ok(longer.ok, JSON.stringify(!longer.ok && longer.errors));
  const s = sampleParticlesAtTick(longer.value.systems[0].descriptor, 26);
  assert.ok(s.ok && s.value.particles.length === 1);
});

test('L01 charge grows 1x -> 7x and brightens 0.2 -> 1 through generic billboard life curves', () => {
  const d = createL01Document();
  const node = (id: string) => d.graphs[0].nodes.find(n => n.id === id)!.params as Record<string, unknown>;
  const sizeCurve = { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 1 }, { x: 1, y: 7 }] };
  const opacityCurve = { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 0.2 }, { x: 1, y: 1 }] };
  for (const id of CHARGE) {
    assert.deepEqual(node(id).sizeOverLife, sizeCurve, id);
    assert.deepEqual(node(id).opacityOverLife, opacityCurve, id);
  }
  assert.equal(node('node-charge-halo-props').sizeMin, 0.2);
  assert.equal(node('node-charge-halo-props').sizeMax, 0.2);
  assert.equal(node('node-charge-core-props').sizeMin, 0.04);
  assert.equal(node('node-charge-core-props').sizeMax, 0.04);

  const plan = charge();
  const birth: Record<string, number> = { 'node-charge-halo-props': 0.2, 'node-charge-core-props': 0.04 };
  for (let i = 0; i < CHARGE.length; i++) {
    const layer = plan.layers[i];
    assert.deepEqual(layer.sizeOverLife, sizeCurve, layer.nodeId);
    assert.deepEqual(layer.opacityOverLife, opacityCurve, layer.nodeId);
    const system = plan.systems.find(s => s.id === layer.systemId)!;
    const sizeS = compileLifeCurve(layer.sizeOverLife);
    const opacityS = compileLifeCurve(layer.opacityOverLife);
    for (const tick of [0, 12, 23]) {
      const r = sampleParticlesAtTick(system.descriptor, tick);
      assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
      assert.equal(r.value.particles.length, 1, `${layer.nodeId} tick ${tick}`);
      const p = r.value.particles[0];
      assert.equal(p.lifetimeTicks, 25);
      assert.equal(p.ageTicks, tick);
      const t = lifeFraction(p.ageTicks, p.lifetimeTicks, 0);
      const bSize = birth[system.id];
      assert.ok(Math.abs(p.size - bSize) < 1e-9);
      assert.ok(Math.abs(p.size * sampleLifeCurve(sizeS, t) - bSize * (1 + 6 * tick / 25)) < 1e-9, `${layer.nodeId} size @${tick}`);
      assert.ok(Math.abs(sampleLifeCurve(opacityS, t) - (0.2 + 0.8 * tick / 25)) < 1e-9, `${layer.nodeId} opacity @${tick}`);
    }
    // Full life end reaches 7x: halo 1.4 m, core 0.28 m.
    assert.ok(Math.abs(birth[system.id] * sampleLifeCurve(sizeS, 1) - birth[system.id] * 7) < 1e-9);
  }
  assert.ok(Math.abs(0.2 * 7 - 1.4) < 1e-9 && Math.abs(0.04 * 7 - 0.28) < 1e-9);
});

test('L01 trunk uses the reference four-layer widths/opacities with distinct materials', () => {
  const r = compilePathPreview(createL01Document(), 30);
  assert.ok(r.ok);
  for (const l of r.value.layers) {
    assert.deepEqual(l.widthOverPath.keys, [{ x: 0, y: 1 }, { x: 1, y: 1 }]);
    assert.equal(l.uvMode, 'stretch');
    assert.equal(l.orientation, 'camera');
    assert.notEqual(l.blend, 'cutout');
  }
  const by = (id: string) => r.value.layers.find(l => l.nodeId === id)!;
  assert.deepEqual(TRUNK.map(id => by(id).width), [0.43, 0.185, 0.07, 0.026]);
  assert.deepEqual(TRUNK.map(id => by(id).opacity), [0.07, 0.17, 0.65, 1]);
  assert.ok(by('node-rib-fork').width < by('node-rib-branch-core').width);
  assert.equal(new Set(r.value.layers.map(l => l.color.srgb)).size, 9);
});

test('L01 trunk layers use endFade 0 to reach the target; branch, fork and impact layers keep the 0.12 default', () => {
  for (const tick of [0, 30]) {
    const r = compilePathPreview(createL01Document(), tick);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
    for (const l of r.value.layers) assert.equal(l.endFade, TRUNK.includes(l.nodeId) ? 0 : 0.12, `tick ${tick} ${l.nodeId}`);
    assert.equal(total(r.value.layers), tick === 0 ? 0 : 59, `tick ${tick}`);
  }
});

test('RibbonRenderer endFade outside 0..0.5 is an addressed error', () => {
  for (const bad of [-0.1, 0.6, Number.NaN]) {
    const d = createL01Document();
    const n = d.graphs[0].nodes.find(n => n.id === 'node-rib-core')!;
    (n.params as Record<string, unknown>).endFade = bad;
    const r = compilePathPreview(d, 0);
    assert.ok(!r.ok, `endFade ${bad} accepted`);
    assert.ok(r.errors.some(e => e.severity === 'error' && e.fieldPath?.includes('endFade') && (Number.isNaN(bad) || e.nodeId === 'node-rib-core')), JSON.stringify(r.errors));
  }
  const d = createL01Document();
  (d.graphs[0].nodes.find(n => n.id === 'node-rib-core')!.params as Record<string, unknown>).endFade = 0.5;
  const r = compilePathPreview(d, 0);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  assert.equal(r.value.layers.find(l => l.nodeId === 'node-rib-core')!.endFade, 0.5);
});

test('L01 paths are finite and bounded across the effect', () => {
  for (const tick of [0, 30, 60, 119]) {
    const r = compilePathPreview(createL01Document(), tick);
    assert.ok(r.ok);
    for (const l of r.value.layers) for (const p of l.paths) for (const [x, y, z] of p.points) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z));
      assert.ok(Math.abs(x) <= 3.2 && y >= -1.2 && y <= 3.2 && Math.abs(z) <= 1.6, `tick ${tick} ${l.nodeId}: ${x},${y},${z}`);
    }
  }
});

test('L01 is deterministic and calls return independent documents', () => {
  const a = createL01Document();
  const b = createL01Document();
  assert.notEqual(a, b);
  assert.deepEqual(a, b);
  a.graphs[0].nodes.pop();
  a.anchors[0].position[0] = 99;
  assert.deepEqual(createL01Document(), b);
  assert.deepEqual(compilePathPreview(createL01Document(), 12), compilePathPreview(b, 12));
});

test('L01 strike reveal: one EffectTimeCurve drives one RevealPath per distinct path set', () => {
  const g = createL01Document().graphs[0];
  const curve = g.nodes.find(n => n.id === 'node-strike-curve')!;
  assert.equal(curve.type, 'EffectTimeCurve');
  assert.deepEqual((curve.params as unknown as { curve: { keys: unknown } }).curve.keys, [{ x: 24 / 60, y: 0 }, { x: 26 / 60, y: 1 }]);
  const driven = g.edges.filter(e => e.source.nodeId === 'node-strike-curve');
  assert.deepEqual(driven.map(e => `${e.target.nodeId}.${e.target.port}`).sort(),
    ['node-reveal-branches.fraction', 'node-reveal-forks.fraction', 'node-reveal-trunk.fraction']);
  assert.equal(g.nodes.filter(n => n.type === 'RevealPath').length, 3);
  const feeds = (id: string) => g.edges.find(e => e.target.nodeId === id && e.target.port === 'paths')!.source.nodeId;
  for (const id of TRUNK) assert.equal(feeds(id), 'node-reveal-trunk', id);
  for (const id of ['node-rib-branch-glow', 'node-rib-branch-core']) assert.equal(feeds(id), 'node-reveal-branches', id);
  assert.equal(feeds('node-rib-fork'), 'node-reveal-forks');
  // Impact begins when the reveal reaches the target.
  assert.deepEqual(g.nodes.find(n => n.id === 'node-impact-window')!.params, { startTicks: 26, durationTicks: 12, mode: 'window' });
});

test('L01 bolt grows over ticks 24-26: zero, partial, full; absent at 0 and 63', () => {
  const at = (tick: number, curveOn = true) => {
    const d = createL01Document();
    d.graphs[0].nodes.find(n => n.id === 'node-strike-curve')!.enabled = curveOn;
    const r = compilePathPreview(d, tick);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
    return (id: string) => r.value.layers.find(l => l.nodeId === id)!;
  };
  const counts: Record<string, number> = { 'node-rib-branch-glow': 14, 'node-rib-branch-core': 14, 'node-rib-fork': 7 };
  for (const tick of [0, 63]) {
    const by = at(tick);
    for (const id of BOLT) assert.equal(by(id).paths.length, 0, `tick ${tick} ${id}`);
  }
  const t24 = at(24);
  for (const id of BOLT) {
    assert.ok(t24(id).active, id);
    assert.equal(t24(id).paths.length, counts[id] ?? 1, id);
    assert.ok(t24(id).paths.every(p => p.points.length === 0), `tick 24 zero geometry ${id}`);
  }
  // Tick 25: each path is the ~half-arc-length clip of the unrevealed (curve disabled → literal 1) path.
  const t25 = at(25), full25 = at(25, false);
  for (const id of BOLT) {
    assert.equal(t25(id).paths.length, counts[id] ?? 1, id);
    t25(id).paths.forEach((p, i) => {
      const f = full25(id).paths[i];
      assert.ok(p.points.length >= 2 && p.points.length <= f.points.length, `tick 25 partial ${id}#${i}`);
      assert.deepEqual(p.points[0], f.points[0], `grows from its attachment ${id}#${i}`);
      const e = revealPath(f, 0.5).points.at(-1)!, q = p.points.at(-1)!;
      assert.ok(Math.hypot(e[0] - q[0], e[1] - q[1], e[2] - q[2]) < 1e-9, `tick 25 half clip ${id}#${i}`);
    });
  }
  const t26 = at(26), full26 = at(26, false);
  for (const id of BOLT) assert.deepEqual(t26(id).paths, full26(id).paths, `tick 26 full ${id}`);
  const tip = t26('node-rib-core').paths[0].points.at(-1)!;
  assert.ok(Math.hypot(tip[0] - 1.6, tip[1] - 0.8, tip[2]) < 1e-9, 'full trunk reaches the target');
});

test('L01 strike reveal is deterministic', () => {
  for (const tick of [24, 25, 26]) assert.deepEqual(compilePathPreview(createL01Document(), tick), compilePathPreview(createL01Document(), tick));
});

test('L01 nodes stay removable: dropping the fork ribbon still compiles', () => {
  const d = createL01Document();
  const g = d.graphs[0];
  g.nodes = g.nodes.filter(n => n.id !== 'node-rib-fork');
  g.edges = g.edges.filter(e => e.source.nodeId !== 'node-rib-fork' && e.target.nodeId !== 'node-rib-fork');
  delete d.editor.graphs['graph-root'].nodes['node-rib-fork'];
  const r = compilePathPreview(d, 0);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  assert.equal(r.value.layers.length, 8);
});

test('L01 layers can be disabled: disabled halo is skipped, disabled fork BranchPath empties forks', () => {
  const d = createL01Document();
  for (const n of d.graphs[0].nodes) if (n.id === 'node-rib-halo' || n.id === 'node-fork') n.enabled = false;
  const r = compilePathPreview(d, 30);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  assert.ok(!r.value.layers.some(l => l.nodeId === 'node-rib-halo'));
  assert.equal(r.value.layers.find(l => l.nodeId === 'node-rib-fork')!.paths.length, 0);
  assert.equal(r.value.layers.find(l => l.nodeId === 'node-rib-branch-core')!.paths.length, 14);
});
