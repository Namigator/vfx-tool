import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePathPreview, type PathPreviewLayer } from '../src/graph/toPaths.ts';
import { createL01Document } from '../src/graph/fixtures.ts';

const TRUNK = ['node-rib-halo', 'node-rib-outer', 'node-rib-inner', 'node-rib-core'];
const ORDER = ['node-rib-halo', 'node-rib-outer', 'node-rib-branch-glow', 'node-rib-inner', 'node-rib-fork', 'node-rib-branch-core', 'node-rib-core'];

const IMPACT_GLOW = 'node-rib-impact-glow';
const IMPACT = 'node-rib-impact';
const IMPACTS = [IMPACT_GLOW, IMPACT];
const total = (layers: { paths: unknown[] }[]) => layers.reduce((s, l) => s + l.paths.length, 0);

test('L01 validates and compiles at tick 0 into seven active nonempty bolt layers plus idle impact glow/core layers', () => {
  const r = compilePathPreview(createL01Document(), 0);
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

test('L01 impact sparks appear only inside the ticks 24-36 window as a short radial burst at the target', () => {
  const at = (tick: number) => {
    const r = compilePathPreview(createL01Document(), tick);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
    return r.value;
  };
  for (const tick of [0, 23, 36, 60]) {
    const v = at(tick);
    for (const id of IMPACTS) assert.equal(v.layers.find(l => l.nodeId === id)!.paths.length, 0, `tick ${tick} ${id}`);
    assert.equal(total(v.layers), 39, `tick ${tick}`);
  }
  for (const tick of [24, 30, 35]) {
    const v = at(tick);
    const glow = v.layers.find(l => l.nodeId === IMPACT_GLOW)!;
    const impact = v.layers.find(l => l.nodeId === IMPACT)!;
    for (const l of [glow, impact]) {
      assert.ok(l.active, l.nodeId);
      assert.deepEqual(l.window, { startTick: 24, endTick: 36 });
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
  assert.deepEqual(at(24).layers.find(l => l.nodeId === IMPACT)!.paths, at(35).layers.find(l => l.nodeId === IMPACT)!.paths);
});

test('L01 trunk layers share one bowed trunk; branches and forks are separate path sets', () => {
  const r = compilePathPreview(createL01Document(), 0);
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

test('L01 is path-only: no BillboardRenderer or particle nodes', () => {
  const types = createL01Document().graphs.flatMap(g => g.nodes.map(n => n.type));
  for (const t of ['BillboardRenderer', 'Emitter', 'InitialProperties']) assert.ok(!types.includes(t), t);
  assert.ok(types.includes('BezierPath') && types.includes('JaggedPath'));
  assert.equal(types.filter(t => t === 'BranchPath').length, 2);
});

test('L01 trunk uses the reference four-layer widths/opacities with distinct materials', () => {
  const r = compilePathPreview(createL01Document(), 0);
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
    assert.equal(total(r.value.layers), tick === 0 ? 39 : 59, `tick ${tick}`);
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
  const r = compilePathPreview(d, 0);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  assert.ok(!r.value.layers.some(l => l.nodeId === 'node-rib-halo'));
  assert.equal(r.value.layers.find(l => l.nodeId === 'node-rib-fork')!.paths.length, 0);
  assert.equal(r.value.layers.find(l => l.nodeId === 'node-rib-branch-core')!.paths.length, 14);
});
