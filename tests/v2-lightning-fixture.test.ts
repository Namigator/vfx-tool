import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePathPreview } from '../src/graph/toPaths.ts';
import { createL01Document } from '../src/graph/fixtures.ts';

const TRUNK = ['node-rib-halo', 'node-rib-outer', 'node-rib-inner', 'node-rib-core'];
const ORDER = ['node-rib-halo', 'node-rib-outer', 'node-rib-branch-glow', 'node-rib-inner', 'node-rib-fork', 'node-rib-branch-core', 'node-rib-core'];

test('L01 validates and compiles at tick 0 into seven active nonempty ribbon layers', () => {
  const r = compilePathPreview(createL01Document(), 0);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  assert.deepEqual(r.value.layers.map(l => l.nodeId), ORDER);
  for (const l of r.value.layers) {
    assert.ok(l.active, l.nodeId);
    assert.ok(l.paths.length > 0 && l.paths.every(p => p.points.length >= 2), l.nodeId);
  }
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
  assert.equal(new Set(r.value.layers.map(l => l.color.srgb)).size, 7);
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
  assert.equal(r.value.layers.length, 6);
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
