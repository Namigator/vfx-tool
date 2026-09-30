import test from 'node:test';
import assert from 'node:assert/strict';
import type { Diagnostic, EffectDocumentV2, NodeDefinition, NodeSpec, PortSpec } from '../src/model/types.ts';
import { analyzeGraph, type AnalyzedGraph } from '../src/graph/analyze.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { createF01Document } from '../src/graph/fixtures.ts';

const registry = createRegistry();

/** Registry plus test-only nodes for signal, event and paths sources. Never production metadata. */
function testRegistry(): Map<string, NodeSpec> {
  const reg = createRegistry();
  const out = (p: Partial<PortSpec> & Pick<PortSpec, 'id' | 'type'>): PortSpec => ({ label: p.id, cardinality: 'one', required: false, ...p });
  const add = (type: string, inputs: PortSpec[], outputs: PortSpec[]) =>
    reg.set(`${type}@1`, { type, definitionVersion: 1, inputs, outputs, parameters: [], disabledBehavior: 'empty', capabilities: [] });
  add('TestMeters', [], [out({ id: 'value', type: 'scalarSignal', unit: 'meter', domains: ['constant'] })]);
  add('TestTimeRate', [], [out({ id: 'value', type: 'scalarSignal', unit: 'none', domains: ['effectTime'] })]);
  add('TestNormalized', [], [out({ id: 'value', type: 'scalarSignal', unit: 'normalized', domains: ['constant'] })]);
  add('TestRelay', [out({ id: 'in', type: 'event', cardinality: 'many' })], [out({ id: 'out', type: 'event' })]);
  add('TestPaths', [], [out({ id: 'paths', type: 'paths' })]);
  return reg;
}

const node = (id: string, type: string, params: NodeDefinition['params'] = {}, enabled = true): NodeDefinition =>
  ({ id, type, definitionVersion: 1, label: id, enabled, randomStreamId: `rs-${id}`, params });
const edge = (id: string, s: string, sp: string, t: string, tp: string, order = 0) =>
  ({ id, source: { nodeId: s, port: sp }, target: { nodeId: t, port: tp }, order });

function f01(mutate?: (d: EffectDocumentV2) => void): EffectDocumentV2 {
  const d = createF01Document();
  mutate?.(d);
  return d;
}
const root = (d: EffectDocumentV2) => d.graphs[0];
const graphOf = (a: { graphs: AnalyzedGraph[] }, id: string) => a.graphs.find(g => g.graphId === id) as AnalyzedGraph;

function errorsOf(r: ReturnType<typeof analyzeGraph>): Diagnostic[] {
  assert.equal(r.ok, false, 'expected analysis to fail');
  return r.ok ? [] : r.errors;
}
function valueOf(r: ReturnType<typeof analyzeGraph>) {
  if (!r.ok) assert.fail(`expected success, got ${JSON.stringify(r.errors, null, 1)}`);
  return r;
}

test('F01 analyzes: topological order, reachability and cloned outputs', () => {
  const input = createF01Document();
  const before = JSON.stringify(input);
  const r = valueOf(analyzeGraph(input, { registry }));
  assert.equal(JSON.stringify(input), before, 'input not mutated');
  assert.deepEqual(r.value.document, input);
  assert.notEqual(r.value.document, input);
  assert.equal(r.value.rootGraphId, 'graph-root');
  const g = graphOf(r.value, 'graph-root');
  const pos = new Map(g.nodeOrder.map((id, i) => [id, i]));
  assert.equal(g.nodeOrder.length, 8);
  for (const e of g.edges) assert.ok((pos.get(e.source.nodeId) as number) < (pos.get(e.target.nodeId) as number), e.id);
  // node-target is an unconnected Anchor: not demanded by the output.
  assert.ok(!g.reachableNodeIds.includes('node-target'));
  assert.deepEqual([...g.reachableNodeIds].sort(), ['node-billboard', 'node-emitter', 'node-initial', 'node-material', 'node-output', 'node-schedule', 'node-source']);
  assert.deepEqual(g.signatures.map(s => s.nodeId), [...g.nodeOrder].sort());
  // Parameters are the authored baseline.
  const burst = r.value.parameters.find(p => p.nodeId === 'node-emitter' && p.parameter === 'burst');
  assert.equal(burst?.value, 1);
  // Returned edges are independent copies.
  g.edges[0].order = 99;
  assert.equal(JSON.stringify(input), before);
});

test('topology and edge order are independent of storage order', () => {
  const a = valueOf(analyzeGraph(f01(), { registry }));
  const b = valueOf(analyzeGraph(f01(d => { root(d).nodes.reverse(); root(d).edges.reverse(); }), { registry }));
  assert.deepEqual(graphOf(b.value, 'graph-root').nodeOrder, graphOf(a.value, 'graph-root').nodeOrder);
  assert.deepEqual(graphOf(b.value, 'graph-root').edges, graphOf(a.value, 'graph-root').edges);
  // Ties are broken by node ID among ready nodes (node-emitter becomes ready before node-target is taken).
  assert.deepEqual(graphOf(a.value, 'graph-root').nodeOrder, [
    'node-material', 'node-schedule', 'node-source', 'node-emitter', 'node-initial', 'node-billboard', 'node-output', 'node-target',
  ]);
});

test('incompatible port types are rejected', () => {
  const r = analyzeGraph(f01(d => {
    const e = root(d).edges.find(x => x.id === 'edge-initial');
    if (e) e.source = { nodeId: 'node-material', port: 'material' };
  }), { registry });
  assert.ok(errorsOf(r).some(d => d.code === 'TYPE_MISMATCH'));
});

test('signal units, domains, constant promotion and integer targets', () => {
  const reg = testRegistry();
  const withSource = (type: string, targetNode: string, targetPort: string) => f01(d => {
    root(d).nodes.push(node('node-src', type));
    root(d).edges.push(edge('edge-src', 'node-src', 'value', targetNode, targetPort));
  });
  // meter → perSecond rate: unit mismatch.
  assert.ok(errorsOf(analyzeGraph(withSource('TestMeters', 'node-emitter', 'rate'), { registry: reg })).some(d => d.code === 'TYPE_MISMATCH'));
  // effectTime source → integer constant-only burst.
  assert.ok(errorsOf(analyzeGraph(withSource('TestTimeRate', 'node-emitter', 'burst'), { registry: reg })).some(d => d.code === 'DOMAIN_MISMATCH' || d.code === 'TYPE_MISMATCH'));
  // constant normalized → Material.opacity (constant/effectTime/normalizedAge): constant promotes.
  const ok = valueOf(analyzeGraph(withSource('TestNormalized', 'node-material', 'opacity'), { registry: reg }));
  assert.ok(graphOf(ok.value, 'graph-root').reachableNodeIds.includes('node-src'), 'parameter edge driver is demanded');
});

test('a cardinality-one input with two drivers is rejected', () => {
  const r = analyzeGraph(f01(d => {
    root(d).nodes.push(node('node-material2', 'Material'));
    root(d).edges.push(edge('edge-material2', 'node-material2', 'material', 'node-billboard', 'material'));
  }), { registry });
  const e = errorsOf(r).find(d => d.code === 'MULTIPLE_DRIVERS');
  assert.equal(e?.nodeId, 'node-billboard');
});

test('multi inputs are ordered by edge order then edge ID', () => {
  const r = valueOf(analyzeGraph(f01(d => {
    root(d).nodes.push(node('node-billboard2', 'BillboardRenderer'));
    root(d).edges.push(
      edge('edge-b2-p', 'node-initial', 'particles', 'node-billboard2', 'particles'),
      edge('edge-b2-m', 'node-material', 'material', 'node-billboard2', 'material'),
      edge('edge-visual-z', 'node-billboard2', 'visual', 'node-output', 'visual', 0),
    );
    const v = root(d).edges.find(x => x.id === 'edge-visual');
    if (v) v.order = 1;
  }), { registry }));
  const ids = graphOf(r.value, 'graph-root').edges.filter(e => e.target.nodeId === 'node-output').map(e => e.id);
  assert.deepEqual(ids, ['edge-visual-z', 'edge-visual']);
});

test('disconnected cycles report the node path', () => {
  const r = analyzeGraph(f01(d => {
    root(d).nodes.push(node('node-loop-b', 'InitialProperties'), node('node-loop-a', 'InitialProperties'));
    root(d).edges.push(
      edge('edge-loop-1', 'node-loop-a', 'particles', 'node-loop-b', 'particles'),
      edge('edge-loop-2', 'node-loop-b', 'particles', 'node-loop-a', 'particles'),
    );
  }), { registry });
  const c = errorsOf(r).find(d => d.code === 'GRAPH_CYCLE');
  assert.ok(c);
  assert.match(c.message, /node-loop-a -> node-loop-b -> node-loop-a/);
  assert.equal(c.nodeId, 'node-loop-a');
});

test('event-only cycles are cycles too', () => {
  const r = analyzeGraph(f01(d => {
    root(d).nodes.push(node('node-r1', 'TestRelay'), node('node-r2', 'TestRelay'), node('node-r3', 'TestRelay'));
    root(d).edges.push(
      edge('edge-r1', 'node-r1', 'out', 'node-r2', 'in'),
      edge('edge-r2', 'node-r2', 'out', 'node-r3', 'in'),
      edge('edge-r3', 'node-r3', 'out', 'node-r1', 'in'),
    );
  }), { registry: testRegistry() });
  const c = errorsOf(r).find(d => d.code === 'GRAPH_CYCLE');
  assert.match(c?.message ?? '', /node-r1 -> node-r2 -> node-r3 -> node-r1/);
});

test('missing required inputs: error when reachable, warning when not', () => {
  const unreachable = valueOf(analyzeGraph(f01(d => { root(d).nodes.push(node('node-orphan', 'BillboardRenderer')); }), { registry }));
  assert.ok(unreachable.warnings.some(w => w.nodeId === 'node-orphan' && w.code === 'MISSING_REFERENCE'));
  const reachable = analyzeGraph(f01(d => { root(d).edges = root(d).edges.filter(e => e.id !== 'edge-initial'); }), { registry });
  assert.ok(errorsOf(reachable).some(e => e.nodeId === 'node-billboard' && e.code === 'MISSING_REFERENCE'));
});

test('disabled nodes: bypass follows its passthrough, empty stops demand, disabled producers count as present', () => {
  const bypass = valueOf(analyzeGraph(f01(d => { (root(d).nodes.find(n => n.id === 'node-initial') as NodeDefinition).enabled = false; }), { registry }));
  assert.ok(graphOf(bypass.value, 'graph-root').reachableNodeIds.includes('node-emitter'));
  const empty = valueOf(analyzeGraph(f01(d => { (root(d).nodes.find(n => n.id === 'node-emitter') as NodeDefinition).enabled = false; }), { registry }));
  const reach = graphOf(empty.value, 'graph-root').reachableNodeIds;
  assert.ok(reach.includes('node-emitter'));
  assert.ok(!reach.includes('node-schedule') && !reach.includes('node-source'));
});

test('Emitter position, trigger and window rules', () => {
  const both = analyzeGraph(f01(d => {
    root(d).nodes.push(node('node-paths', 'TestPaths'));
    root(d).edges.push(edge('edge-paths', 'node-paths', 'paths', 'node-emitter', 'paths'));
  }), { registry: testRegistry() });
  assert.ok(errorsOf(both).some(e => e.nodeId === 'node-emitter' && /both an anchor and paths/.test(e.message)));

  // useEventPosition defaults to true in production; set false for the no-source negative case.
  const none = analyzeGraph(f01(d => {
    root(d).edges = root(d).edges.filter(e => e.id !== 'edge-anchor');
    (root(d).nodes.find(n => n.id === 'node-emitter') as NodeDefinition).params.useEventPosition = false;
  }), { registry });
  assert.ok(errorsOf(none).some(e => e.nodeId === 'node-emitter' && /position source/.test(e.message)));

  // useEventPosition true with a trigger is a valid position source.
  const eventPos = valueOf(analyzeGraph(f01(d => {
    root(d).edges = root(d).edges.filter(e => e.id !== 'edge-anchor');
    (root(d).nodes.find(n => n.id === 'node-emitter') as NodeDefinition).params.useEventPosition = true;
  }), { registry }));
  assert.ok(eventPos.ok);

  // useEventPosition true without trigger, anchor or paths: still no position source.
  const noTrigger = analyzeGraph(f01(d => {
    root(d).edges = root(d).edges.filter(e => e.id !== 'edge-anchor' && e.id !== 'edge-trigger');
    (root(d).nodes.find(n => n.id === 'node-emitter') as NodeDefinition).params.useEventPosition = true;
  }), { registry });
  assert.ok(errorsOf(noTrigger).some(e => e.nodeId === 'node-emitter' && /event position but has no trigger/.test(e.message)));

  const rate = analyzeGraph(f01(d => { (root(d).nodes.find(n => n.id === 'node-emitter') as NodeDefinition).params.rate = 10; }), { registry });
  assert.ok(errorsOf(rate).some(e => e.fieldPath?.endsWith('params.rate')));

  const idle = analyzeGraph(f01(d => { root(d).edges = root(d).edges.filter(e => e.id !== 'edge-trigger'); }), { registry });
  assert.ok(errorsOf(idle).some(e => /neither a trigger nor a window/.test(e.message)));
});

test('min <= max ranges and nonzero direction: errors when reachable, warnings otherwise, deferred when driven', () => {
  const set = (id: string, params: NodeDefinition['params']) => (d: EffectDocumentV2) =>
    Object.assign((root(d).nodes.find(n => n.id === id) as NodeDefinition).params, params);
  const cases: Array<[string, NodeDefinition['params'], string]> = [
    ['node-emitter', { lifetimeMin: 2, lifetimeMax: 1 }, 'lifetimeMin'],
    ['node-emitter', { speedMin: 5, speedMax: 1 }, 'speedMin'],
    ['node-initial', { sizeMin: 1, sizeMax: 0.5 }, 'sizeMin'],
    ['node-initial', { rotationMin: 1, rotationMax: 0 }, 'rotationMin'],
    ['node-initial', { angularVelocityMin: 5, angularVelocityMax: -5 }, 'angularVelocityMin'],
    ['node-emitter', { direction: [0, 0, 0] }, 'direction'],
  ];
  for (const [id, params, field] of cases) {
    const r = analyzeGraph(f01(set(id, params)), { registry });
    assert.ok(errorsOf(r).some(e => e.nodeId === id && e.code === 'INVALID_VALUE' && e.fieldPath?.endsWith(`params.${field}`)), field);
  }
  // Equal ends are allowed.
  valueOf(analyzeGraph(f01(set('node-emitter', { speedMin: 2, speedMax: 2 })), { registry }));

  // Unreachable node: warning, not error.
  const orphan = valueOf(analyzeGraph(f01(d => { root(d).nodes.push(node('node-orphan', 'InitialProperties', { sizeMin: 1, sizeMax: 0.5 })); }), { registry }));
  assert.ok(orphan.warnings.some(w => w.nodeId === 'node-orphan' && w.fieldPath?.endsWith('params.sizeMin')));

  // Edge-driven end: stale literal inversion is not reported; the check is deferred.
  const driven = valueOf(analyzeGraph(f01(d => {
    set('node-initial', { sizeMin: 1, sizeMax: 0.5 })(d);
    root(d).nodes.push(node('node-src', 'TestMeters'));
    root(d).edges.push(edge('edge-src', 'node-src', 'value', 'node-initial', 'sizeMax'));
  }), { registry: testRegistry() }));
  assert.ok(driven.warnings.some(w => w.nodeId === 'node-initial' && /deferred/.test(w.message)));
});

test('Anchor must name a document anchor (error when reachable, warning otherwise)', () => {
  const unreach = valueOf(analyzeGraph(f01(d => { (root(d).nodes.find(n => n.id === 'node-target') as NodeDefinition).params.anchorId = 'nope'; }), { registry }));
  assert.ok(unreach.warnings.some(w => w.nodeId === 'node-target'));
  const reach = analyzeGraph(f01(d => { (root(d).nodes.find(n => n.id === 'node-source') as NodeDefinition).params.anchorId = 'nope'; }), { registry });
  assert.ok(errorsOf(reach).some(e => e.nodeId === 'node-source' && e.code === 'MISSING_REFERENCE'));
});

/** Root: Material → Group(mat) → EffectOutput.visual. Child: emitter chain → Billboard(material from GroupInput) → GroupOutput. */
function groupDoc(mutate?: (d: EffectDocumentV2) => void): EffectDocumentV2 {
  const d = createF01Document();
  const g = root(d);
  const moved = g.nodes.filter(n => !['node-material', 'node-output', 'node-target'].includes(n.id));
  g.nodes = [...g.nodes.filter(n => ['node-material', 'node-output', 'node-target'].includes(n.id)), node('node-group', 'Group', { graphId: 'graph-child' })];
  g.edges = [
    edge('edge-mat-in', 'node-material', 'material', 'node-group', 'mat'),
    edge('edge-group-out', 'node-group', 'fx', 'node-output', 'visual'),
  ];
  d.graphs.push({
    id: 'graph-child',
    inputs: [{ id: 'mat', label: 'Material', type: 'material', cardinality: 'one', required: true, direction: 'input' }],
    outputs: [{ id: 'fx', label: 'Visual', type: 'visual', cardinality: 'one', required: false, direction: 'output' }],
    nodes: [...moved, node('node-gin', 'GroupInput', { portId: 'mat' }), node('node-gout', 'GroupOutput', { portId: 'fx' })],
    edges: [
      edge('edge-trigger', 'node-schedule', 'start', 'node-emitter', 'trigger'),
      edge('edge-anchor', 'node-source', 'out', 'node-emitter', 'anchor'),
      edge('edge-emit', 'node-emitter', 'particles', 'node-initial', 'particles'),
      edge('edge-initial', 'node-initial', 'particles', 'node-billboard', 'particles'),
      edge('edge-child-mat', 'node-gin', 'out', 'node-billboard', 'material'),
      edge('edge-child-out', 'node-billboard', 'visual', 'node-gout', 'in'),
    ],
  });
  d.editor.graphs['graph-root'].nodes = { 'node-material': { x: 0, y: 0 } };
  mutate?.(d);
  return d;
}

test('Groups expose interface ports and demand flows through bridges', () => {
  const r = valueOf(analyzeGraph(groupDoc(), { registry }));
  const rootG = graphOf(r.value, 'graph-root');
  const child = graphOf(r.value, 'graph-child');
  assert.deepEqual(r.value.graphs.map(g => g.graphId), ['graph-root', 'graph-child']);
  const gsig = rootG.signatures.find(s => s.nodeId === 'node-group');
  assert.deepEqual(gsig?.inputs.map(p => p.id), ['mat']);
  assert.deepEqual(gsig?.outputs.map(p => p.id), ['fx']);
  assert.ok(rootG.reachableNodeIds.includes('node-material'), 'demanded through GroupInput');
  for (const id of ['node-gout', 'node-billboard', 'node-gin', 'node-emitter', 'node-schedule']) assert.ok(child.reachableNodeIds.includes(id), id);
});

test('a Group whose output is unused leaves its child graph unreachable', () => {
  const r = valueOf(analyzeGraph(groupDoc(d => { root(d).edges = root(d).edges.filter(e => e.id !== 'edge-group-out'); }), { registry }));
  assert.deepEqual(graphOf(r.value, 'graph-child').reachableNodeIds, []);
});

test('a disabled protected bridge is rejected', () => {
  const r = analyzeGraph(groupDoc(d => { (d.graphs[1].nodes.find(n => n.id === 'node-gout') as NodeDefinition).enabled = false; }), { registry });
  assert.ok(errorsOf(r).some(e => e.nodeId === 'node-gout'));
});

test('a demanded Group with its required interface input unconnected is rejected', () => {
  const r = analyzeGraph(groupDoc(d => { root(d).edges = root(d).edges.filter(e => e.id !== 'edge-mat-in'); }), { registry });
  assert.ok(errorsOf(r).some(e => e.nodeId === 'node-group' && e.code === 'MISSING_REFERENCE' && /"mat"/.test(e.message)));
  // Undemanded Group (output unused): same gap is only a warning.
  const idle = valueOf(analyzeGraph(groupDoc(d => { root(d).edges = []; }), { registry }));
  assert.ok(idle.warnings.some(w => w.nodeId === 'node-group' && w.code === 'MISSING_REFERENCE'));
});

test('an edge into an exposed Group control is typed and demands its source', () => {
  const withControl = (srcType: string) => groupDoc(d => {
    d.controls.push({
      id: 'ctl-fade', scopeGraphId: 'graph-child', label: 'Fade', type: 'number', unit: 'normalized',
      value: 0.5, default: 0.5, section: 'Look', description: '', editPolicy: 'live', bindings: [],
    });
    root(d).nodes.push(node('node-src', srcType));
    root(d).edges.push(edge('edge-ctl', 'node-src', 'value', 'node-group', 'ctl-fade'));
  });
  const r = valueOf(analyzeGraph(withControl('TestNormalized'), { registry: testRegistry() }));
  const rootG = graphOf(r.value, 'graph-root');
  assert.ok(rootG.signatures.find(s => s.nodeId === 'node-group')?.inputs.some(p => p.id === 'ctl-fade'));
  assert.ok(rootG.reachableNodeIds.includes('node-src'), 'exposed-control driver is demanded with the Group');
  // Unit mismatch (meter → normalized control) is rejected.
  assert.ok(errorsOf(analyzeGraph(withControl('TestMeters'), { registry: testRegistry() })).some(e => e.code === 'TYPE_MISMATCH'));
});

test('a self-loop is a cycle', () => {
  const r = analyzeGraph(f01(d => {
    root(d).nodes.push(node('node-r1', 'TestRelay'));
    root(d).edges.push(edge('edge-self', 'node-r1', 'out', 'node-r1', 'in'));
  }), { registry: testRegistry() });
  const c = errorsOf(r).find(d => d.code === 'GRAPH_CYCLE');
  assert.match(c?.message ?? '', /node-r1 -> node-r1/);
  assert.equal(c?.nodeId, 'node-r1');
});

test('a required GroupOutput interface port must be driven inside the child graph', () => {
  const required = (d: EffectDocumentV2) => { d.graphs[1].outputs[0].required = true; };
  valueOf(analyzeGraph(groupDoc(required), { registry }));
  const r = analyzeGraph(groupDoc(d => {
    required(d);
    d.graphs[1].edges = d.graphs[1].edges.filter(e => e.id !== 'edge-child-out');
  }), { registry });
  assert.ok(errorsOf(r).some(e => e.nodeId === 'node-gout' && e.code === 'MISSING_REFERENCE' && /"in"/.test(e.message)));
});

test('malformed input returns diagnostics, never throws', () => {
  for (const bad of [null, 42, 'x', {}, { format: 'vfx-studio' }, []]) {
    const r = analyzeGraph(bad, { registry });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors.length > 0);
  }
});
