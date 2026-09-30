import test from 'node:test';
import assert from 'node:assert/strict';
import type { CurveValue, EffectDocumentV2, NodeDefinition, Quaternion, Vec3 } from '../src/model/types.ts';
import { TICKS_PER_SECOND } from '../src/model/types.ts';
import { compilePathPreview } from '../src/graph/toPaths.ts';
import { createF01Document } from '../src/graph/fixtures.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { ringPath, RING_DEFAULTS, type RingOptions } from '../src/runtime/ring.ts';

const opts = (o: Partial<RingOptions> = {}): RingOptions => ({ ...RING_DEFAULTS, ...o });
const C: Vec3 = [1, 2, 3];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('RingPath registry spec', () => {
  const s = createRegistry().get('RingPath@1');
  assert.ok(s);
  assert.deepEqual(s.inputs.map(p => [p.id, p.type, p.required]), [['center', 'anchor', true]]);
  assert.deepEqual(s.outputs.map(p => p.id), ['paths']);
  const p = Object.fromEntries(s.parameters.map(x => [x.id, x]));
  assert.deepEqual([p.radius.unit, p.minRadius.unit, p.radiusScale.unit], ['meter', 'meter', 'normalized']);
  assert.deepEqual([p.samples.min, p.samples.max], [8, 256]);
  assert.ok(p.radiusScale.domains.includes('effectTime'));
  assert.equal(p.orientation.type, 'quaternion');
  assert.equal(s.disabledBehavior, 'empty');
});

test('ringPath: closed XZ loop, exact repeated endpoint, radius, determinism', () => {
  const p = ringPath(C, opts({ radius: 2, samples: 16 }));
  assert.equal(p.id, 'p0');
  assert.equal(p.points.length, 17);
  assert.deepEqual(p.points[16], p.points[0]);
  for (const v of p.points) {
    assert.ok(v.every(Number.isFinite));
    assert.ok(Math.abs(v[1] - C[1]) < 1e-12);
    assert.ok(Math.abs(dist(v, C) - 2) < 1e-12);
  }
  assert.deepEqual(ringPath(C, opts({ radius: 2, samples: 16 })), p);
  // Actual radius = max(minRadius, radius * radiusScale).
  assert.ok(Math.abs(dist(ringPath(C, opts({ radius: 2, radiusScale: 0.25 })).points[3], C) - 0.5) < 1e-12);
  assert.ok(Math.abs(dist(ringPath(C, opts({ radius: 2, radiusScale: 0, minRadius: 0.3 })).points[3], C) - 0.3) < 1e-12);
  // 90° about X maps the XZ plane to XY.
  const q: Quaternion = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
  for (const v of ringPath(C, opts({ orientation: q })).points) assert.ok(Math.abs(v[2] - C[2]) < 1e-9);
});

test('ringPath rejects invalid options', () => {
  assert.throws(() => ringPath(C, opts({ samples: 7 })), RangeError);
  assert.throws(() => ringPath(C, opts({ samples: 257 })), RangeError);
  assert.throws(() => ringPath(C, opts({ samples: 8.5 })), RangeError);
  assert.throws(() => ringPath(C, opts({ radius: 0 })), RangeError);
  assert.throws(() => ringPath(C, opts({ radius: Number.NaN })), RangeError);
  assert.throws(() => ringPath(C, opts({ radiusScale: 1.5 })), RangeError);
  assert.throws(() => ringPath(C, opts({ minRadius: -1 })), RangeError);
  assert.throws(() => ringPath(C, opts({ orientation: [0, 0, 0, 0] })), TypeError);
  assert.throws(() => ringPath([0, Number.POSITIVE_INFINITY, 0], opts()), TypeError);
});

// ---------- compiler ----------
const node = (id: string, type: string, params: NodeDefinition['params'] = {}, enabled = true): NodeDefinition =>
  ({ id, type, definitionVersion: 1, label: id, enabled, randomStreamId: `rs-${id}`, params });
const edge = (id: string, s: string, sp: string, t: string, tp: string, order = 0) =>
  ({ id, source: { nodeId: s, port: sp }, target: { nodeId: t, port: tp }, order });
const ramp: CurveValue = { domain: 'effectSeconds', interpolation: 'linear', keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };

function ringDoc(params: NodeDefinition['params'] = {}, enabled = true): EffectDocumentV2 {
  const d = createF01Document();
  const g = d.graphs[0];
  g.nodes.push(node('n-ring', 'RingPath', params, enabled), node('n-rib', 'RibbonRenderer'));
  g.edges.push(
    edge('e-rc', 'node-target', 'out', 'n-ring', 'center'),
    edge('e-rp', 'n-ring', 'paths', 'n-rib', 'paths'),
    edge('e-rm', 'node-material', 'material', 'n-rib', 'material'),
    edge('e-ro', 'n-rib', 'visual', 'node-output', 'visual', 1),
  );
  return d;
}
const drive = (d: EffectDocumentV2, target: string, port: string, enabled = true, curve: CurveValue = ramp, id = 'n-etc') => {
  d.graphs[0].nodes.push(node(id, 'EffectTimeCurve', { curve: structuredClone(curve) }, enabled));
  d.graphs[0].edges.push(edge(`e-${id}-${port}`, id, 'value', target, port));
};
const targetPos = (d: EffectDocumentV2) => d.anchors.find(a => a.id === 'target')!.position;
const ringLayer = (r: ReturnType<typeof compilePathPreview>) => {
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  return r.value.layers.find(l => l.nodeId === 'n-rib')!;
};
const half = TICKS_PER_SECOND / 2;

test('compiler: RingPath matches runtime; disabled RingPath is empty', () => {
  const d = ringDoc({ radius: 2, samples: 12 });
  assert.deepEqual(ringLayer(compilePathPreview(d, 0)).paths, [ringPath(targetPos(d), opts({ radius: 2, samples: 12 }))]);
  assert.deepEqual(ringLayer(compilePathPreview(ringDoc({}, false), 0)).paths, []);
});

test('compiler: EffectTimeCurve drives radiusScale; disabled driver falls back to literal', () => {
  const d = ringDoc({ radius: 2, minRadius: 0.1, radiusScale: 0.75 });
  drive(d, 'n-ring', 'radiusScale');
  const at = (tick: number) => dist(ringLayer(compilePathPreview(d, tick)).paths[0].points[0], targetPos(d));
  assert.ok(Math.abs(at(0) - 0.1) < 1e-9); // max(minRadius, 2 * 0)
  assert.ok(Math.abs(at(half) - 1) < 1e-9);
  const off = ringDoc({ radius: 2, radiusScale: 0.75 });
  drive(off, 'n-ring', 'radiusScale', false);
  assert.ok(Math.abs(dist(ringLayer(compilePathPreview(off, half)).paths[0].points[0], targetPos(off)) - 1.5) < 1e-9);
});

test('compiler: EffectTimeCurve drives Material.opacity', () => {
  const d = ringDoc();
  drive(d, 'node-material', 'opacity');
  assert.ok(Math.abs(ringLayer(compilePathPreview(d, half)).opacity - 0.5) < 1e-9);
});

test('compiler: wrong, multiple and invalid drivers and other driven params are addressed errors', () => {
  const errs = (d: EffectDocumentV2) => {
    const r = compilePathPreview(d, 0);
    assert.equal(r.ok, false);
    return r.ok ? [] : r.errors;
  };
  const multi = ringDoc();
  drive(multi, 'n-ring', 'radiusScale');
  drive(multi, 'n-ring', 'radiusScale', true, ramp, 'n-etc2');
  assert.ok(errs(multi).some(e => e.code === 'MULTIPLE_DRIVERS' && e.nodeId === 'n-ring'), JSON.stringify(errs(multi)));

  const bad = ringDoc();
  drive(bad, 'n-ring', 'radiusScale', true, { domain: 'effectSeconds', interpolation: 'linear', keys: [{ x: 0, y: 2 }, { x: 1, y: 2 }] });
  assert.ok(errs(bad).some(e => e.nodeId === 'n-etc'));

  const other = ringDoc();
  drive(other, 'n-ring', 'radius');
  assert.ok(errs(other).some(e => e.nodeId === 'n-ring'));

  const emission = ringDoc();
  drive(emission, 'node-material', 'emission');
  assert.ok(errs(emission).some(e => e.nodeId === 'node-material'));

  const noCenter = ringDoc();
  noCenter.graphs[0].edges = noCenter.graphs[0].edges.filter(e => e.id !== 'e-rc');
  assert.ok(errs(noCenter).length > 0);
});

test('helix points orbit the axis at the radius (tapered as requested); transform rotates/scales about the first point', async () => {
  const { helixPath, transformPath } = await import('../src/runtime/paths.ts');
  const h = helixPath('h', [0, 0, 0], [4, 0, 0], { radius: 0.5, turns: 3, phase: 0, taper: 'none', samples: 64 });
  assert.equal(h.points.length, 64);
  for (const p of h.points) assert.ok(Math.abs(Math.hypot(p[1], p[2]) - 0.5) < 1e-9, 'radius from the x axis');
  assert.ok(Math.abs(h.points[63][0] - 4) < 1e-9);
  const t = helixPath('t', [0, 0, 0], [4, 0, 0], { radius: 0.5, turns: 3, phase: 0, taper: 'in', samples: 64 });
  assert.ok(Math.hypot(t.points[0][1], t.points[0][2]) < 1e-9 && Math.abs(Math.hypot(t.points[63][1], t.points[63][2]) - 0.5) < 1e-9, 'taper in grows from zero');
  const s = Math.SQRT1_2, line = { id: 'l', points: [[1, 0, 0], [2, 0, 0]] as [number, number, number][], widthScale: 1, opacityScale: 1 };
  const r = transformPath(line, [0, 1, 0], [0, 0, s, s], 2);
  const round = (v: number[]) => v.map(x => Math.round(x * 1e9) / 1e9);
  assert.deepEqual(round(r.points[0]), [1, 1, 0], 'first point only offset');
  assert.deepEqual(round(r.points[1]), [1, 3, 0], '+X rotated 90° about Z to +Y, scaled ×2, offset');
});
