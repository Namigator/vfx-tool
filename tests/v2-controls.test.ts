import test from 'node:test';
import assert from 'node:assert/strict';
import type { EffectDocumentV2, NodeSpec, ParameterSpec, PublicControl } from '../src/model/types.ts';
import { resolveParameters, type ResolvedParameter, type ResolveOptions } from '../src/model/controls.ts';
import { minimalDocument } from '../src/model/fixtures.ts';

const param = (over: Partial<ParameterSpec>): ParameterSpec => ({
  id: 'p', label: 'P', type: 'number', unit: 'none', default: 0,
  domains: ['constant'], editPolicy: 'live', description: '', ...over,
});
const nodeSpec = (type: string, parameters: ParameterSpec[]): NodeSpec => ({
  type, definitionVersion: 1, inputs: [], outputs: [], parameters, disabledBehavior: 'empty', capabilities: [],
});
const registry = new Map<string, NodeSpec>([
  ['Anchor@1', nodeSpec('Anchor', [])],
  ['EffectOutput@1', nodeSpec('EffectOutput', [])],
  ['Emitter@1', nodeSpec('Emitter', [
    param({ id: 'size', unit: 'meter', default: 1, min: 0, max: 10 }),
    param({ id: 'count', type: 'integer', default: 8, min: 1, max: 100, editPolicy: 'resample' }),
    param({ id: 'tint', type: 'color', default: { srgb: '#FFFFFF', alpha: 1 } }),
  ])],
]);

const control = (over: Partial<PublicControl>): PublicControl => ({
  id: 'size', scopeGraphId: 'graph-root', label: 'Size', type: 'number', unit: 'meter',
  value: 2, default: 2, section: 'Main', description: '', editPolicy: 'live', bindings: [], ...over,
});

/** F09: Emitter literal size 0.4; control "size"=2 bound with *.5+.1. */
function f09(bound = true): EffectDocumentV2 {
  const doc = minimalDocument();
  doc.graphs[0].nodes.push({ id: 'emit', type: 'Emitter', definitionVersion: 1, label: 'E', enabled: true, randomStreamId: 'rs-e', params: { size: 0.4 } });
  doc.controls.push(control({ bindings: bound ? [{ nodeId: 'emit', parameter: 'size', scale: 0.5, offset: 0.1 }] : [] }));
  return doc;
}

const ok = (doc: EffectDocumentV2, options?: ResolveOptions): ResolvedParameter[] => {
  const r = resolveParameters(doc, registry, options);
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.errors));
  return r.value;
};
const errs = (doc: EffectDocumentV2, options?: ResolveOptions) => {
  const r = resolveParameters(doc, registry, options);
  assert.equal(r.ok, false);
  return r.ok ? [] : r.errors.map(e => `${e.code}@${e.fieldPath}`);
};
const pick = (rs: ResolvedParameter[], nodeId: string, parameter: string) => {
  const r = rs.find(x => x.nodeId === nodeId && x.parameter === parameter);
  assert.ok(r, `${nodeId}.${parameter} missing`);
  return r;
};

test('F09 precedence: binding, connection, disconnect, unbind', () => {
  const doc = f09();
  const bound = pick(ok(doc), 'emit', 'size');
  assert.equal(bound.value, 1.1);
  assert.deepEqual(bound.source, { kind: 'control', controlId: 'size' });
  assert.equal(bound.readOnly, true);

  const connected = pick(ok(doc, { connections: [{ nodeId: 'emit', parameter: 'size', value: 3 }] }), 'emit', 'size');
  assert.equal(connected.value, 3);
  assert.deepEqual(connected.source, { kind: 'connection' });
  assert.equal(connected.readOnly, true);

  assert.equal(pick(ok(doc), 'emit', 'size').value, 1.1);

  const unbound = pick(ok(f09(false)), 'emit', 'size');
  assert.equal(unbound.value, 0.4);
  assert.deepEqual(unbound.source, { kind: 'literal' });
  assert.equal(unbound.readOnly, false);
  assert.equal(doc.graphs[0].nodes[3].params.size, 0.4);
  assert.equal(doc.controls[0].value, 2);
});

test('defaults, deterministic order and control overrides', () => {
  const rs = ok(f09());
  const count = pick(rs, 'emit', 'count');
  assert.equal(count.value, 8);
  assert.deepEqual(count.source, { kind: 'default' });
  assert.deepEqual(rs.map(r => `${r.nodeId}.${r.parameter}`), ['emit.count', 'emit.size', 'emit.tint']);
  const over = ok(f09(), { controlOverrides: new Map([['size', 4]]) });
  assert.equal(pick(over, 'emit', 'size').value, 2.1);
});

test('duplicate owners fail even when a connection masks them', () => {
  const doc = f09();
  doc.controls.push(control({ id: 'size2', bindings: [{ nodeId: 'emit', parameter: 'size' }] }));
  assert.ok(errs(doc).includes('MULTIPLE_DRIVERS@controls[1].bindings[0]'));
  assert.ok(errs(doc, { connections: [{ nodeId: 'emit', parameter: 'size', value: 3 }] }).includes('MULTIPLE_DRIVERS@controls[1].bindings[0]'));
});

test('duplicate connections fail', () => {
  const c = { nodeId: 'emit', parameter: 'size', value: 3 };
  assert.deepEqual(errs(f09(), { connections: [c, { ...c }] }), ['MULTIPLE_DRIVERS@options.connections[1]']);
});

test('invalid affine, ranges, units and types', () => {
  const bind = (b: object, over: Partial<PublicControl> = {}) => {
    const doc = f09(false);
    doc.controls[0] = control({ ...over, bindings: [{ nodeId: 'emit', parameter: 'size', ...b }] });
    return errs(doc);
  };
  assert.ok(bind({ scale: Infinity }).includes('INVALID_VALUE@controls[0].bindings[0].scale'));
  assert.ok(bind({ offset: Number.NaN }).includes('INVALID_VALUE@controls[0].bindings[0].offset'));
  assert.deepEqual(bind({ scale: 10 }), ['INVALID_VALUE@graphs[0].nodes[3].params.size']); // 20 > max 10, not clamped
  assert.deepEqual(bind({}, { unit: 'second' }), ['TYPE_MISMATCH@controls[0].bindings[0]']);
  assert.deepEqual(bind({}, { type: 'boolean', value: true, default: true }), ['TYPE_MISMATCH@controls[0].bindings[0]', 'TYPE_MISMATCH@graphs[0].nodes[3].params.size']);
  // Integer target requires an integer affine result.
  const doc = f09(false);
  doc.controls[0] = control({ unit: 'none', value: 3, bindings: [{ nodeId: 'emit', parameter: 'count', scale: 0.5 }] });
  assert.deepEqual(errs(doc), ['INVALID_VALUE@graphs[0].nodes[3].params.count']);
  doc.controls[0].bindings[0].scale = 2;
  assert.equal(pick(ok(doc), 'emit', 'count').value, 6);
  // Bad connection value is reported at the connection.
  assert.deepEqual(errs(f09(), { connections: [{ nodeId: 'emit', parameter: 'size', value: -1 }] }), ['INVALID_VALUE@options.connections[0]']);
});

test('nonnumeric controls require identity mapping and exact types', () => {
  const tint = { srgb: '#FF0000', alpha: 0.5 };
  const doc = f09(false);
  doc.controls[0] = control({ id: 'tint', type: 'color', unit: 'none', value: tint, default: tint, bindings: [{ nodeId: 'emit', parameter: 'tint' }] });
  assert.deepEqual(pick(ok(doc), 'emit', 'tint').value, tint);
  doc.controls[0].bindings[0].scale = 1;
  assert.deepEqual(errs(doc), ['INVALID_VALUE@controls[0].bindings[0].scale']);
});

test('results do not alias document, default or control values', () => {
  const tint = { srgb: '#FF0000', alpha: 0.5 };
  const doc = f09(false);
  doc.controls[0] = control({ id: 'tint', type: 'color', unit: 'none', value: tint, default: tint, bindings: [{ nodeId: 'emit', parameter: 'tint' }] });
  const before = JSON.stringify(doc);
  const rs = ok(doc);
  (pick(rs, 'emit', 'tint').value as { alpha: number }).alpha = 0;
  assert.equal(JSON.stringify(doc), before);
  const d = ok(f09(false));
  (pick(d, 'emit', 'tint').value as { alpha: number }).alpha = 0;
  assert.deepEqual(registry.get('Emitter@1')?.parameters[2].default, { srgb: '#FFFFFF', alpha: 1 });
});

/** Root → Group g1 (graph-a) → Group g2 (graph-b) → Emitter inner. Controls chain down. */
function nested(): EffectDocumentV2 {
  const doc = minimalDocument();
  const node = (id: string, type: string, params: Record<string, string | number>) =>
    ({ id, type, definitionVersion: 1, label: id, enabled: true, randomStreamId: `rs-${id}`, params });
  doc.graphs[0].nodes.push(node('g1', 'Group', { graphId: 'graph-a' }));
  doc.graphs.push({ id: 'graph-a', inputs: [], outputs: [], nodes: [node('g2', 'Group', { graphId: 'graph-b' })], edges: [] });
  doc.graphs.push({ id: 'graph-b', inputs: [], outputs: [], nodes: [node('inner', 'Emitter', { size: 0.4 })], edges: [] });
  doc.controls.push(
    control({ id: 'rootSize', value: 2, bindings: [{ nodeId: 'g1', parameter: 'aSize', scale: 2 }] }),
    control({ id: 'aSize', scopeGraphId: 'graph-a', value: 1, bindings: [{ nodeId: 'g2', parameter: 'bSize', offset: 1 }] }),
    control({ id: 'bSize', scopeGraphId: 'graph-b', value: 0.5, bindings: [{ nodeId: 'inner', parameter: 'size' }] }),
  );
  return doc;
}

test('nested Group overrides flow parent → group → internal', () => {
  const rs = ok(nested());
  assert.equal(pick(rs, 'g1', 'aSize').value, 4);
  assert.deepEqual(pick(rs, 'g1', 'aSize').source, { kind: 'control', controlId: 'rootSize' });
  assert.equal(pick(rs, 'g2', 'bSize').value, 5);
  assert.equal(pick(rs, 'inner', 'size').value, 5);
  assert.ok(!rs.some(r => r.parameter === 'graphId'));
  // Parent binding beats explicit override; override beats stored child value.
  const doc = nested();
  doc.controls[0].bindings = [];
  const over = ok(doc, { controlOverrides: new Map([['aSize', 3]]) });
  assert.deepEqual(pick(over, 'g1', 'aSize').source, { kind: 'controlOverride', controlId: 'aSize' });
  assert.equal(pick(over, 'inner', 'size').value, 4);
  const stored = ok(doc);
  assert.deepEqual(pick(stored, 'g1', 'aSize').source, { kind: 'literal', controlId: 'aSize' });
  assert.equal(pick(stored, 'inner', 'size').value, 2);
  assert.equal(pick(ok(nested(), { controlOverrides: new Map([['aSize', 3]]) }), 'inner', 'size').value, 5);
  // A connection into the Group port beats all.
  assert.equal(pick(ok(nested(), { connections: [{ nodeId: 'g2', parameter: 'bSize', value: 7 }] }), 'inner', 'size').value, 7);
});

test('scope violations and reserved graphId', () => {
  const doc = nested();
  doc.controls[0].bindings = [{ nodeId: 'inner', parameter: 'size' }];
  assert.ok(errs(doc).includes('INVALID_VALUE@controls[0].bindings[0].nodeId'));
  const r = nested();
  r.controls[0].bindings = [{ nodeId: 'g1', parameter: 'graphId' }];
  assert.ok(errs(r).includes('INVALID_VALUE@controls[0].bindings[0].parameter'));
  const c = nested();
  c.controls.push(control({ id: 'graphId', scopeGraphId: 'graph-b' }));
  assert.ok(errs(c).includes('INVALID_VALUE@controls[3].id'));
});

const portParam = param({ id: 'portId', type: 'string', unit: 'none', default: '' });
const portRegistry = new Map<string, NodeSpec>([
  ...registry,
  ['GroupInput@1', nodeSpec('GroupInput', [portParam])],
  ['GroupOutput@1', nodeSpec('GroupOutput', [portParam])],
  ['PortTagger@1', nodeSpec('PortTagger', [portParam])],
]);
/** Root with a GroupInput, GroupOutput and ordinary node that all carry a literal portId. */
function ports(): EffectDocumentV2 {
  const doc = minimalDocument();
  const node = (id: string, type: string) =>
    ({ id, type, definitionVersion: 1, label: id, enabled: true, randomStreamId: `rs-${id}`, params: { portId: `lit-${id}` } });
  doc.graphs[0].nodes.push(node('gin', 'GroupInput'), node('gout', 'GroupOutput'), node('tag', 'PortTagger'));
  doc.controls.push(control({ id: 'port', type: 'string', unit: 'none', value: 'driven', default: 'driven' }));
  return doc;
}
const portErrs = (doc: EffectDocumentV2, options?: ResolveOptions) => {
  const r = resolveParameters(doc, portRegistry, options);
  assert.equal(r.ok, false);
  return r.ok ? [] : r.errors.map(e => `${e.code}@${e.fieldPath}`);
};

test('GroupInput/GroupOutput portId is structural: literal only, no bindings or connections', () => {
  const plain = resolveParameters(ports(), portRegistry);
  assert.ok(plain.ok, plain.ok ? '' : JSON.stringify(plain.errors));
  for (const id of ['gin', 'gout']) {
    const p = pick(plain.value, id, 'portId');
    assert.equal(p.value, `lit-${id}`);
    assert.deepEqual(p.source, { kind: 'literal' });
    assert.equal(p.readOnly, false);

    const bound = ports();
    bound.controls[0].bindings = [{ nodeId: id, parameter: 'portId' }];
    assert.deepEqual(portErrs(bound), ['INVALID_VALUE@controls[0].bindings[0].parameter']);

    assert.deepEqual(portErrs(ports(), { connections: [{ nodeId: id, parameter: 'portId', value: 'x' }] }),
      ['INVALID_VALUE@options.connections[0].parameter']);
  }
  // Group graphId connections are rejected the same way.
  assert.ok(errs(nested(), { connections: [{ nodeId: 'g1', parameter: 'graphId', value: 'graph-b' }] })
    .includes('INVALID_VALUE@options.connections[0].parameter'));
});

test('ordinary node portId may be bound or connected', () => {
  const bound = ports();
  bound.controls[0].bindings = [{ nodeId: 'tag', parameter: 'portId' }];
  const b = resolveParameters(bound, portRegistry);
  assert.ok(b.ok, b.ok ? '' : JSON.stringify(b.errors));
  assert.equal(pick(b.value, 'tag', 'portId').value, 'driven');
  assert.deepEqual(pick(b.value, 'tag', 'portId').source, { kind: 'control', controlId: 'port' });
  const c = resolveParameters(ports(), portRegistry, { connections: [{ nodeId: 'tag', parameter: 'portId', value: 'wired' }] });
  assert.ok(c.ok, c.ok ? '' : JSON.stringify(c.errors));
  assert.equal(pick(c.value, 'tag', 'portId').value, 'wired');
  assert.deepEqual(pick(c.value, 'tag', 'portId').source, { kind: 'connection' });
});

test('group instances must be independent; recursion rejected', () => {
  const doc = nested();
  doc.graphs[0].nodes.push({ id: 'g1b', type: 'Group', definitionVersion: 1, label: 'x', enabled: true, randomStreamId: 'rs-x', params: { graphId: 'graph-a' } });
  assert.ok(errs(doc).includes('INVALID_VALUE@graphs[0].nodes[4].params.graphId'));
  const rec = nested();
  rec.graphs[2].nodes.push({ id: 'loop', type: 'Group', definitionVersion: 1, label: 'x', enabled: true, randomStreamId: 'rs-l', params: { graphId: 'graph-a' } });
  assert.ok(errs(rec).includes('GROUP_RECURSION@graphs[2].nodes[1].params.graphId'));
});

test('missing references are diagnosed', () => {
  const a = f09(); a.controls[0].bindings[0].nodeId = 'nope';
  assert.deepEqual(errs(a), ['MISSING_REFERENCE@controls[0].bindings[0].nodeId']);
  const b = f09(); b.controls[0].bindings[0].parameter = 'nope';
  assert.deepEqual(errs(b), ['MISSING_REFERENCE@controls[0].bindings[0].parameter']);
  const c = f09(); c.controls[0].scopeGraphId = 'nope';
  assert.ok(errs(c).includes('MISSING_REFERENCE@controls[0].scopeGraphId'));
  const d = nested(); d.graphs[0].nodes[3].params.graphId = 'nope';
  assert.ok(errs(d).includes('MISSING_REFERENCE@graphs[0].nodes[3].params.graphId'));
  const e = f09(); e.graphs[0].nodes[3].type = 'Mystery';
  assert.ok(errs(e).includes('UNKNOWN_NODE@graphs[0].nodes[3]'));
  assert.deepEqual(errs(f09(), { connections: [{ nodeId: 'x', parameter: 'size', value: 1 }] }), ['MISSING_REFERENCE@options.connections[0].nodeId']);
  assert.deepEqual(errs(f09(), { controlOverrides: new Map([['x', 1]]) }), ['MISSING_REFERENCE@options.controlOverrides.x']);
});

test('resample policy propagates to driving controls without mutating metadata', () => {
  const doc = nested();
  doc.controls[2].unit = 'none';
  doc.controls[2].value = 2;
  doc.controls[2].bindings = [{ nodeId: 'inner', parameter: 'count' }];
  for (const c of doc.controls) c.unit = 'none';
  doc.controls[1].bindings[0].offset = 0; doc.controls[1].value = 1;
  const rs = ok(doc);
  assert.equal(pick(rs, 'inner', 'count').editPolicy, 'resample');
  assert.equal(pick(rs, 'g2', 'bSize').editPolicy, 'resample');
  assert.equal(pick(rs, 'g1', 'aSize').editPolicy, 'resample');
  assert.equal(pick(rs, 'inner', 'size').editPolicy, 'live');
  assert.ok(doc.controls.every(c => c.editPolicy === 'live'));
  assert.equal(registry.get('Emitter@1')?.parameters[0].editPolicy, 'live');
});
