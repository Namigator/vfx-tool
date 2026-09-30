import test from 'node:test';
import assert from 'node:assert/strict';
import type { EffectDocumentV2, InterfacePort, NodeDefinition, NodeSpec, PublicControl } from '../src/model/types.ts';
import { analyzeGraph, type AnalyzedGraph, type GraphAnalysis } from '../src/graph/analyze.ts';
import { expandGroups, type ExpandedGraph } from '../src/graph/expand.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { createF01Document } from '../src/graph/fixtures.ts';

// Production registry plus test-only sources/sinks (never shipped) to exercise scalar and visual fanout.
const testSpec = (type: string, s: Pick<NodeSpec, 'inputs' | 'outputs'>): NodeSpec =>
  ({ type, definitionVersion: 1, capabilities: [], parameters: [], disabledBehavior: 'empty', ...s });
const registry = createRegistry();
for (const s of [
  testSpec('TestScalar', { inputs: [], outputs: [{ id: 'out', label: 'Out', type: 'scalarSignal', unit: 'normalized', domains: ['constant'], cardinality: 'one', required: false }] }),
  testSpec('TestVisual', { inputs: [], outputs: [{ id: 'visual', label: 'Visual', type: 'visual', cardinality: 'one', required: false }] }),
  testSpec('TestSink', { inputs: [{ id: 'in', label: 'In', type: 'visual', cardinality: 'many', required: false }], outputs: [] }),
]) registry.set(`${s.type}@1`, s);

const scalarInput = (id: string, extra: Partial<InterfacePort> = {}): InterfacePort =>
  ({ id, label: id, type: 'scalarSignal', unit: 'normalized', domains: ['constant'], cardinality: 'one', required: false, direction: 'input', ...extra });
const opacityControl = (scopeGraphId: string): PublicControl => ({
  id: 'ctl-opacity', scopeGraphId, label: 'Opacity', type: 'number', unit: 'normalized',
  value: 0.5, default: 0.5, section: 'Look', description: '', editPolicy: 'live', bindings: [],
});

const node = (id: string, type: string, params: NodeDefinition['params'] = {}, enabled = true): NodeDefinition =>
  ({ id, type, definitionVersion: 1, label: id, enabled, randomStreamId: `rs-${id}`, params });
const edge = (id: string, s: string, sp: string, t: string, tp: string, order = 0) =>
  ({ id, source: { nodeId: s, port: sp }, target: { nodeId: t, port: tp }, order });
const root = (d: EffectDocumentV2) => d.graphs[0];

function analyze(d: EffectDocumentV2): GraphAnalysis {
  const r = analyzeGraph(d, { registry });
  if (!r.ok) assert.fail(`analysis failed: ${JSON.stringify(r.errors, null, 1)}`);
  return r.value;
}
function expanded(a: GraphAnalysis): ExpandedGraph {
  const r = expandGroups(a);
  if (!r.ok) assert.fail(`expansion failed: ${JSON.stringify(r.errors, null, 1)}`);
  return r.value;
}
const graphOf = (a: GraphAnalysis, id: string) => a.graphs.find(g => g.graphId === id) as AnalyzedGraph;
const into = (x: ExpandedGraph, nodeId: string, port: string) => x.connections.filter(c => c.target.nodeId === nodeId && c.target.port === port);

/** Root: Material → Group(mat) → EffectOutput.visual. Child: emitter chain → Billboard(material from GroupInput) → GroupOutput. */
function groupDoc(mutate?: (d: EffectDocumentV2) => void): EffectDocumentV2 {
  const d = createF01Document();
  const g = root(d);
  const keep = ['node-material', 'node-output', 'node-target'];
  const moved = g.nodes.filter(n => !keep.includes(n.id));
  g.nodes = [...g.nodes.filter(n => keep.includes(n.id)), node('node-group', 'Group', { graphId: 'graph-child' })];
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

/** Wraps graph-child in an outer Group: root Material → outer(mat) → [GroupInput → inner(mat)] → outer fx. */
function nestedDoc(mutate?: (d: EffectDocumentV2) => void): EffectDocumentV2 {
  const d = groupDoc();
  const g = root(d);
  g.nodes = g.nodes.map(n => (n.id === 'node-group' ? node('node-outer', 'Group', { graphId: 'graph-mid' }) : n));
  g.edges = [
    edge('edge-mat-in', 'node-material', 'material', 'node-outer', 'mat'),
    edge('edge-outer-out', 'node-outer', 'fx', 'node-output', 'visual'),
  ];
  d.graphs.splice(1, 0, {
    id: 'graph-mid',
    inputs: [{ id: 'mat', label: 'Material', type: 'material', cardinality: 'one', required: true, direction: 'input' }],
    outputs: [{ id: 'fx', label: 'Visual', type: 'visual', cardinality: 'one', required: false, direction: 'output' }],
    nodes: [node('node-mid-in', 'GroupInput', { portId: 'mat' }), node('node-group', 'Group', { graphId: 'graph-child' }), node('node-mid-out', 'GroupOutput', { portId: 'fx' })],
    edges: [
      edge('edge-mid-mat', 'node-mid-in', 'out', 'node-group', 'mat', 2),
      edge('edge-mid-out', 'node-group', 'fx', 'node-mid-out', 'in', 3),
    ],
  });
  mutate?.(d);
  return d;
}

test('flat F01 expands to the same nodes and edges', () => {
  const a = analyze(createF01Document());
  const x = expanded(a);
  const doc = createF01Document();
  assert.deepEqual(x.nodes.map(n => n.node.id), doc.graphs[0].nodes.map(n => n.id).sort());
  assert.equal(x.connections.length, doc.graphs[0].edges.length);
  for (const e of doc.graphs[0].edges) {
    const c = x.connections.find(k => k.sourceEdgeIds[0] === e.id);
    assert.deepEqual(c, { target: e.target, source: { kind: 'node', ...e.source }, orderPath: [0], sourceEdgeIds: [e.id] });
  }
  assert.equal(x.rootOutputNodeId, 'node-output');
  assert.ok(x.nodes.every(n => n.effectiveEnabled && n.groupPath.length === 0 && n.graphId === 'graph-root'));
  assert.deepEqual(x.controlDrivers, []);
});

test('nested Group: material passes through two GroupInputs, output through two GroupOutputs', () => {
  const x = expanded(analyze(nestedDoc()));
  const ids = x.nodes.map(n => n.node.id);
  for (const bridge of ['node-outer', 'node-group', 'node-gin', 'node-gout', 'node-mid-in', 'node-mid-out']) assert.ok(!ids.includes(bridge), bridge);
  assert.deepEqual(ids, [...ids].sort());
  assert.deepEqual(into(x, 'node-billboard', 'material'), [{
    target: { nodeId: 'node-billboard', port: 'material' },
    source: { kind: 'node', nodeId: 'node-material', port: 'material' },
    orderPath: [0, 2, 0], sourceEdgeIds: ['edge-child-mat', 'edge-mid-mat', 'edge-mat-in'],
  }]);
  assert.deepEqual(into(x, 'node-output', 'visual'), [{
    target: { nodeId: 'node-output', port: 'visual' },
    source: { kind: 'node', nodeId: 'node-billboard', port: 'visual' },
    orderPath: [0, 3, 0], sourceEdgeIds: ['edge-outer-out', 'edge-mid-out', 'edge-child-out'],
  }]);
  const emitter = x.nodes.find(n => n.node.id === 'node-emitter');
  assert.deepEqual(emitter?.groupPath, ['node-outer', 'node-group']);
  assert.equal(emitter?.graphId, 'graph-child');
});

test('interface default applies as a literal; optional unwired input yields empty', () => {
  const optional = (d: EffectDocumentV2) => {
    d.graphs[1].inputs[0].required = false;
    root(d).edges = root(d).edges.filter(e => e.id !== 'edge-mat-in');
  };
  // Valid authored scalar interface with a default, read by a child Material's opacity parameter port.
  const withDefault = expanded(analyze(groupDoc(d => {
    d.graphs[1].inputs.push(scalarInput('op', { defaultValue: 0.25 }));
    d.graphs[1].nodes.push(node('node-cmat', 'Material'), node('node-gin-op', 'GroupInput', { portId: 'op' }));
    d.graphs[1].edges.push(edge('edge-op', 'node-gin-op', 'out', 'node-cmat', 'opacity'));
  })));
  assert.deepEqual(into(withDefault, 'node-cmat', 'opacity').map(c => [c.source, c.sourceEdgeIds]),
    [[{ kind: 'literal', value: 0.25 }, ['edge-op']]]);
  const none = expanded(analyze(groupDoc(optional)));
  assert.deepEqual(into(none, 'node-billboard', 'material').map(c => c.source), [{ kind: 'empty' }]);
});

test('explicit empty record on a many port when an optional exposed output has no bridge', () => {
  const x = expanded(analyze(groupDoc(d => {
    Object.assign(d.graphs[1].outputs[0], { cardinality: 'many', required: false });
    d.graphs[1].nodes = d.graphs[1].nodes.filter(n => n.id !== 'node-gout');
    d.graphs[1].edges = d.graphs[1].edges.filter(e => e.id !== 'edge-child-out');
  })));
  // Lowering filters empty entries from many-input lists; expansion keeps them for provenance.
  assert.deepEqual(into(x, 'node-output', 'visual'), [{
    target: { nodeId: 'node-output', port: 'visual' }, source: { kind: 'empty' }, orderPath: [0], sourceEdgeIds: ['edge-group-out'],
  }]);
});

test('wiring into an interface input that no GroupInput reads warns with edge and Group', () => {
  const r = expandGroups(analyze(groupDoc(d => {
    d.graphs[1].inputs.push(scalarInput('op'));
    root(d).nodes.push(node('node-scalar', 'TestScalar'));
    root(d).edges.push(edge('edge-op-in', 'node-scalar', 'out', 'node-group', 'op'));
  })));
  assert.equal(r.ok, true);
  if (r.ok) {
    const w = r.warnings.filter(x => x.code === 'MISSING_REFERENCE' && x.nodeId === 'node-group');
    assert.equal(w.length, 1);
    assert.match(w[0].message, /"edge-op-in"/);
    assert.match(w[0].message, /"node-group"/);
    assert.ok(!r.value.connections.some(c => c.sourceEdgeIds.includes('edge-op-in')));
  }
});

test('multi-input ordering follows consumer order then interface wiring order and edge IDs', () => {
  const a = analyze(groupDoc(d => {
    d.graphs[1].outputs[0].cardinality = 'many';
    d.graphs[1].nodes.push(node('node-b2', 'BillboardRenderer'));
    d.graphs[1].edges.push(
      edge('edge-b2-p', 'node-initial', 'particles', 'node-b2', 'particles'),
      edge('edge-b2-m', 'node-gin', 'out', 'node-b2', 'material'),
      edge('edge-child-out-b', 'node-b2', 'visual', 'node-gout', 'in', 0),
    );
    d.graphs[1].edges.find(e => e.id === 'edge-child-out')!.order = 1;
    root(d).edges.find(e => e.id === 'edge-group-out')!.order = 1;
  }));
  const vis = into(expanded(a), 'node-output', 'visual');
  assert.deepEqual(vis.map(c => c.sourceEdgeIds), [['edge-group-out', 'edge-child-out-b'], ['edge-group-out', 'edge-child-out']]);
  assert.deepEqual(vis.map(c => c.orderPath), [[1, 0], [1, 1]]);
  // Storage order does not change the result.
  const b = analyze(groupDoc(d => {
    d.graphs[1].outputs[0].cardinality = 'many';
    d.graphs[1].nodes.push(node('node-b2', 'BillboardRenderer'));
    d.graphs[1].edges.unshift(
      edge('edge-child-out-b', 'node-b2', 'visual', 'node-gout', 'in', 0),
      edge('edge-b2-m', 'node-gin', 'out', 'node-b2', 'material'),
      edge('edge-b2-p', 'node-initial', 'particles', 'node-b2', 'particles'),
    );
    d.graphs[1].edges.find(e => e.id === 'edge-child-out')!.order = 1;
    root(d).edges.find(e => e.id === 'edge-group-out')!.order = 1;
    d.graphs.forEach(g => g.nodes.reverse());
  }));
  assert.deepEqual(into(expanded(b), 'node-output', 'visual'), vis);
});

test('a disabled Group suppresses its output and marks contained nodes disabled', () => {
  const x = expanded(analyze(nestedDoc(d => { (d.graphs[1].nodes.find(n => n.id === 'node-group') as NodeDefinition).enabled = false; })));
  assert.deepEqual(into(x, 'node-output', 'visual').map(c => [c.source, c.sourceEdgeIds]),
    [[{ kind: 'empty' }, ['edge-outer-out', 'edge-mid-out']]]);
  for (const n of x.nodes) assert.equal(n.effectiveEnabled, n.graphId !== 'graph-child', n.node.id);
  // Authored enabled flags are untouched.
  assert.ok(x.nodes.every(n => n.node.enabled));
});

test('identity, random streams and parameters are preserved; results never alias the analysis', () => {
  const a = analyze(nestedDoc());
  const before = JSON.stringify(a);
  const x = expanded(a);
  const src = a.document.graphs.flatMap(g => g.nodes).find(n => n.id === 'node-emitter') as NodeDefinition;
  const e = x.nodes.find(n => n.node.id === 'node-emitter');
  assert.deepEqual(e?.node, src);
  assert.equal(e?.node.randomStreamId, 'rs-emitter');
  assert.equal(x.parameters.find(p => p.nodeId === 'node-emitter' && p.parameter === 'burst')?.value, 1);
  assert.ok(!x.parameters.some(p => ['node-outer', 'node-group'].includes(p.nodeId)));
  e!.node.params.burst = 9;
  e!.signature.inputs.length = 0;
  x.connections[0].sourceEdgeIds.push('x');
  assert.equal(JSON.stringify(a), before);
  const y = expanded(a);
  assert.notEqual(y.nodes[0], x.nodes[0]);
  assert.equal(y.nodes.find(n => n.node.id === 'node-emitter')?.node.params.burst, 1);
});

test('unused draft nodes are kept; uninstantiated stored graphs are not', () => {
  const x = expanded(analyze(groupDoc(d => {
    d.graphs.push({ id: 'graph-stored', inputs: [], outputs: [], nodes: [node('node-stored', 'Material')], edges: [] });
  })));
  const ids = x.nodes.map(n => n.node.id);
  assert.ok(ids.includes('node-target'), 'draft node kept');
  assert.ok(!ids.includes('node-stored'));
});

test('missing and duplicate output bridges', () => {
  // Defense in depth (post-analysis edit, not a valid pipeline state): remove the required GroupOutput.
  const missing = analyze(groupDoc(d => { d.graphs[1].outputs[0].required = true; }));
  const child = missing.document.graphs[1];
  child.nodes = child.nodes.filter(n => n.id !== 'node-gout');
  child.edges = child.edges.filter(e => e.id !== 'edge-child-out');
  graphOf(missing, 'graph-child').edges = graphOf(missing, 'graph-child').edges.filter(e => e.id !== 'edge-child-out');
  const m = expandGroups(missing);
  assert.equal(m.ok, false);
  if (!m.ok) assert.ok(m.errors.some(e => e.code === 'MISSING_REFERENCE' && e.nodeId === 'node-group' && /"fx"/.test(e.message)));

  const dup = analyze(groupDoc(d => {
    d.graphs[1].nodes.push(node('node-gout2', 'GroupOutput', { portId: 'fx' }));
    d.graphs[1].edges.push(edge('edge-child-out2', 'node-billboard', 'visual', 'node-gout2', 'in'));
  }));
  const r = expandGroups(dup);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some(e => e.code === 'MULTIPLE_DRIVERS' && e.nodeId === 'node-gout2'));

  // Duplicate bridges are rejected even when nothing consumes the exposed output.
  const unconsumed = expandGroups(analyze(groupDoc(d => {
    root(d).edges = root(d).edges.filter(e => e.id !== 'edge-group-out');
    d.graphs[1].nodes.push(node('node-gout2', 'GroupOutput', { portId: 'fx' }));
    d.graphs[1].edges.push(edge('edge-child-out2', 'node-billboard', 'visual', 'node-gout2', 'in'));
  })));
  assert.equal(unconsumed.ok, false);
  if (!unconsumed.ok) assert.ok(unconsumed.errors.some(e => e.code === 'MULTIPLE_DRIVERS' && e.nodeId === 'node-gout2'));
});

test('control-driver edges into exposed Group controls become controlDrivers entries', () => {
  const doc = groupDoc(d => {
    d.controls.push(opacityControl('graph-child'));
    root(d).nodes.push(node('node-scalar', 'TestScalar'));
    root(d).edges.push(edge('edge-ctl', 'node-scalar', 'out', 'node-group', 'ctl-opacity'));
  });
  const a = analyze(doc);
  const x = expanded(a);
  assert.deepEqual(x.controlDrivers, [{ controlId: 'ctl-opacity', groupNodeId: 'node-group', sources: [{ kind: 'node', nodeId: 'node-scalar', port: 'out' }] }]);
  assert.equal(a.document.controls[0].value, 0.5);

  // Disabled Group (own flag): drivers are skipped; authored wiring stays in the document.
  const off = analyze(groupDoc(d => {
    d.controls.push(opacityControl('graph-child'));
    root(d).nodes.push(node('node-scalar', 'TestScalar'));
    root(d).edges.push(edge('edge-ctl', 'node-scalar', 'out', 'node-group', 'ctl-opacity'));
    (root(d).nodes.find(n => n.id === 'node-group') as NodeDefinition).enabled = false;
  }));
  assert.deepEqual(expanded(off).controlDrivers, []);
  assert.ok(off.document.graphs[0].edges.some(e => e.id === 'edge-ctl'));
});

test('nested Group control driver routes through the outer GroupInput; disabled ancestor skips it', () => {
  const build = (outerEnabled: boolean) => nestedDoc(d => {
    d.controls.push(opacityControl('graph-child'));
    const mid = d.graphs.find(g => g.id === 'graph-mid')!;
    mid.inputs.push(scalarInput('op'));
    mid.nodes.push(node('node-mid-op', 'GroupInput', { portId: 'op' }));
    mid.edges.push(edge('edge-mid-ctl', 'node-mid-op', 'out', 'node-group', 'ctl-opacity', 4));
    root(d).nodes.push(node('node-scalar', 'TestScalar'));
    root(d).edges.push(edge('edge-op-in', 'node-scalar', 'out', 'node-outer', 'op', 1));
    (root(d).nodes.find(n => n.id === 'node-outer') as NodeDefinition).enabled = outerEnabled;
  });
  const x = expanded(analyze(build(true)));
  assert.deepEqual(x.controlDrivers, [{ controlId: 'ctl-opacity', groupNodeId: 'node-group', sources: [{ kind: 'node', nodeId: 'node-scalar', port: 'out' }] }]);
  assert.deepEqual(expanded(analyze(build(false))).controlDrivers, []);
});

test('budget: valid fanout through a many GroupOutput exceeds the connection budget', () => {
  // 4 sources into one cardinality-many GroupOutput x 300 parent consumers = 1200 records > 1024,
  // with stored nodes and edges inside their limits.
  const doc = groupDoc(d => {
    d.graphs[1].outputs[0].cardinality = 'many';
    d.graphs[1].edges = d.graphs[1].edges.filter(e => e.id !== 'edge-child-out');
    for (let i = 0; i < 4; i++) {
      d.graphs[1].nodes.push(node(`node-vis-${i}`, 'TestVisual'));
      d.graphs[1].edges.push(edge(`edge-vis-${i}`, `node-vis-${i}`, 'visual', 'node-gout', 'in', i + 1));
    }
    for (let i = 0; i < 300; i++) {
      root(d).nodes.push(node(`node-sink-${i}`, 'TestSink'));
      root(d).edges.push(edge(`edge-sink-${i}`, 'node-group', 'fx', `node-sink-${i}`, 'in'));
    }
  });
  const f = expandGroups(analyze(doc));
  assert.equal(f.ok, false);
  if (!f.ok) assert.equal(f.errors[0].code, 'BUDGET_EXCEEDED');
});

test('budget (defense in depth, post-analysis edits): node count and injected fanout abort', () => {
  const nodesA = analyze(createF01Document());
  for (let i = 0; i < 520; i++) nodesA.document.graphs[0].nodes.push(node(`node-extra-${i}`, 'Material'));
  const n = expandGroups(nodesA);
  assert.equal(n.ok, false);
  if (!n.ok) assert.equal(n.errors[0].code, 'BUDGET_EXCEEDED');

  // 40 wires into GroupOutput x 40 consumers of the exposed output = 1600 records > 1024.
  const fan = analyze(groupDoc());
  const child = graphOf(fan, 'graph-child');
  const rootG = graphOf(fan, 'graph-root');
  for (let i = 0; i < 40; i++) {
    child.edges.push(edge(`edge-fan-in-${i}`, 'node-billboard', 'visual', 'node-gout', 'in', i));
    rootG.edges.push(edge(`edge-fan-out-${i}`, 'node-group', 'fx', 'node-output', 'visual', i));
  }
  const f = expandGroups(fan);
  assert.equal(f.ok, false);
  if (!f.ok) assert.equal(f.errors[0].code, 'BUDGET_EXCEEDED');
});

test('recursive graph references are rejected', () => {
  const a = analyze(groupDoc());
  const child = a.document.graphs[1];
  child.nodes.push(node('node-loop', 'Group', { graphId: 'graph-child' }));
  const r = expandGroups(a);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errors[0].code, 'GROUP_RECURSION');
});
