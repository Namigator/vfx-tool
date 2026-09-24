import test from 'node:test';
import assert from 'node:assert/strict';
import { UNSPECIFIED_LICENSE, type AssetReference, type EffectDocumentV2, type NodeSpec, type ParameterSpec, type PortSpec } from '../src/model/types.ts';
import { canonicalJson } from '../src/model/canonical.ts';
import { minimalDocument } from '../src/model/fixtures.ts';
import { parseDocumentJson, validateDocument, type DocumentValidationOptions } from '../src/model/document.ts';

const param = (over: Partial<ParameterSpec>): ParameterSpec => ({
  id: 'p', label: 'P', type: 'number', unit: 'none', default: 0,
  domains: ['constant'], editPolicy: 'live', description: '', ...over,
});
const port = (id: string, type: PortSpec['type'], cardinality: PortSpec['cardinality'] = 'one'): PortSpec =>
  ({ id, label: id, type, cardinality, required: false });
const node = (type: string, over: Partial<NodeSpec> = {}): NodeSpec => ({
  type, definitionVersion: 1, inputs: [], outputs: [], parameters: [],
  disabledBehavior: 'empty', capabilities: [], ...over,
});
const specs: NodeSpec[] = [
  node('Anchor', { outputs: [port('out', 'anchor')] }),
  node('EffectOutput', { inputs: [port('visual', 'visual', 'many'), port('audio', 'audio', 'many'), port('presentation', 'presentation', 'many')] }),
  node('Spark', {
    inputs: [port('anchor', 'anchor')], outputs: [port('visual', 'visual')],
    parameters: [
      param({ id: 'rate', min: 0, max: 100, default: 10 }),
      param({ id: 'texture', type: 'asset', default: 'tex-default' }),
    ],
  }),
  node('Group', { parameters: [param({ id: 'graphId', type: 'string', default: '' })] }),
  node('GroupInput', { outputs: [port('out', 'visual')], parameters: [param({ id: 'portId', type: 'string', default: '' })] }),
  node('GroupOutput', { inputs: [port('in', 'visual')], parameters: [param({ id: 'portId', type: 'string', default: '' })] }),
  // Ordinary node whose parameter happens to be named portId: not structural.
  node('Tap', { outputs: [port('out', 'visual')], parameters: [param({ id: 'portId', type: 'string', default: '' })] }),
];
const registry = new Map(specs.map(s => [`${s.type}@${s.definitionVersion}`, s]));
const opts: DocumentValidationOptions = { registry };

type AnyDoc = EffectDocumentV2 & Record<string, unknown>;
const codes = (input: unknown, o: DocumentValidationOptions = opts) => {
  const r = validateDocument(input, o);
  return r.ok ? [] : r.errors.map(d => `${d.code}@${d.fieldPath}`);
};
const expectError = (input: unknown, code: string, path: string, o?: DocumentValidationOptions) =>
  assert.ok(codes(input, o).includes(`${code}@${path}`), `expected ${code}@${path}, got ${JSON.stringify(codes(input, o))}`);

const asset = (): AssetReference => ({
  id: 'tex-a', sha256: 'a'.repeat(64), kind: 'texture', mime: 'image/png', bytes: 10,
  source: { kind: 'bundle', path: 'assets/tex-a.png' }, width: 4, height: 4, colorSpace: 'color',
  interpretation: { kind: 'texture', colorSpace: 'color' },
  provenance: { origin: 'authored', originalFilename: 'tex-a.png', modificationNotes: '' },
  license: { identifier: UNSPECIFIED_LICENSE },
});

/** Root → Group(graph-child) with an exposed child control driven by a root control. */
function groupDoc(): AnyDoc {
  const d = minimalDocument() as AnyDoc;
  d.assets.push(asset());
  d.graphs[0].nodes.push({ id: 'node-group', type: 'Group', definitionVersion: 1, label: 'G', enabled: true, randomStreamId: 'rs-g', params: { graphId: 'graph-child' } });
  d.graphs[0].edges.push({ id: 'edge-root', source: { nodeId: 'node-group', port: 'fx' }, target: { nodeId: 'node-output', port: 'visual' }, order: 0 });
  d.graphs.push({
    id: 'graph-child', inputs: [],
    outputs: [{ id: 'fx', label: 'FX', type: 'visual', cardinality: 'one', required: true, direction: 'output' }],
    nodes: [
      { id: 'node-spark', type: 'Spark', definitionVersion: 1, label: 'Spark', enabled: true, randomStreamId: 'rs-spark', params: { rate: 20, texture: 'tex-a' } },
      { id: 'node-gout', type: 'GroupOutput', definitionVersion: 1, label: 'Out', enabled: true, randomStreamId: 'rs-gout', params: { portId: 'fx' } },
    ],
    edges: [{ id: 'edge-child', source: { nodeId: 'node-spark', port: 'visual' }, target: { nodeId: 'node-gout', port: 'in' }, order: 0 }],
  });
  d.controls.push(
    { id: 'ctl-rate', scopeGraphId: 'graph-child', label: 'Rate', type: 'number', unit: 'none', value: 20, default: 10, min: 0, max: 100, section: 'Main', description: '', editPolicy: 'resample', bindings: [{ nodeId: 'node-spark', parameter: 'rate' }] },
    { id: 'ctl-power', scopeGraphId: 'graph-root', label: 'Power', type: 'number', unit: 'none', value: 1, default: 1, section: 'Main', description: '', editPolicy: 'live', bindings: [{ nodeId: 'node-group', parameter: 'ctl-rate', scale: 10, offset: 0 }] },
  );
  return d;
}

test('valid minimal and grouped documents pass without mutation or copying', () => {
  for (const d of [minimalDocument(), groupDoc()]) {
    const before = canonicalJson(d);
    const r = validateDocument(d, opts);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
    assert.equal(r.value, d);
    assert.deepEqual(r.warnings, []);
    assert.equal(canonicalJson(d), before);
  }
});

test('missing parameter keys with defaults are accepted and not materialized', () => {
  const d = groupDoc();
  d.graphs[1].nodes[0].params = {};
  const r = validateDocument(d, opts);
  assert.ok(r.ok);
  assert.deepEqual(d.graphs[1].nodes[0].params, {});
});

test('root: unknown/misspelled fields, versions, seed, duration and transform', () => {
  const extra = minimalDocument() as AnyDoc; extra.durationTick = 60;
  expectError(extra, 'INVALID_VALUE', '$');
  for (const seed of [-1, 2 ** 32, 1.5]) { const d = minimalDocument(); d.seed = seed; expectError(d, 'INVALID_VALUE', 'seed'); }
  const seedMax = minimalDocument(); seedMax.seed = 2 ** 32 - 1; assert.deepEqual(codes(seedMax), []);
  for (const t of [0, 601, 1.5]) { const d = minimalDocument(); d.durationTicks = t; expectError(d, 'INVALID_VALUE', 'durationTicks'); }
  const scale = minimalDocument(); scale.rootTransform.scale = 0; expectError(scale, 'INVALID_VALUE', 'rootTransform.scale');
  const rot = minimalDocument(); rot.rootTransform.rotation = [0, 0, 0, 0]; expectError(rot, 'INVALID_VALUE', 'rootTransform.rotation');
});

test('unsupported schema/runtime versions preserve exact raw input and never succeed', () => {
  const d = minimalDocument() as AnyDoc; d.schemaVersion = 3 as 2; d.futureField = { x: 1 };
  const r = validateDocument(d, opts);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.recoverableRaw === d);
  assert.deepEqual(codes(d), ['UNSUPPORTED_VERSION@schemaVersion']);
  const rt = minimalDocument(); rt.runtimeVersion = '9.0.0' as '2.0.0';
  expectError(rt, 'UNSUPPORTED_VERSION', 'runtimeVersion');
});

test('unrecognized or unsafe inputs return no recoverable raw', () => {
  for (const bad of [null, [], 'text', { ...minimalDocument(), format: 'other' }]) {
    const r = validateDocument(bad, opts);
    assert.ok(!r.ok && r.recoverableRaw === undefined);
  }
  // Accessors are rejected without being invoked; toJSON is never called.
  const d = minimalDocument() as AnyDoc;
  let called = false;
  Object.defineProperty(d, 'name', { enumerable: true, get() { called = true; return 'x'; } });
  const r = validateDocument(d, opts);
  assert.ok(!r.ok && r.recoverableRaw === undefined);
  assert.deepEqual(codes(d), ['INVALID_VALUE@name']);
  assert.equal(called, false);
  const tj = minimalDocument() as AnyDoc; tj.editor = { toJSON: () => { called = true; return {}; } } as never;
  assert.equal(validateDocument(tj, opts).ok, false);
  assert.equal(called, false);
});

test('depth limit reports IMPORT_LIMIT; shared object aliases are rejected', () => {
  const d = minimalDocument() as AnyDoc;
  let deep: unknown = 1; for (let i = 0; i < 40; i++) deep = [deep];
  d.graphs[0].nodes[0].params = { x: deep } as never;
  assert.ok(codes(d).every(c => c.startsWith('IMPORT_LIMIT@')) && codes(d).length === 1);
  const shared = minimalDocument();
  shared.anchors[1].position = shared.anchors[0].position;
  assert.deepEqual(codes(shared), ['INVALID_VALUE@anchors[1].position']);
  const cyc = minimalDocument() as AnyDoc; (cyc.editor as unknown as Record<string, unknown>).self = cyc;
  assert.equal(validateDocument(cyc, opts).ok, false);
});

test('unknown node types and versions are recoverable diagnostics and are kept', () => {
  const d = minimalDocument();
  d.graphs[0].nodes.push({ id: 'node-x', type: 'FutureNode', definitionVersion: 1, label: '', enabled: true, randomStreamId: 'rs-x', params: { anything: 1 } });
  d.graphs[0].nodes[0].definitionVersion = 2;
  const r = validateDocument(d, opts);
  assert.ok(!r.ok && r.recoverableRaw === d);
  assert.ok(!r.ok && r.errors.some(e => e.code === 'UNKNOWN_NODE' && e.fieldPath === 'graphs[0].nodes[3].type' && e.nodeId === 'node-x'));
  expectError(d, 'UNSUPPORTED_VERSION', 'graphs[0].nodes[0].definitionVersion');
  assert.equal(d.graphs[0].nodes.length, 4);
});

test('global ID uniqueness across object kinds and ID syntax', () => {
  const d = minimalDocument(); d.graphs[0].nodes[0].id = 'source';
  expectError(d, 'DUPLICATE_ID', 'graphs[0].nodes[0].id');
  const e = minimalDocument(); e.id = 'graph-root';
  expectError(e, 'DUPLICATE_ID', 'graphs[0].id');
  const bad = minimalDocument(); bad.graphs[0].nodes[1].randomStreamId = 'has space';
  expectError(bad, 'INVALID_VALUE', 'graphs[0].nodes[1].randomStreamId');
  const long = minimalDocument(); long.anchors[0].id = 'a'.repeat(65);
  expectError(long, 'INVALID_VALUE', 'anchors[0].id');
});

test('source/target anchors, root interface and exactly one enabled EffectOutput', () => {
  const d = minimalDocument(); d.anchors.pop();
  expectError(d, 'MISSING_REFERENCE', 'anchors');
  const two = minimalDocument();
  two.graphs[0].nodes.push({ ...two.graphs[0].nodes[2], id: 'node-output-2', randomStreamId: 'rs-o2', params: {} });
  expectError(two, 'INVALID_VALUE', 'graphs[0].nodes');
  two.graphs[0].nodes[3].enabled = false;
  assert.deepEqual(codes(two), []);
  const none = minimalDocument(); none.graphs[0].nodes[2].enabled = false;
  expectError(none, 'INVALID_VALUE', 'graphs[0].nodes');
  const iface = minimalDocument();
  iface.graphs[0].inputs.push({ id: 'in', label: 'In', type: 'event', cardinality: 'one', required: false, direction: 'input' });
  expectError(iface, 'INVALID_VALUE', 'graphs[0]');
  const missingRoot = minimalDocument(); missingRoot.rootGraphId = 'nope';
  expectError(missingRoot, 'MISSING_REFERENCE', 'rootGraphId');
});

test('edges: same-graph endpoints, registered/parameter/group ports, order', () => {
  const ok = groupDoc();
  ok.graphs[1].edges.push({ id: 'edge-rate', source: { nodeId: 'node-spark', port: 'visual' }, target: { nodeId: 'node-spark', port: 'rate' }, order: 1 });
  assert.deepEqual(codes(ok), [], 'parameter-driven input port is a valid target (cycles are WP02)');
  const cross = groupDoc();
  cross.graphs[0].edges[0].source.nodeId = 'node-spark';
  expectError(cross, 'MISSING_REFERENCE', 'graphs[0].edges[0].source.nodeId');
  const badPort = groupDoc(); badPort.graphs[0].edges[0].source.port = 'nope';
  expectError(badPort, 'MISSING_REFERENCE', 'graphs[0].edges[0].source.port');
  const toCtl = groupDoc();
  toCtl.graphs[0].edges.push({ id: 'edge-ctl', source: { nodeId: 'node-source', port: 'out' }, target: { nodeId: 'node-group', port: 'ctl-rate' }, order: 0 });
  assert.deepEqual(codes(toCtl), [], 'Group exposed control is a target port');
  const toGraphId = groupDoc();
  toGraphId.graphs[0].edges.push({ id: 'edge-gid', source: { nodeId: 'node-source', port: 'out' }, target: { nodeId: 'node-group', port: 'graphId' }, order: 0 });
  expectError(toGraphId, 'MISSING_REFERENCE', 'graphs[0].edges[1].target.port');
  const order = minimalDocument();
  order.graphs[0].edges.push({ id: 'e1', source: { nodeId: 'node-source', port: 'out' }, target: { nodeId: 'node-output', port: 'visual' }, order: -1 });
  expectError(order, 'INVALID_VALUE', 'graphs[0].edges[0].order');
});

test('node params: schema-validated, unknown keys fail, exact paths', () => {
  const d = groupDoc(); d.graphs[1].nodes[0].params.rate = 101;
  assert.deepEqual(codes(d), ['INVALID_VALUE@graphs[1].nodes[0].params.rate']);
  const r = validateDocument(d, opts);
  assert.ok(!r.ok && r.errors[0].nodeId === 'node-spark');
  const extra = groupDoc(); extra.graphs[1].nodes[0].params['rate '] = 1;
  assert.deepEqual(codes(extra), ['INVALID_VALUE@graphs[1].nodes[0].params["rate "]']);
});

test('assets: missing references and optional availability', () => {
  const d = groupDoc(); d.graphs[1].nodes[0].params.texture = 'tex-missing';
  assert.deepEqual(codes(d), ['MISSING_ASSET@graphs[1].nodes[0].params.texture']);
  const ok = groupDoc();
  assert.deepEqual(codes(ok, { registry, availableAssetIds: new Set() }), ['MISSING_ASSET@graphs[1].nodes[0].params.texture']);
  assert.deepEqual(codes(ok, { registry, availableAssetIds: new Set(['tex-a']) }), []);
});

test('asset reference metadata is strict and never resolves paths', () => {
  const mk = (f: (a: AssetReference & Record<string, unknown>) => void) => { const d = groupDoc(); f(d.assets[0] as never); return d; };
  expectError(mk(a => { a.sha256 = 'A'.repeat(64); }), 'INVALID_VALUE', 'assets[0].sha256');
  for (const path of ['../x.png', '/abs.png', 'C:/x.png', 'a\\b.png', 'a//b.png', './a.png']) {
    expectError(mk(a => { a.source = { kind: 'bundle', path }; }), 'INVALID_VALUE', 'assets[0].source.path');
  }
  expectError(mk(a => { a.interpretation.kind = 'mesh'; }), 'TYPE_MISMATCH', 'assets[0].interpretation.kind');
  expectError(mk(a => { a.interpretation.mesh = { importScale: 1 }; }), 'INVALID_VALUE', 'assets[0].interpretation.mesh');
  expectError(mk(a => { a.provenance.sourceUrl = 'x'.repeat(1025); }), 'INVALID_VALUE', 'assets[0].provenance.sourceUrl');
  expectError(mk(a => { a.checksum = 'x'; }), 'INVALID_VALUE', 'assets[0]');
  const fb = mk(a => { a.kind = 'flipbook'; a.interpretation = { kind: 'flipbook', colorSpace: 'color', flipbook: { rows: 2, columns: 2, frameCount: 5, paddingPixels: 0 } }; });
  expectError(fb, 'INVALID_VALUE', 'assets[0].interpretation.flipbook.frameCount');
  const builtin = mk(a => { a.source = { kind: 'builtin', builtinId: 'noise-01', version: 1 }; });
  assert.deepEqual(codes(builtin), []);
});

test('groups: independent instances, recursion, reserved graphId, no param literals', () => {
  const literal = groupDoc(); literal.graphs[0].nodes[3].params['ctl-rate'] = 5;
  expectError(literal, 'INVALID_VALUE', 'graphs[0].nodes[3].params["ctl-rate"]');
  const shared = groupDoc();
  shared.graphs[0].nodes.push({ id: 'node-group-2', type: 'Group', definitionVersion: 1, label: 'G2', enabled: true, randomStreamId: 'rs-g2', params: { graphId: 'graph-child' } });
  expectError(shared, 'INVALID_VALUE', 'graphs[0].nodes[4].params.graphId');
  const self = groupDoc();
  self.graphs[1].nodes.push({ id: 'node-inner', type: 'Group', definitionVersion: 1, label: 'Inner', enabled: true, randomStreamId: 'rs-i', params: { graphId: 'graph-child' } });
  expectError(self, 'GROUP_RECURSION', 'graphs[1].nodes[2].params.graphId');
  const root = groupDoc(); root.graphs[1].nodes.push({ id: 'node-inner', type: 'Group', definitionVersion: 1, label: 'Inner', enabled: true, randomStreamId: 'rs-i', params: { graphId: 'graph-root' } });
  expectError(root, 'GROUP_RECURSION', 'graphs[1].nodes[2].params.graphId');
  const missing = groupDoc(); missing.graphs[0].nodes[3].params.graphId = 'graph-nope';
  expectError(missing, 'MISSING_REFERENCE', 'graphs[0].nodes[3].params.graphId');
  const reserved = groupDoc(); reserved.controls[0].id = 'graphId'; reserved.controls[1].bindings[0].parameter = 'graphId';
  expectError(reserved, 'INVALID_VALUE', 'controls[0].id');
  expectError(reserved, 'INVALID_VALUE', 'controls[1].bindings[0].parameter');
  const bridge = groupDoc(); bridge.graphs[1].nodes[1].params.portId = 'nope';
  expectError(bridge, 'MISSING_REFERENCE', 'graphs[1].nodes[1].params.portId');
  const orphan = minimalDocument();
  orphan.graphs.push({ id: 'graph-orphan', inputs: [], outputs: [], nodes: [], edges: [] });
  const r = validateDocument(orphan, opts);
  assert.ok(r.ok && r.warnings.length === 1);
});

test('F1: graphId is a reserved control ID in every scope, including root', () => {
  const root = groupDoc(); root.controls[1].id = 'graphId';
  assert.deepEqual(codes(root), ['INVALID_VALUE@controls[1].id']);
  const child = groupDoc(); child.controls[0].id = 'graphId';
  expectError(child, 'INVALID_VALUE', 'controls[0].id');
});

test('F2: GroupInput/GroupOutput portId is structural; ordinary portId is normal', () => {
  const bind = groupDoc();
  bind.controls.push({ id: 'ctl-port', scopeGraphId: 'graph-child', label: 'P', type: 'string', unit: 'none', value: 'zzz', default: 'zzz', section: 'Main', description: '', editPolicy: 'live', bindings: [{ nodeId: 'node-gout', parameter: 'portId' }] });
  assert.deepEqual(codes(bind), ['INVALID_VALUE@controls[2].bindings[0].parameter']);
  const gin = groupDoc();
  gin.graphs[1].inputs.push({ id: 'src', label: 'Src', type: 'visual', cardinality: 'one', required: false, direction: 'input' });
  gin.graphs[1].nodes.push({ id: 'node-gin', type: 'GroupInput', definitionVersion: 1, label: 'In', enabled: true, randomStreamId: 'rs-gin', params: { portId: 'src' } });
  assert.deepEqual(codes(gin), [], 'GroupInput fixture is valid');
  gin.controls.push({ id: 'ctl-port', scopeGraphId: 'graph-child', label: 'P', type: 'string', unit: 'none', value: 'src', default: 'src', section: 'Main', description: '', editPolicy: 'live', bindings: [{ nodeId: 'node-gin', parameter: 'portId' }] });
  assert.deepEqual(codes(gin), ['INVALID_VALUE@controls[2].bindings[0].parameter']);
  const edge = groupDoc();
  edge.graphs[1].edges.push({ id: 'edge-port', source: { nodeId: 'node-spark', port: 'visual' }, target: { nodeId: 'node-gout', port: 'portId' }, order: 1 });
  assert.deepEqual(codes(edge), ['MISSING_REFERENCE@graphs[1].edges[1].target.port']);
  // Ordinary node: portId is an ordinary bindable/connectable parameter.
  const tap = groupDoc();
  tap.graphs[1].nodes.push({ id: 'node-tap', type: 'Tap', definitionVersion: 1, label: 'Tap', enabled: true, randomStreamId: 'rs-tap', params: { portId: 'anything' } });
  tap.graphs[1].edges.push({ id: 'edge-tap', source: { nodeId: 'node-spark', port: 'visual' }, target: { nodeId: 'node-tap', port: 'portId' }, order: 1 });
  tap.controls.push({ id: 'ctl-tap', scopeGraphId: 'graph-child', label: 'T', type: 'string', unit: 'none', value: 'x', default: 'x', section: 'Main', description: '', editPolicy: 'live', bindings: [{ nodeId: 'node-tap', parameter: 'portId' }] });
  assert.deepEqual(codes(tap), []);
});

test('F3: a record control default must use the authored value record type', () => {
  const records = new Map([
    ['RecA', { recordType: 'RecA', fields: [param({ id: 'x' })] }],
    ['RecB', { recordType: 'RecB', fields: [param({ id: 'x' })] }],
  ]);
  const o: DocumentValidationOptions = { registry, records };
  const mk = (def: string) => {
    const d = minimalDocument();
    d.controls.push({ id: 'ctl-rec', scopeGraphId: 'graph-root', label: 'R', type: 'registeredRecord', unit: 'none', value: { recordType: 'RecA', fields: { x: 1 } }, default: { recordType: def, fields: { x: 0 } }, section: 'Main', description: '', editPolicy: 'live', bindings: [] } as never);
    return d;
  };
  assert.deepEqual(codes(mk('RecA'), o), []);
  const bad = codes(mk('RecB'), o);
  assert.equal(bad.length, 1, JSON.stringify(bad));
  assert.ok(bad[0].startsWith('TYPE_MISMATCH@controls[0].default'), JSON.stringify(bad));
});

test('F4: Group literals and ports carry only graphId even if metadata lists more', () => {
  const extraGroup = node('Group', { parameters: [param({ id: 'graphId', type: 'string', default: '' }), param({ id: 'gain' }), param({ id: 'needed' })] });
  // A parameter without a default would otherwise be required.
  delete (extraGroup.parameters[2] as Partial<ParameterSpec>).default;
  const reg = new Map(registry); reg.set('Group@1', extraGroup);
  const o: DocumentValidationOptions = { registry: reg };
  assert.deepEqual(codes(groupDoc(), o), [], 'extra Group metadata never makes a parameter required');
  const lit = groupDoc(); lit.graphs[0].nodes[3].params.gain = 1;
  assert.deepEqual(codes(lit, o), ['INVALID_VALUE@graphs[0].nodes[3].params.gain']);
  const bind = groupDoc(); bind.controls[1].bindings[0].parameter = 'gain';
  assert.deepEqual(codes(bind, o), ['MISSING_REFERENCE@controls[1].bindings[0].parameter']);
  const edge = groupDoc();
  edge.graphs[0].edges.push({ id: 'edge-gain', source: { nodeId: 'node-source', port: 'out' }, target: { nodeId: 'node-group', port: 'gain' }, order: 0 });
  assert.deepEqual(codes(edge, o), ['MISSING_REFERENCE@graphs[0].edges[1].target.port']);
});

test('group depth above the limit is BUDGET_EXCEEDED', () => {
  const d = minimalDocument();
  let parent = d.graphs[0];
  for (let i = 1; i <= 5; i++) {
    parent.nodes.push({ id: `grp-${i}`, type: 'Group', definitionVersion: 1, label: '', enabled: true, randomStreamId: `rs-${i}`, params: { graphId: `g-${i}` } });
    const child = { id: `g-${i}`, inputs: [], outputs: [], nodes: [], edges: [] };
    d.graphs.push(child);
    parent = child;
  }
  assert.deepEqual(codes(d), ['BUDGET_EXCEEDED@graphs[4].nodes[0].params.graphId']);
});

test('controls: scope, bindings to child nodes, duplicate owners, values', () => {
  const direct = groupDoc(); direct.controls[1].bindings[0] = { nodeId: 'node-spark', parameter: 'rate' };
  expectError(direct, 'MISSING_REFERENCE', 'controls[1].bindings[0].nodeId');
  const noParam = groupDoc(); noParam.controls[0].bindings[0].parameter = 'nope';
  expectError(noParam, 'MISSING_REFERENCE', 'controls[0].bindings[0].parameter');
  const dup = groupDoc();
  dup.controls.push({ ...dup.controls[0], id: 'ctl-rate-2', bindings: [{ nodeId: 'node-spark', parameter: 'rate' }] });
  expectError(dup, 'MULTIPLE_DRIVERS', 'controls[2].bindings[0]');
  const scope = groupDoc(); scope.controls[0].scopeGraphId = 'graph-nope';
  expectError(scope, 'MISSING_REFERENCE', 'controls[0].scopeGraphId');
  const val = groupDoc(); val.controls[0].value = 500;
  expectError(val, 'INVALID_VALUE', 'controls[0].value');
  const aff = groupDoc(); (aff.controls[1].bindings[0] as Record<string, unknown>).scale = '2';
  expectError(aff, 'INVALID_VALUE', 'controls[1].bindings[0].scale');
  const range = groupDoc(); range.controls[0].min = 200;
  expectError(range, 'INVALID_VALUE', 'controls[0].min');
  const en = groupDoc(); en.controls[0].type = 'enum'; en.controls[0].value = 'a'; en.controls[0].default = 'a';
  delete en.controls[0].min; delete en.controls[0].max;
  expectError(en, 'INVALID_VALUE', 'controls[0].choices');
  en.controls[0].choices = ['a', 'b'];
  assert.deepEqual(codes(en), []);
});

test('editor layout: finite values, zoom range and references', () => {
  const zoom = minimalDocument(); zoom.editor.graphs['graph-root'].viewport.zoom = 4.01;
  expectError(zoom, 'INVALID_VALUE', 'editor.graphs["graph-root"].viewport.zoom');
  const edge = minimalDocument(); edge.editor.graphs['graph-root'].viewport.zoom = 0.1; assert.deepEqual(codes(edge), []);
  const node = minimalDocument(); node.editor.graphs['graph-root'].nodes['node-ghost'] = { x: 0, y: 0 };
  expectError(node, 'MISSING_REFERENCE', 'editor.graphs["graph-root"].nodes["node-ghost"]');
  const open = minimalDocument(); open.editor.openedGraphId = 'nope';
  expectError(open, 'MISSING_REFERENCE', 'editor.openedGraphId');
  const inf = minimalDocument(); inf.editor.graphs['graph-root'].nodes['node-source'].x = Infinity;
  assert.equal(validateDocument(inf, opts).ok, false);
});

test('stored limits and code-point text limits reject rather than truncate', () => {
  const tags = minimalDocument(); tags.tags = Array.from({ length: 33 }, (_, i) => `t${i}`);
  expectError(tags, 'IMPORT_LIMIT', 'tags');
  const label = minimalDocument(); label.name = '😀'.repeat(128); assert.deepEqual(codes(label), []);
  label.name = '😀'.repeat(129); expectError(label, 'INVALID_VALUE', 'name');
  assert.equal(label.name.length, 258);
  const many = minimalDocument();
  for (let i = 0; i < 510; i++) many.graphs[0].nodes.push({ id: `n${i}`, type: 'Anchor', definitionVersion: 1, label: '', enabled: true, randomStreamId: `r${i}`, params: {} });
  assert.deepEqual(codes(many), ['IMPORT_LIMIT@graphs']);
});

test('quoted user text in messages is bounded while fieldPath stays exact', () => {
  const d = minimalDocument();
  const huge = 'X'.repeat(100);
  d.graphs[0].nodes[0].type = huge;
  const key = 'k'.repeat(5000);
  d.graphs[0].nodes[2].params = { [key]: 1 };
  const r = validateDocument(d, opts);
  assert.ok(!r.ok);
  for (const e of r.errors) assert.ok(e.message.length < 300, e.message);
  assert.ok(r.errors.some(e => e.fieldPath === `graphs[0].nodes[2].params.${key}`));
});

test('parseDocumentJson: never throws, preflights size, recovers unknown versions', () => {
  const ok = parseDocumentJson(JSON.stringify(groupDoc()), opts);
  assert.ok(ok.ok);
  for (const bad of ['{', '', 'nul', '{"a":1}}']) {
    const r = parseDocumentJson(bad, opts);
    assert.ok(!r.ok && r.errors[0].code === 'INVALID_VALUE' && r.recoverableRaw === undefined);
  }
  const big = parseDocumentJson(' '.repeat(5 * 1024 * 1024 + 1), opts);
  assert.ok(!big.ok && big.errors[0].code === 'IMPORT_LIMIT');
  // Multi-byte text: under the code-unit limit but over the UTF-8 byte limit.
  const multi = parseDocumentJson(`"${'é'.repeat(3 * 1024 * 1024)}"`, opts);
  assert.ok(!multi.ok && multi.errors[0].code === 'IMPORT_LIMIT');
  const future = { ...minimalDocument(), schemaVersion: 3 };
  const r = parseDocumentJson(JSON.stringify(future), opts);
  assert.ok(!r.ok && r.errors[0].code === 'UNSUPPORTED_VERSION');
  assert.deepEqual(!r.ok && r.recoverableRaw, future);
  const proto = parseDocumentJson('{"__proto__":{"x":1},"format":"vfx-studio"}', opts);
  assert.equal(proto.ok, false);
  assert.equal(({} as Record<string, unknown>).x, undefined);
});
