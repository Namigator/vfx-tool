import test from 'node:test';
import assert from 'node:assert/strict';
import type { EffectDocumentV2, NodeSpec, ParameterSpec, PublicControl } from '../src/model/types.ts';
import { minimalDocument } from '../src/model/fixtures.ts';
import { inspectorValues } from '../src/editor/inspector-values.ts';

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
    param({ id: 'count', type: 'integer', default: 8, min: 1, max: 100 }),
  ])],
]);
const control = (over: Partial<PublicControl>): PublicControl => ({
  id: 'size', scopeGraphId: 'graph-root', label: 'Size', type: 'number', unit: 'meter',
  value: 2, default: 2, section: 'Main', description: '', editPolicy: 'live', bindings: [], ...over,
});
const node = (id: string, type: string, params: Record<string, string | number>) =>
  ({ id, type, definitionVersion: 1, label: id, enabled: true, randomStreamId: `rs-${id}`, params });

function mapped(): EffectDocumentV2 {
  const doc = minimalDocument();
  doc.graphs[0].nodes.push(node('emit', 'Emitter', { size: 0.4 }));
  doc.controls.push(control({ bindings: [{ nodeId: 'emit', parameter: 'size', scale: 0.5, offset: 0.1 }] }));
  return doc;
}

test('mapped public control shows the resolved value, not the stored fallback', () => {
  const v = inspectorValues(mapped(), registry, 'graph-root', 'emit');
  assert.deepEqual(v.get('size'), { kind: 'control', value: 1.1, controlLabel: 'Size' });
  assert.deepEqual(v.get('count'), { kind: 'default', value: 8 });
});

test('unresolvable control reports unavailable instead of the fallback', () => {
  const doc = mapped();
  doc.controls[0].bindings[0].scale = 10; // 20 > max 10
  const v = inspectorValues(doc, registry, 'graph-root', 'emit').get('size');
  assert.equal(v?.kind, 'unavailable');
  assert.ok(!('value' in (v as object)));
});

test('connection-driven registered parameter has no editor value; unregistered ports ignored', () => {
  const doc = mapped();
  doc.graphs[0].edges.push(
    { id: 'e1', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'emit', port: 'size' }, order: 0 },
    { id: 'e2', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'emit', port: 'notAParam' }, order: 1 },
  );
  const v = inspectorValues(doc, registry, 'graph-root', 'emit');
  assert.equal(v.get('size')?.kind, 'connection');
  assert.ok(!v.has('notAParam'));
});

test('group control override flows to the internal bound parameter', () => {
  const doc = minimalDocument();
  doc.graphs[0].nodes.push(node('g1', 'Group', { graphId: 'graph-a' }));
  doc.graphs.push({ id: 'graph-a', inputs: [], outputs: [], nodes: [node('inner', 'Emitter', { size: 0.4 })], edges: [] });
  doc.controls.push(control({ id: 'aSize', label: 'A size', scopeGraphId: 'graph-a', value: 1, bindings: [{ nodeId: 'inner', parameter: 'size' }] }));
  assert.deepEqual(inspectorValues(doc, registry, 'graph-a', 'inner').get('size'), { kind: 'control', value: 1, controlLabel: 'A size' });
  const over = inspectorValues(doc, registry, 'graph-a', 'inner', new Map([['aSize', 3]]));
  assert.deepEqual(over.get('size'), { kind: 'control', value: 3, controlLabel: 'A size' });
});
