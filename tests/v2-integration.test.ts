import test from 'node:test';
import assert from 'node:assert/strict';
import { minimalDocument } from '../src/model/fixtures.ts';
import { parseDocumentJson, validateDocument } from '../src/model/document.ts';
import { resolveParameters } from '../src/model/controls.ts';
import { canonicalSemanticJson } from '../src/model/canonical.ts';
import type { NodeSpec, ParameterSpec, PublicControl } from '../src/model/types.ts';

const parameter: ParameterSpec = { id: 'size', label: 'Size', type: 'number', unit: 'meter', default: 1, min: 0, max: 10, domains: ['constant'], editPolicy: 'resample', description: '' };
const spec = (type: string, parameters: ParameterSpec[] = []): NodeSpec => ({ type, definitionVersion: 1, parameters, inputs: [], outputs: [], disabledBehavior: 'empty', capabilities: [] });
const registry = new Map(['Anchor', 'EffectOutput', 'Group', 'Emitter'].map(type => [type + '@1', spec(type, type === 'Emitter' ? [parameter] : type === 'Group' ? [{ ...parameter, id: 'graphId', type: 'string', unit: 'none', default: '', min: undefined, max: undefined }] : [])]));
function fixture() {
  const d = minimalDocument();
  d.graphs[0].nodes.push({ id: 'group', type: 'Group', definitionVersion: 1, label: 'Group', enabled: true, randomStreamId: 'stream-group', params: { graphId: 'child' } });
  d.graphs.push({ id: 'child', inputs: [], outputs: [], edges: [], nodes: [{ id: 'emitter', type: 'Emitter', definitionVersion: 1, label: 'Emitter', enabled: true, randomStreamId: 'stream-emitter', params: { size: 0.4 } }] });
  const control: PublicControl = { id: 'child-size', scopeGraphId: 'child', label: 'Size', type: 'number', unit: 'meter', value: 2, default: 2, section: 'Main', description: '', editPolicy: 'live', bindings: [{ nodeId: 'emitter', parameter: 'size', scale: 0.5, offset: 0.1 }] };
  d.controls.push(control, { ...control, id: 'parent-size', scopeGraphId: 'graph-root', bindings: [{ nodeId: 'group', parameter: 'child-size' }] });
  return d;
}

test('saved document validation composes with nested control resolution and connection removal', () => {
  const authored = fixture();
  const before = canonicalSemanticJson(authored);
  const parsed = parseDocumentJson(JSON.stringify(authored), { registry });
  assert.ok(parsed.ok, JSON.stringify(parsed));
  for (const connected of [false, true, false]) {
    const result = resolveParameters(parsed.value, registry, { connections: connected ? [{ nodeId: 'group', parameter: 'child-size', value: 6 }] : [] });
    assert.ok(result.ok, JSON.stringify(result));
    const emitter = result.value.find(p => p.nodeId === 'emitter' && p.parameter === 'size');
    assert.equal(emitter?.value, connected ? 3.1 : 1.1);
    assert.equal(emitter?.editPolicy, 'resample');
    assert.equal(emitter?.readOnly, true);
  }
  assert.equal(canonicalSemanticJson(parsed.value), before);
  parsed.value.controls[1].bindings = [];
  parsed.value.controls[0].bindings = [];
  const unbound = resolveParameters(parsed.value, registry);
  assert.ok(unbound.ok);
  assert.equal(unbound.value.find(p => p.nodeId === 'emitter')?.value, 0.4);
});

test('document validation and resolver both reject a cross-scope binding', () => {
  const d = fixture();
  d.controls[1].bindings = [{ nodeId: 'emitter', parameter: 'size' }];
  const validation = validateDocument(d, { registry });
  assert.equal(validation.ok, false);
  const resolution = resolveParameters(d, registry);
  assert.equal(resolution.ok, false);
  if (!validation.ok && !resolution.ok) {
    assert.ok(validation.errors.some(e => e.fieldPath?.startsWith('controls[1].bindings')));
    assert.ok(resolution.errors.some(e => e.fieldPath?.startsWith('controls[1].bindings')));
  }
});
