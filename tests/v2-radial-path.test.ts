import test from 'node:test';
import assert from 'node:assert/strict';
import type { EffectDocumentV2, NodeDefinition, Quaternion, Vec3 } from '../src/model/types.ts';
import { compilePathPreview } from '../src/graph/toPaths.ts';
import { createF01Document } from '../src/graph/fixtures.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { radialPaths, RADIAL_DEFAULTS, type RadialOptions } from '../src/runtime/radial.ts';

const opts = (o: Partial<RadialOptions> = {}): RadialOptions => ({ documentSeed: 42, randomStreamId: 'rs-n-rad', ...RADIAL_DEFAULTS, ...o });
const C: Vec3 = [1, 2, 3];
const dir = (p: { points: Vec3[] }): Vec3 => {
  const [a, b] = p.points;
  const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l];
};
const len = (p: { points: Vec3[] }) => Math.hypot(...p.points[1].map((v, i) => v - p.points[0][i]) as Vec3);

test('RadialPath registry spec matches plan24 defaults and bounds', () => {
  const s = createRegistry().get('RadialPath@1');
  assert.ok(s);
  assert.deepEqual(s.inputs.map(p => [p.id, p.type, p.required]), [['center', 'anchor', true], ['window', 'timeWindow', false]]);
  assert.deepEqual(s.outputs.map(p => p.id), ['paths']);
  const p = Object.fromEntries(s.parameters.map(x => [x.id, x]));
  assert.deepEqual(p.mode.choices, ['sphere', 'disc', 'cone']);
  assert.deepEqual([p.count.default, p.count.min, p.count.max], [32, 1, 128]);
  assert.deepEqual([p.lengthMin.default, p.lengthMax.default, p.lengthMin.min, p.lengthMax.max], [0.6, 2.4, 0.001, 50]);
  assert.deepEqual([p.coneAngle.default, p.coneAngle.min, p.coneAngle.max], [Math.PI / 6, 0, Math.PI]);
  assert.deepEqual(p.orientation.default, [0, 0, 0, 1]);
  assert.equal(s.disabledBehavior, 'empty');
});

test('radialPaths: ids, start at center, unit directions, length range, determinism', () => {
  const a = radialPaths(C, opts());
  assert.equal(a.length, 32);
  assert.deepEqual(a.map(p => p.id), a.map((_, i) => `p${i}`));
  for (const p of a) {
    assert.deepEqual(p.points[0], C);
    assert.equal(p.points.length, 2);
    const l = len(p);
    assert.ok(l >= 0.6 - 1e-12 && l <= 2.4 + 1e-12);
    assert.deepEqual([p.widthScale, p.opacityScale], [1, 1]);
  }
  assert.deepEqual(radialPaths(C, opts()), a);
  assert.notDeepEqual(radialPaths(C, opts({ randomStreamId: 'other' })), a);
  // Index-derived keys: a smaller count is a prefix.
  assert.deepEqual(radialPaths(C, opts({ count: 5 })), a.slice(0, 5));
});

test('radialPaths: disc stays in XZ, cone stays inside the angle, orientation rotates', () => {
  for (const p of radialPaths(C, opts({ mode: 'disc', count: 64 }))) assert.ok(Math.abs(dir(p)[1]) < 1e-12);
  for (const p of radialPaths(C, opts({ mode: 'cone', count: 64 }))) assert.ok(dir(p)[1] >= Math.cos(Math.PI / 6) - 1e-12);
  for (const p of radialPaths(C, opts({ mode: 'cone', coneAngle: 0, count: 4 }))) assert.deepEqual(dir(p).map(v => Math.round(v * 1e9) / 1e9), [0, 1, 0]);
  // 90° about X maps +Y to +Z.
  const q: Quaternion = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
  for (const p of radialPaths(C, opts({ mode: 'cone', coneAngle: 0, count: 2, orientation: q }))) {
    const d = dir(p);
    assert.ok(Math.abs(d[2] - 1) < 1e-9);
  }
  const s = radialPaths(C, opts({ count: 128 }));
  const meanY = s.reduce((t, p) => t + dir(p)[1], 0) / s.length;
  assert.ok(Math.abs(meanY) < 0.2, `sphere mean y ${meanY}`);
  assert.ok(s.some(p => dir(p)[1] < 0));
});

test('radialPaths rejects invalid options', () => {
  assert.throws(() => radialPaths(C, opts({ count: 0 })), RangeError);
  assert.throws(() => radialPaths(C, opts({ count: 129 })), RangeError);
  assert.throws(() => radialPaths(C, opts({ lengthMin: 3, lengthMax: 1 })), RangeError);
  assert.throws(() => radialPaths(C, opts({ lengthMax: 51 })), RangeError);
  assert.throws(() => radialPaths(C, opts({ coneAngle: 4 })), RangeError);
  assert.throws(() => radialPaths(C, opts({ orientation: [0, 0, 0, 0] })), TypeError);
});

// ---------- compiler ----------
const node = (id: string, type: string, params: NodeDefinition['params'] = {}, enabled = true): NodeDefinition =>
  ({ id, type, definitionVersion: 1, label: id, enabled, randomStreamId: `rs-${id}`, params });
const edge = (id: string, s: string, sp: string, t: string, tp: string, order = 0) =>
  ({ id, source: { nodeId: s, port: sp }, target: { nodeId: t, port: tp }, order });

function radialDoc(params: NodeDefinition['params'] = {}, enabled = true): EffectDocumentV2 {
  const d = createF01Document();
  const g = d.graphs[0];
  g.nodes.push(node('n-rad', 'RadialPath', params, enabled), node('n-rib', 'RibbonRenderer'));
  g.edges.push(
    edge('e-rc', 'node-target', 'out', 'n-rad', 'center'),
    edge('e-rp', 'n-rad', 'paths', 'n-rib', 'paths'),
    edge('e-rm', 'node-material', 'material', 'n-rib', 'material'),
    edge('e-ro', 'n-rib', 'visual', 'node-output', 'visual', 1),
  );
  return d;
}
const targetPos = (d: EffectDocumentV2) => d.anchors.find(a => a.id === 'target')!.position;

test('compiler: RadialPath at the target anchor matches the runtime', () => {
  const d = radialDoc({ mode: 'cone', count: 12 });
  const r = compilePathPreview(d, 0);
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  const expected = radialPaths(targetPos(d), { ...opts({ mode: 'cone', count: 12 }), documentSeed: d.seed });
  assert.deepEqual(r.value.layers[0].paths, expected);
});

test('compiler: root transform applies once; disabled RadialPath is empty', () => {
  const d = radialDoc({ count: 3 });
  d.rootTransform = { position: [10, 0, 0], rotation: [0, 0, 0, 1], scale: 2 };
  const r = compilePathPreview(d, 0);
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  const local = radialPaths(targetPos(d), { ...opts({ count: 3 }), documentSeed: d.seed });
  assert.deepEqual(r.value.layers[0].paths.map(p => p.points), local.map(p => p.points.map(v => [v[0] * 2 + 10, v[1] * 2, v[2] * 2])));

  const off = compilePathPreview(radialDoc({}, false), 0);
  if (!off.ok) assert.fail(JSON.stringify(off.errors));
  assert.deepEqual(off.value.layers[0].paths, []);
});

test('compiler: invalid length range and connected window are addressed errors', () => {
  const bad = compilePathPreview(radialDoc({ lengthMin: 3, lengthMax: 1 }), 0);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.errors.some(e => e.nodeId === 'n-rad'));

  const d = radialDoc();
  d.graphs[0].nodes.push(node('n-sch', 'Schedule'));
  d.graphs[0].edges.push(edge('e-rw', 'n-sch', 'window', 'n-rad', 'window'));
  const w = compilePathPreview(d, 0);
  assert.equal(w.ok, false);
  if (!w.ok) assert.ok(w.errors.some(e => e.nodeId === 'n-rad' && /window/.test(e.message)));
});
