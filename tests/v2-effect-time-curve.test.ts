import test from 'node:test';
import assert from 'node:assert/strict';
import type { CurveValue, EffectDocumentV2, NodeDefinition, Vec3 } from '../src/model/types.ts';
import { compilePathPreview } from '../src/graph/toPaths.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { createF01Document } from '../src/graph/fixtures.ts';
import { evaluateCurve } from '../src/runtime/curves.ts';
import { linePath, revealPath } from '../src/runtime/paths.ts';

const node = (id: string, type: string, params: NodeDefinition['params'] = {}, enabled = true): NodeDefinition =>
  ({ id, type, definitionVersion: 1, label: id, enabled, randomStreamId: `rs-${id}`, params });
const edge = (id: string, s: string, sp: string, t: string, tp: string, order = 0) =>
  ({ id, source: { nodeId: s, port: sp }, target: { nodeId: t, port: tp }, order });

const S: Vec3 = [0, 1, 0];
const T: Vec3 = [0, 1, 5];
const LINEAR: CurveValue = { domain: 'effectSeconds', interpolation: 'linear', keys: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }] };
const HOLD: CurveValue = { domain: 'effectSeconds', interpolation: 'hold', keys: [{ x: 0, y: 0 }, { x: 0.4, y: 0.5 }, { x: 0.5, y: 1 }] };

/** F01 + line → reveal(fraction 0.25) → ribbon, with EffectTimeCurve driving `target` (default reveal.fraction). */
function doc(curve: unknown = LINEAR, opts: { enabled?: boolean; target?: [string, string]; extra?: NodeDefinition[]; extraEdges?: ReturnType<typeof edge>[] } = {}): EffectDocumentV2 {
  const d = createF01Document();
  const g = d.graphs[0];
  g.nodes.push(
    node('n-line', 'LinePath', { samples: 9 }), node('n-reveal', 'RevealPath', { fraction: 0.25 }),
    node('n-drv', 'EffectTimeCurve', { curve: curve as CurveValue }, opts.enabled ?? true), node('n-rib', 'RibbonRenderer'),
    ...(opts.extra ?? []),
  );
  const [tn, tp] = opts.target ?? ['n-reveal', 'fraction'];
  g.edges.push(
    edge('e-ls', 'node-source', 'out', 'n-line', 'start'), edge('e-le', 'node-target', 'out', 'n-line', 'end'),
    edge('e-lr', 'n-line', 'paths', 'n-reveal', 'paths'),
    edge('e-drv', 'n-drv', 'value', tn, tp),
    edge('e-rp', 'n-reveal', 'paths', 'n-rib', 'paths'),
    edge('e-rm', 'node-material', 'material', 'n-rib', 'material'),
    edge('e-ro', 'n-rib', 'visual', 'node-output', 'visual', 1),
    ...(opts.extraEdges ?? []),
  );
  return d;
}
const layerPaths = (d: EffectDocumentV2, tick: number) => {
  const r = compilePathPreview(d, tick);
  if (!r.ok) assert.fail(`compile failed: ${JSON.stringify(r.errors, null, 1)}`);
  const l = r.value.layers.find(x => x.nodeId === 'n-rib');
  assert.ok(l);
  return l.paths;
};
const expected = (fraction: number) => [revealPath(linePath('p0', S, T, 9), fraction)];

test('registry: EffectTimeCurve v1 has an effectSeconds curve and a normalized scalarSignal output', () => {
  const spec = createRegistry().get('EffectTimeCurve@1');
  assert.ok(spec);
  assert.deepEqual(spec.inputs, []);
  assert.deepEqual(spec.outputs.map(p => [p.id, p.type, p.unit, p.domains]), [['value', 'scalarSignal', 'normalized', ['effectTime']]]);
  const c = spec.parameters.find(p => p.id === 'curve');
  assert.ok(c);
  assert.equal(c.curveDomain, 'effectSeconds');
  assert.equal(c.min, 0);
  assert.equal(c.max, 1);
  assert.equal(spec.disabledBehavior, 'fallback');
});

test('pure curve: linear, hold and endpoint clamp', () => {
  assert.equal(evaluateCurve(LINEAR, 0.25), 0.5);
  assert.equal(evaluateCurve(LINEAR, -1), 0);
  assert.equal(evaluateCurve(LINEAR, 9), 1);
  assert.equal(evaluateCurve(HOLD, 0.39), 0);
  assert.equal(evaluateCurve(HOLD, 0.4), 0.5);
  assert.equal(evaluateCurve(HOLD, 0.49), 0.5);
  assert.equal(evaluateCurve(HOLD, 0.5), 1);
});

test('pure curve: malformed, nonfinite and out-of-bounds values throw instead of clamping', () => {
  const b = { min: 0, max: 1 };
  assert.throws(() => evaluateCurve({ ...LINEAR, keys: [{ x: 0, y: 1.5 }] }, 0, b), RangeError);
  assert.throws(() => evaluateCurve({ ...LINEAR, keys: [{ x: 0, y: -0.1 }] }, 0, b), RangeError);
  assert.throws(() => evaluateCurve({ ...LINEAR, keys: [{ x: 0, y: Number.NaN }] }, 0, b), RangeError);
  assert.throws(() => evaluateCurve({ ...LINEAR, keys: [{ x: 1, y: 0 }, { x: 0.5, y: 0 }] }, 0), RangeError);
  assert.throws(() => evaluateCurve({ ...LINEAR, keys: [] }, 0), RangeError);
  assert.throws(() => evaluateCurve(LINEAR, Number.POSITIVE_INFINITY), RangeError);
});

test('driven RevealPath.fraction samples the curve at effectTick/60 (ticks 24, 25, 26)', () => {
  for (const tick of [24, 25, 26]) {
    const f = evaluateCurve(LINEAR, tick / 60);
    assert.ok(Math.abs(f - (tick / 60) * 2) < 1e-12);
    assert.deepEqual(layerPaths(doc(), tick), expected(f), `tick ${tick}`);
  }
  // Hold: tick 24 is exactly x=0.4.
  assert.deepEqual(layerPaths(doc(HOLD), 23), expected(0));
  for (const tick of [24, 25, 26]) assert.deepEqual(layerPaths(doc(HOLD), tick), expected(0.5), `hold tick ${tick}`);
  assert.deepEqual(layerPaths(doc(HOLD), 30), expected(1));
});

test('compile does not mutate its input', () => {
  const d = doc();
  const before = structuredClone(d);
  layerPaths(d, 25);
  assert.deepEqual(d, before);
});

test('disabled driver falls back to the literal fraction', () => {
  assert.deepEqual(layerPaths(doc(LINEAR, { enabled: false }), 25), expected(0.25));
});

test('curve y outside [0,1] or nonfinite is an addressed error', () => {
  for (const y of [1.5, -0.5, Number.NaN]) {
    const r = compilePathPreview(doc({ ...LINEAR, keys: [{ x: 0, y }] }), 25);
    assert.equal(r.ok, false, `y=${y}`);
    if (!r.ok) assert.ok(r.errors.some(e => e.fieldPath?.includes('params.curve')), JSON.stringify(r.errors));
  }
});

test('EffectTimeCurve driving any other parameter is rejected', () => {
  const extra = [node('n-jag', 'JaggedPath')];
  const extraEdges = [edge('e-lj', 'n-line', 'paths', 'n-jag', 'paths')];
  // Remove the reveal driver path: drive a different parameter instead.
  for (const target of [['n-jag', 'amplitude'], ['n-rib', 'width'], ['n-line', 'samples']] as [string, string][]) {
    const r = compilePathPreview(doc(LINEAR, { target, extra, extraEdges }), 25);
    assert.equal(r.ok, false, target.join('.'));
  }
});

test('wrong source port into RevealPath.fraction is rejected', () => {
  const d = doc();
  const e = d.graphs[0].edges.find(x => x.id === 'e-drv');
  assert.ok(e);
  e.source.port = 'curve';
  assert.equal(compilePathPreview(d, 25).ok, false);
});
