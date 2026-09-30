import test from 'node:test';
import assert from 'node:assert/strict';
import type { Diagnostic, EffectDocumentV2, NodeDefinition } from '../src/model/types.ts';
import { validateParameterValue } from '../src/model/values.ts';
import { validateDocument } from '../src/model/document.ts';
import { analyzeGraph, type AnalyzedGraph } from '../src/graph/analyze.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { createF01Document } from '../src/graph/fixtures.ts';
import { MAX_PATH_SAMPLES, MIN_PATH_SAMPLES } from '../src/runtime/paths.ts';
import { BRANCH_DEFAULTS, MAX_BRANCH_COUNT } from '../src/runtime/branches.ts';

const registry = createRegistry();
const PATH_TYPES = ['LinePath', 'BezierPath', 'JaggedPath', 'BranchPath', 'RevealPath', 'RibbonRenderer'];
const spec = (t: string) => registry.get(`${t}@1`)!;
const ports = (t: string, side: 'inputs' | 'outputs') => spec(t)[side].map(p => `${p.id}:${p.type}${p.required ? '!' : ''}`);
const def = (t: string, id: string) => spec(t).parameters.find(p => p.id === id)!;

const node = (id: string, type: string, params: NodeDefinition['params'] = {}, enabled = true): NodeDefinition =>
  ({ id, type, definitionVersion: 1, label: id, enabled, randomStreamId: `rs-${id}`, params });
const edge = (id: string, s: string, sp: string, t: string, tp: string, order = 0) =>
  ({ id, source: { nodeId: s, port: sp }, target: { nodeId: t, port: tp }, order });

/** F01 plus a Line → Jagged → Branch(trunk) → Reveal → Ribbon chain into the effect output. */
function lightning(mutate?: (d: EffectDocumentV2) => void): EffectDocumentV2 {
  const d = createF01Document();
  const g = d.graphs[0];
  g.nodes.push(
    node('n-line', 'LinePath'), node('n-jag', 'JaggedPath'), node('n-branch', 'BranchPath'),
    node('n-reveal', 'RevealPath'), node('n-ribbon', 'RibbonRenderer'), node('n-ribbon2', 'RibbonRenderer'),
  );
  g.edges.push(
    edge('e-ls', 'node-source', 'out', 'n-line', 'start'),
    edge('e-le', 'node-target', 'out', 'n-line', 'end'),
    edge('e-lj', 'n-line', 'paths', 'n-jag', 'paths'),
    edge('e-jb', 'n-jag', 'paths', 'n-branch', 'paths'),
    edge('e-br', 'n-branch', 'trunk', 'n-reveal', 'paths'),
    edge('e-rr', 'n-reveal', 'paths', 'n-ribbon', 'paths'),
    edge('e-rm', 'node-material', 'material', 'n-ribbon', 'material'),
    edge('e-rw', 'node-schedule', 'window', 'n-ribbon', 'window'),
    edge('e-ro', 'n-ribbon', 'visual', 'node-output', 'visual', 1),
    edge('e-b2', 'n-branch', 'branches', 'n-ribbon2', 'paths'),
    edge('e-m2', 'node-material', 'material', 'n-ribbon2', 'material'),
    edge('e-o2', 'n-ribbon2', 'visual', 'node-output', 'visual', 2),
  );
  mutate?.(d);
  return d;
}
const root = (d: EffectDocumentV2) => d.graphs[0];
function errorsOf(r: ReturnType<typeof analyzeGraph>): Diagnostic[] {
  assert.equal(r.ok, false, 'expected analysis to fail');
  return r.ok ? [] : r.errors;
}

test('path node signatures follow plan 25', () => {
  assert.deepEqual(ports('LinePath', 'inputs'), ['start:anchor!', 'end:anchor!']);
  assert.deepEqual(ports('BezierPath', 'inputs'), ['start:anchor!', 'end:anchor!']);
  for (const t of ['LinePath', 'BezierPath', 'JaggedPath', 'RevealPath']) assert.deepEqual(ports(t, 'outputs'), ['paths:paths'], t);
  for (const t of ['JaggedPath', 'BranchPath', 'RevealPath']) assert.deepEqual(ports(t, 'inputs'), ['paths:paths!'], t);
  assert.deepEqual(ports('BranchPath', 'outputs'), ['trunk:paths', 'branches:paths']);
  assert.deepEqual(ports('RibbonRenderer', 'inputs'), ['paths:paths!', 'material:material!', 'window:timeWindow']);
  assert.deepEqual(ports('RibbonRenderer', 'outputs'), ['visual:visual']);
  for (const t of PATH_TYPES) assert.ok(spec(t)[`inputs`].every(p => p.cardinality === 'one'), t);
});

test('defaults match the catalog and the pure runtime cores', () => {
  for (const t of PATH_TYPES) {
    for (const p of spec(t).parameters) assert.deepEqual(validateParameterValue(p.default, p, `${t}.${p.id}`), [], `${t}.${p.id}`);
  }
  assert.equal(def('LinePath', 'samples').default, 2);
  assert.equal(def('BezierPath', 'samples').default, 48);
  assert.deepEqual(def('BezierPath', 'startHandle').default, [0, 1, 0]);
  assert.deepEqual(def('BezierPath', 'endHandle').default, [0, 1, 0]);
  for (const t of ['LinePath', 'BezierPath', 'JaggedPath']) {
    assert.equal(def(t, 'samples').min, MIN_PATH_SAMPLES, t);
    assert.equal(def(t, 'samples').max, MAX_PATH_SAMPLES, t);
  }
  assert.deepEqual(['amplitude', 'regenerationHz', 'samples', 'pinned'].map(id => def('JaggedPath', id).default), [0.3, 24, 42, true]);
  assert.equal(def('JaggedPath', 'regenerationHz').max, 60);
  for (const [k, v] of Object.entries(BRANCH_DEFAULTS)) assert.deepEqual(def('BranchPath', k).default, v, `BranchPath.${k}`);
  assert.equal(def('BranchPath', 'count').max, MAX_BRANCH_COUNT);
  assert.equal(def('BranchPath', 'spread').max, Math.PI);
  assert.equal(def('RevealPath', 'fraction').default, 1);
  assert.deepEqual(def('RevealPath', 'fraction').domains, ['constant', 'effectTime']);
  assert.equal(def('RibbonRenderer', 'width').default, 0.04);
  assert.equal(def('RibbonRenderer', 'width').min, 0.001);
  assert.equal(def('RibbonRenderer', 'width').max, 10);
  assert.deepEqual(def('RibbonRenderer', 'orientation').choices, ['camera', 'parallelTransport']);
  assert.deepEqual(def('RibbonRenderer', 'uvMode').choices, ['stretch', 'tile']);
});

test('out-of-range values are rejected by parameter validation', () => {
  const bad: [string, string, unknown][] = [
    ['LinePath', 'samples', 1], ['BezierPath', 'samples', 129], ['JaggedPath', 'amplitude', -0.1],
    ['JaggedPath', 'regenerationHz', 61], ['BranchPath', 'count', 65], ['BranchPath', 'count', 1.5],
    ['BranchPath', 'countMode', 'recursive'], ['BranchPath', 'spread', 4], ['RevealPath', 'fraction', 1.01],
    ['RibbonRenderer', 'width', 0], ['RibbonRenderer', 'orientation', 'velocity'],
    ['BezierPath', 'startHandle', [0, 21, 0]],
  ];
  for (const [t, id, v] of bad) {
    assert.ok(validateParameterValue(v as never, def(t, id), `${t}.${id}`).length > 0, `${t}.${id}=${JSON.stringify(v)}`);
  }
});

test('disabled behavior: generators/renderers empty, modifiers bypass their primary path', () => {
  assert.equal(spec('LinePath').disabledBehavior, 'empty');
  assert.equal(spec('BezierPath').disabledBehavior, 'empty');
  assert.equal(spec('RibbonRenderer').disabledBehavior, 'empty');
  assert.deepEqual(spec('JaggedPath').bypass, { input: 'paths', output: 'paths' });
  assert.deepEqual(spec('RevealPath').bypass, { input: 'paths', output: 'paths' });
  assert.deepEqual(spec('BranchPath').bypass, { input: 'paths', output: 'trunk' });
  for (const t of ['JaggedPath', 'RevealPath', 'BranchPath']) assert.equal(spec(t).disabledBehavior, 'bypass');
});

test('composed lightning chain validates and analyzes with the production registry', () => {
  const d = lightning();
  const v = validateDocument(d, { registry });
  assert.ok(v.ok, JSON.stringify(v.ok ? [] : v.errors));
  const r = analyzeGraph(d, { registry });
  if (!r.ok) assert.fail(JSON.stringify(r.errors, null, 1));
  const g = r.value.graphs.find(x => x.graphId === 'graph-root') as AnalyzedGraph;
  for (const id of ['n-line', 'n-jag', 'n-branch', 'n-reveal', 'n-ribbon', 'n-ribbon2', 'node-target']) {
    assert.ok(g.reachableNodeIds.includes(id), id);
  }
});

test('secondary forks chain through another BranchPath and disabled modifiers still analyze', () => {
  const d = lightning(d => {
    const g = root(d);
    g.nodes.push(node('n-fork', 'BranchPath', { count: 4 }));
    const e = g.edges.find(x => x.id === 'e-b2')!;
    e.target = { nodeId: 'n-fork', port: 'paths' };
    g.edges.push(edge('e-f2', 'n-fork', 'branches', 'n-ribbon2', 'paths'));
    for (const n of g.nodes) if (n.id === 'n-jag' || n.id === 'n-reveal') n.enabled = false;
  });
  const r = analyzeGraph(d, { registry });
  if (!r.ok) assert.fail(JSON.stringify(r.errors, null, 1));
});

test('invalid path edges are rejected', () => {
  const cases: [string, (g: EffectDocumentV2['graphs'][0]) => void][] = [
    // anchor → paths input
    ['anchor into paths', g => { g.edges.find(e => e.id === 'e-lj')!.source = { nodeId: 'node-source', port: 'out' }; }],
    // paths → anchor input
    ['paths into anchor', g => { g.edges.find(e => e.id === 'e-ls')!.source = { nodeId: 'n-jag', port: 'paths' }; }],
    // particles → ribbon paths
    ['particles into ribbon', g => { g.edges.find(e => e.id === 'e-rr')!.source = { nodeId: 'node-initial', port: 'particles' }; }],
    // paths → billboard particles
    ['paths into billboard', g => { g.edges.find(e => e.id === 'edge-initial')!.source = { nodeId: 'n-reveal', port: 'paths' }; }],
    // event → ribbon window
    ['event into window', g => { g.edges.find(e => e.id === 'e-rw')!.source = { nodeId: 'node-schedule', port: 'start' }; }],
  ];
  for (const [name, mutate] of cases) {
    const errs = errorsOf(analyzeGraph(lightning(d => mutate(root(d))), { registry }));
    assert.ok(errs.some(e => e.code === 'TYPE_MISMATCH'), `${name}: ${JSON.stringify(errs.map(e => e.code))}`);
  }
  const unknown = errorsOf(analyzeGraph(lightning(d => { root(d).edges.find(e => e.id === 'e-br')!.source.port = 'paths'; }), { registry }));
  assert.ok(unknown.length > 0, 'BranchPath has no "paths" output');
  const twoDrivers = errorsOf(analyzeGraph(lightning(d => {
    root(d).edges.push(edge('e-dup', 'n-line', 'paths', 'n-reveal', 'paths'));
  }), { registry }));
  assert.ok(twoDrivers.some(e => e.code === 'MULTIPLE_DRIVERS'));
});

test('F01 is unchanged by the path catalog', () => {
  const r = analyzeGraph(createF01Document(), { registry });
  assert.ok(r.ok);
  for (const n of createF01Document().graphs[0].nodes) assert.ok(!PATH_TYPES.includes(n.type), n.type);
});
