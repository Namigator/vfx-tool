import test from 'node:test';
import assert from 'node:assert/strict';
import type { EffectDocumentV2, NodeDefinition, NodeSpec, ParameterSpec, PortSpec, PublicControl } from '../src/model/types.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { createF01Document } from '../src/graph/fixtures.ts';
import { checkPortCompatibility, resolveSignature, valueTypeToPortType, type ResolvedSignature } from '../src/graph/signature.ts';

const param = (over: Partial<ParameterSpec>): ParameterSpec => ({
  id: 'p', label: 'P', type: 'number', unit: 'none', default: 0,
  domains: ['constant'], editPolicy: 'live', description: '', ...over,
});
const port = (over: Partial<PortSpec> & Pick<PortSpec, 'id' | 'type'>): PortSpec =>
  ({ label: over.id, cardinality: 'one', required: false, ...over });
const spec = (type: string, over: Partial<NodeSpec> = {}): NodeSpec => ({
  type, definitionVersion: 1, inputs: [], outputs: [], parameters: [],
  disabledBehavior: 'empty', capabilities: [], ...over,
});
const nodeDef = (id: string, type: string, params: NodeDefinition['params'] = {}, enabled = true): NodeDefinition =>
  ({ id, type, definitionVersion: 1, label: id, enabled, randomStreamId: `rs-${id}`, params });
const control = (over: Partial<PublicControl> & Pick<PublicControl, 'id' | 'type'>): PublicControl => ({
  scopeGraphId: 'graph-child', label: over.id, unit: 'none', value: 0, default: 0,
  section: 'Main', description: '', editPolicy: 'live', bindings: [], ...over,
});

const ROOT = 'graph-root';
const reg = createRegistry();
const regSpec = (type: string) => reg.get(`${type}@1`)!;

/** Adds `node` to the root graph of a copy of F01 and resolves it. */
function resolveIn(doc: EffectDocumentV2, node: NodeDefinition, s: NodeSpec, graphId = ROOT) {
  doc.graphs.find(g => g.id === graphId)!.nodes.push(node);
  return resolveSignature(node, s, { doc, graphId });
}
const ok = (r: ReturnType<typeof resolveSignature>): ResolvedSignature => {
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.errors));
  return r.value;
};
const codes = (r: ReturnType<typeof resolveSignature>) => (r.ok ? [] : r.errors.map(e => `${e.code}@${e.fieldPath}`));

/** F01 plus Group(graph-child) whose child has a scalar input, a visual output, bridges and scoped controls. */
function groupDoc(): EffectDocumentV2 {
  const d = createF01Document();
  d.graphs[0].nodes.push(nodeDef('node-group', 'Group', { graphId: 'graph-child' }));
  d.graphs.push({
    id: 'graph-child',
    inputs: [{ id: 'strength', label: 'Strength', type: 'scalarSignal', unit: 'normalized', domains: ['constant', 'effectTime'], cardinality: 'one', required: true, direction: 'input' }],
    outputs: [{ id: 'fx', label: 'FX', type: 'visual', cardinality: 'many', required: false, direction: 'output' }],
    nodes: [
      nodeDef('node-in', 'GroupInput', { portId: 'strength' }),
      nodeDef('node-out', 'GroupOutput', { portId: 'fx' }),
    ],
    edges: [],
  });
  d.controls.push(
    control({ id: 'ctl-size', type: 'number', unit: 'meter', value: 0.5, default: 0.25 }),
    control({ id: 'ctl-mode', type: 'enum', value: 'a', default: 'a', choices: ['a', 'b'] }),
    control({ id: 'ctl-root', type: 'number', scopeGraphId: ROOT }),
  );
  return d;
}
const child = (d: EffectDocumentV2) => d.graphs.find(g => g.id === 'graph-child')!;

test('value types map to signal ports; asset stays legacy generic; non-signal values have no port', () => {
  assert.equal(valueTypeToPortType('number'), 'scalarSignal');
  assert.equal(valueTypeToPortType('integer'), 'scalarSignal');
  assert.equal(valueTypeToPortType('boolean'), 'booleanSignal');
  assert.equal(valueTypeToPortType('color'), 'colorSignal');
  assert.equal(valueTypeToPortType('vec2'), 'vec2Signal');
  assert.equal(valueTypeToPortType('vec3'), 'vec3Signal');
  assert.equal(valueTypeToPortType('quaternion'), 'quaternionSignal');
  assert.equal(valueTypeToPortType('asset'), 'asset');
  for (const t of ['enum', 'string', 'curve', 'gradient', 'registeredRecord'] as const) assert.equal(valueTypeToPortType(t), undefined, t);
});

test('port compatibility: exact type, exact units, domain subset with constant promotion', () => {
  const s = (over: Partial<PortSpec>) => port({ id: 's', type: 'scalarSignal', domains: ['constant'], ...over });
  const t = (over: Partial<PortSpec>) => port({ id: 't', type: 'scalarSignal', domains: ['effectTime'], ...over });
  const c = (a: PortSpec, b: PortSpec) => checkPortCompatibility(a, b, 'f').map(d => d.code);
  // constant promotes into a time-only target; missing unit equals none.
  assert.deepEqual(c(s({}), t({ unit: 'none' })), []);
  assert.deepEqual(c(s({ domains: ['constant', 'effectTime'] }), t({})), []);
  assert.deepEqual(c(s({ domains: ['normalizedAge'] }), t({})), ['DOMAIN_MISMATCH']);
  assert.deepEqual(c(s({ unit: 'meter' }), t({ unit: 'second' })), ['TYPE_MISMATCH']);
  assert.deepEqual(c(s({ unit: 'meter' }), t({})), ['TYPE_MISMATCH']);
  assert.deepEqual(c(s({ domains: undefined }), t({})), ['DOMAIN_MISMATCH']);
  assert.deepEqual(c(s({}), t({ domains: [] })), ['DOMAIN_MISMATCH']);
  assert.deepEqual(c(s({}), port({ id: 't', type: 'colorSignal', domains: ['constant'] })), ['TYPE_MISMATCH']);
  // Typed assets: generic asset never converts to role-specific ports.
  assert.deepEqual(c(port({ id: 'a', type: 'asset' }), port({ id: 'b', type: 'textureAsset' })), ['TYPE_MISMATCH']);
  assert.deepEqual(c(port({ id: 'a', type: 'meshAsset' }), port({ id: 'b', type: 'meshAsset' })), []);
  const d = checkPortCompatibility(s({ domains: ['pathU'] }), t({}), 'graphs[0].edges[3]');
  assert.equal(d[0].fieldPath, 'graphs[0].edges[3]');
});

test('ordinary parameters become optional typed inputs; non-signal and structural params do not', () => {
  const d = createF01Document();
  const mat = d.graphs[0].nodes.find(n => n.id === 'node-material')!;
  const sig = ok(resolveSignature(mat, regSpec('Material'), { doc: d, graphId: ROOT }));
  const byId = new Map(sig.inputs.map(p => [p.id, p]));
  assert.deepEqual(byId.get('opacity'), {
    id: 'opacity', label: 'Opacity', type: 'scalarSignal', unit: 'normalized',
    domains: ['constant', 'effectTime', 'normalizedAge'], cardinality: 'one', required: false, defaultValue: 1,
  });
  assert.equal(byId.get('tint')?.type, 'colorSignal');
  assert.equal(byId.has('template'), false);
  assert.equal(byId.has('blend'), false);
  assert.deepEqual(sig.outputs.map(p => p.id), ['material']);
  assert.equal(sig.disabledBehavior, 'fallback');

  const anchor = d.graphs[0].nodes.find(n => n.id === 'node-source')!;
  assert.equal(ok(resolveSignature(anchor, regSpec('Anchor'), { doc: d, graphId: ROOT })).inputs.length, 0);

  const withAsset = spec('Spark', { parameters: [param({ id: 'texture', type: 'asset', default: 'tex-a' })] });
  const a = ok(resolveIn(createF01Document(), nodeDef('n-spark', 'Spark'), withAsset));
  assert.equal(a.inputs[0].type, 'asset');
});

test('explicit same-ID input is kept only when metadata matches the parameter', () => {
  const p = param({ id: 'gain', unit: 'linearGain', domains: ['constant', 'effectTime'] });
  const good = spec('Gain', { parameters: [p], inputs: [port({ id: 'gain', label: 'Explicit', type: 'scalarSignal', unit: 'linearGain', domains: ['effectTime', 'constant'], required: true })] });
  const sig = ok(resolveIn(createF01Document(), nodeDef('n-g', 'Gain'), good));
  assert.equal(sig.inputs.length, 1);
  assert.equal(sig.inputs[0].label, 'Explicit');
  assert.equal(sig.inputs[0].required, true);

  for (const drift of [{ unit: 'none' as const }, { domains: ['constant' as const] }, { type: 'colorSignal' as const }]) {
    const bad = spec('Gain', { parameters: [p], inputs: [port({ id: 'gain', type: 'scalarSignal', unit: 'linearGain', domains: ['constant', 'effectTime'], ...drift })] });
    const r = resolveIn(createF01Document(), nodeDef('n-g', 'Gain'), bad);
    assert.ok(codes(r).some(c => c.startsWith('TYPE_MISMATCH@') && c.endsWith('.params.gain')), JSON.stringify(drift));
  }
});

test('Group ports: child interface plus mapped exposed child controls, no Group.params duplication', () => {
  const d = groupDoc();
  const g = d.graphs[0].nodes.find(n => n.id === 'node-group')!;
  const sig = ok(resolveSignature(g, regSpec('Group'), { doc: d, graphId: ROOT }));
  assert.deepEqual(sig.inputs.map(p => p.id), ['strength', 'ctl-size']);
  assert.deepEqual(sig.inputs[0], { id: 'strength', label: 'Strength', type: 'scalarSignal', unit: 'normalized', domains: ['constant', 'effectTime'], cardinality: 'one', required: true });
  assert.deepEqual(sig.inputs[1], { id: 'ctl-size', label: 'ctl-size', type: 'scalarSignal', unit: 'meter', domains: ['constant'], cardinality: 'one', required: false, defaultValue: 0.5 });
  assert.deepEqual(sig.outputs.map(p => [p.id, p.type, p.cardinality]), [['fx', 'visual', 'many']]);
  assert.ok(sig.outputs.every(p => !('direction' in p)));
  assert.deepEqual(sig.parameters.map(p => p.id), ['graphId']);
  assert.deepEqual(g.params, { graphId: 'graph-child' });
});

test('Group rejects collisions between interface and exposed controls, and missing graphs', () => {
  const d = groupDoc();
  d.controls.push(control({ id: 'strength', type: 'number' }));
  const g = d.graphs[0].nodes.find(n => n.id === 'node-group')!;
  assert.ok(codes(resolveSignature(g, regSpec('Group'), { doc: d, graphId: ROOT })).includes('DUPLICATE_ID@controls[3].id'));

  const m = groupDoc();
  const gm = m.graphs[0].nodes.find(n => n.id === 'node-group')!;
  gm.params.graphId = 'graph-none';
  assert.deepEqual(codes(resolveSignature(gm, regSpec('Group'), { doc: m, graphId: ROOT })), [`MISSING_REFERENCE@graphs[0].nodes[${m.graphs[0].nodes.indexOf(gm)}].params.graphId`]);
});

test('bridges copy type/unit/domains/cardinality from their interface port', () => {
  const d = groupDoc();
  const c = child(d);
  const input = ok(resolveSignature(c.nodes[0], regSpec('GroupInput'), { doc: d, graphId: 'graph-child' }));
  assert.deepEqual(input.inputs, []);
  assert.deepEqual(input.outputs, [{ id: 'out', label: 'Strength', type: 'scalarSignal', unit: 'normalized', domains: ['constant', 'effectTime'], cardinality: 'one', required: false }]);
  const output = ok(resolveSignature(c.nodes[1], regSpec('GroupOutput'), { doc: d, graphId: 'graph-child' }));
  assert.deepEqual(output.outputs, []);
  assert.deepEqual(output.inputs, [{ id: 'in', label: 'FX', type: 'visual', cardinality: 'many', required: false }]);
  assert.equal(output.disabledBehavior, 'protected');
});

test('bridges reject missing or wrong-direction references and stored disabled state', () => {
  const d = groupDoc();
  const c = child(d);
  c.nodes[0].params.portId = 'fx'; // an output, referenced by GroupInput
  c.nodes[1].params.portId = 'nope';
  assert.deepEqual(codes(resolveSignature(c.nodes[0], regSpec('GroupInput'), { doc: d, graphId: 'graph-child' })), ['MISSING_REFERENCE@graphs[1].nodes[0].params.portId']);
  assert.deepEqual(codes(resolveSignature(c.nodes[1], regSpec('GroupOutput'), { doc: d, graphId: 'graph-child' })), ['MISSING_REFERENCE@graphs[1].nodes[1].params.portId']);

  const e = groupDoc();
  child(e).nodes[0].enabled = false;
  assert.deepEqual(codes(resolveSignature(child(e).nodes[0], regSpec('GroupInput'), { doc: e, graphId: 'graph-child' })), ['INVALID_VALUE@graphs[1].nodes[0].enabled']);
  const f = createF01Document();
  const out = f.graphs[0].nodes.find(n => n.id === 'node-output')!;
  out.enabled = false;
  assert.ok(codes(resolveSignature(out, regSpec('EffectOutput'), { doc: f, graphId: ROOT })).includes('INVALID_VALUE@graphs[0].nodes[7].enabled'));
});

test('bypass mapping is validated against registered ports', () => {
  const ps = port({ id: 'particles', type: 'particles' });
  const base = { inputs: [ps], outputs: [ps], disabledBehavior: 'bypass' as const };
  const good = ok(resolveIn(createF01Document(), nodeDef('n-m', 'Mod'), spec('Mod', { ...base, bypass: { input: 'particles', output: 'particles' } })));
  assert.deepEqual(good.bypass, { input: 'particles', output: 'particles' });

  const run = (s: NodeSpec) => codes(resolveIn(createF01Document(), nodeDef('n-m', s.type), s)).map(c => c.split('@')[0]);
  assert.deepEqual(run(spec('Mod', base)), ['INVALID_VALUE']);
  assert.deepEqual(run(spec('Mod', { ...base, bypass: { input: 'nope', output: 'particles' } })), ['MISSING_REFERENCE']);
  assert.deepEqual(run(spec('Mod', { ...base, outputs: [port({ id: 'visual', type: 'visual' })], bypass: { input: 'particles', output: 'visual' } })), ['TYPE_MISMATCH']);
  const sIn = port({ id: 'v', type: 'scalarSignal', unit: 'meter', domains: ['effectTime'] });
  assert.deepEqual(run(spec('Mod', { disabledBehavior: 'bypass', inputs: [sIn], outputs: [{ ...sIn, unit: 'second' }], bypass: { input: 'v', output: 'v' } })), ['TYPE_MISMATCH']);
  assert.deepEqual(run(spec('Mod', { disabledBehavior: 'bypass', inputs: [sIn], outputs: [{ ...sIn, domains: ['constant'] }], bypass: { input: 'v', output: 'v' } })), ['DOMAIN_MISMATCH']);
  assert.deepEqual(run(spec('Mod', { ...base, disabledBehavior: 'empty', bypass: { input: 'particles', output: 'particles' } })), ['INVALID_VALUE']);
});

test('node/spec mismatch and unspecialized Constant/PublicParameter are rejected', () => {
  assert.deepEqual(codes(resolveIn(createF01Document(), nodeDef('n-c', 'Constant', { value: 1 }), spec('Constant', { outputs: [port({ id: 'value', type: 'scalarSignal', domains: ['constant'] })] }))).map(c => c.split('@')[0]), ['UNKNOWN_NODE']);
  assert.deepEqual(codes(resolveIn(createF01Document(), nodeDef('n-p', 'PublicParameter'), spec('PublicParameter'))).map(c => c.split('@')[0]), ['UNKNOWN_NODE']);
  assert.deepEqual(codes(resolveIn(createF01Document(), nodeDef('n-x', 'Other'), spec('Material'))).map(c => c.split('@')[0]), ['UNKNOWN_NODE']);
  const v2 = { ...nodeDef('n-v', 'Material'), definitionVersion: 2 };
  assert.deepEqual(codes(resolveIn(createF01Document(), v2, regSpec('Material'))).map(c => c.split('@')[0]), ['UNSUPPORTED_VERSION']);
});

test('asset parameter and Group asset control ports have no domains and accept domain-less asset outputs', () => {
  const tex = port({ id: 'tex', type: 'asset' });
  const withAsset = spec('Spark', { parameters: [param({ id: 'texture', type: 'asset', default: 'tex-a' })] });
  const a = ok(resolveIn(createF01Document(), nodeDef('n-spark', 'Spark'), withAsset));
  assert.equal('domains' in a.inputs[0], false);
  assert.deepEqual(checkPortCompatibility(tex, a.inputs[0], 'f'), []);

  const d = groupDoc();
  d.controls.push(control({ id: 'ctl-tex', type: 'asset', value: 'tex-a', default: 'tex-a' }));
  const g = d.graphs[0].nodes.find(n => n.id === 'node-group')!;
  const sig = ok(resolveSignature(g, regSpec('Group'), { doc: d, graphId: ROOT }));
  const ctl = sig.inputs.find(p => p.id === 'ctl-tex')!;
  assert.equal(ctl.type, 'asset');
  assert.equal('domains' in ctl, false);
  assert.deepEqual(checkPortCompatibility(tex, ctl, 'f'), []);
  // Static role types still never convert.
  assert.deepEqual(checkPortCompatibility(port({ id: 't', type: 'textureAsset' }), ctl, 'f').map(x => x.code), ['TYPE_MISMATCH']);
});

test('signal ports with missing or empty domains are rejected even when unconnected', () => {
  const run = (s: NodeSpec) => codes(resolveIn(createF01Document(), nodeDef('n-s', s.type), s)).map(c => c.split('@')[0]);
  assert.deepEqual(run(spec('Sig', { outputs: [port({ id: 'v', type: 'scalarSignal' })] })), ['DOMAIN_MISMATCH']);
  assert.deepEqual(run(spec('Sig', { inputs: [port({ id: 'v', type: 'scalarSignal', domains: [] })] })), ['DOMAIN_MISMATCH']);
  const r = resolveIn(createF01Document(), nodeDef('n-s', 'Sig'), spec('Sig', { parameters: [param({ id: 'gain', domains: [] })] }));
  assert.deepEqual(codes(r), [`DOMAIN_MISMATCH@graphs[0].nodes[${createF01Document().graphs[0].nodes.length}].params.gain`]);

  const d = groupDoc();
  delete child(d).inputs[0].domains;
  const g = d.graphs[0].nodes.find(n => n.id === 'node-group')!;
  assert.deepEqual(codes(resolveSignature(g, regSpec('Group'), { doc: d, graphId: ROOT })), ['DOMAIN_MISMATCH@graphs[1].inputs[0].id']);
  assert.deepEqual(codes(resolveSignature(child(d).nodes[0], regSpec('GroupInput'), { doc: d, graphId: 'graph-child' })), ['DOMAIN_MISMATCH@graphs[1].nodes[0].params.portId']);
  const e = groupDoc();
  child(e).inputs[0].domains = [];
  assert.deepEqual(codes(resolveSignature(child(e).nodes[0], regSpec('GroupInput'), { doc: e, graphId: 'graph-child' })), ['DOMAIN_MISMATCH@graphs[1].nodes[0].params.portId']);
});

test('results are clones; inputs, registry and document are not mutated', () => {
  const d = groupDoc();
  const before = structuredClone(d);
  const registry = createRegistry();
  const regBefore = structuredClone([...registry.values()]);
  const g = d.graphs[0].nodes.find(n => n.id === 'node-group')!;
  const gs = ok(resolveSignature(g, registry.get('Group@1')!, { doc: d, graphId: ROOT }));
  const mat = d.graphs[0].nodes.find(n => n.id === 'node-material')!;
  const ms = ok(resolveSignature(mat, registry.get('Material@1')!, { doc: d, graphId: ROOT }));
  const bi = ok(resolveSignature(child(d).nodes[0], registry.get('GroupInput@1')!, { doc: d, graphId: 'graph-child' }));

  gs.inputs[0].domains!.push('pathU');
  gs.inputs[1].defaultValue = 99;
  gs.parameters[0].label = 'mutated';
  ms.outputs[0].id = 'mutated';
  ms.inputs.find(p => p.id === 'tint')!.defaultValue = { srgb: '#000000', alpha: 0 };
  ms.parameters.find(p => p.id === 'tint')!.domains.push('pathU');
  bi.outputs[0].domains!.push('pathU');

  assert.deepEqual(d, before);
  assert.deepEqual([...registry.values()], regBefore);
});
