import test from 'node:test';
import assert from 'node:assert/strict';
import type { EdgeDefinition, EffectDocumentV2, NodeSpec, PortSpec } from '../src/model/types.ts';
import { canonicalJson, canonicalSemanticJson } from '../src/model/canonical.ts';
import { minimalDocument } from '../src/model/fixtures.ts';
import { validateDocument, type DocumentValidationOptions } from '../src/model/document.ts';

const port = (id: string, type: PortSpec['type'], cardinality: PortSpec['cardinality'] = 'one'): PortSpec =>
  ({ id, label: id, type, cardinality, required: false });
const node = (type: string, over: Partial<NodeSpec> = {}): NodeSpec => ({
  type, definitionVersion: 1, inputs: [], outputs: [], parameters: [],
  disabledBehavior: 'empty', capabilities: [], ...over,
});
const specs: NodeSpec[] = [
  node('Anchor', { outputs: [port('out', 'anchor')] }),
  node('EffectOutput', { inputs: [port('visual', 'visual', 'many'), port('audio', 'audio', 'many'), port('presentation', 'presentation', 'many')] }),
  node('Tone', { outputs: [port('audio', 'audio')] }),
  node('AudioMix', { inputs: [port('inputs', 'audio', 'many')], outputs: [port('audio', 'audio')] }),
];
const opts: DocumentValidationOptions = { registry: new Map(specs.map(s => [`${s.type}@1`, s])) };

/** Two tones into an AudioMix feeding EffectOutput.audio. */
function mixDoc(): EffectDocumentV2 {
  const d = minimalDocument();
  const n = (id: string, type: string) =>
    ({ id, type, definitionVersion: 1, label: id, enabled: true, randomStreamId: `rs-${id}`, params: {} });
  d.graphs[0].nodes.push(n('node-a', 'Tone'), n('node-b', 'Tone'), n('node-mix', 'AudioMix'));
  d.graphs[0].edges.push(
    { id: 'edge-a', source: { nodeId: 'node-a', port: 'audio' }, target: { nodeId: 'node-mix', port: 'inputs' }, order: 0 },
    { id: 'edge-b', source: { nodeId: 'node-b', port: 'audio' }, target: { nodeId: 'node-mix', port: 'inputs' }, order: 1 },
    { id: 'edge-out', source: { nodeId: 'node-mix', port: 'audio' }, target: { nodeId: 'node-output', port: 'audio' }, order: 0 },
  );
  return d;
}
const edge = (d: EffectDocumentV2, id: string) => d.graphs[0].edges.find(e => e.id === id)! as EdgeDefinition & Record<string, unknown>;
const edgeIndex = (d: EffectDocumentV2, id: string) => d.graphs[0].edges.findIndex(e => e.id === id);
const codes = (d: unknown) => {
  const r = validateDocument(d, opts);
  return r.ok ? [] : r.errors.map(x => `${x.code}@${x.fieldPath}`);
};

test('mix edges validate at inclusive boundaries without mutation', () => {
  for (const mix of [{ gain: 0, pan: -1 }, { gain: 2, pan: 1 }, { gain: 1, pan: 0 }, { pan: -0, gain: 1 }]) {
    const d = mixDoc();
    edge(d, 'edge-a').mix = mix;
    const before = canonicalJson(d);
    assert.deepEqual(codes(d), [], JSON.stringify(mix));
    assert.equal(canonicalJson(d), before);
  }
});

test('invalid mix values are rejected with exact field paths', () => {
  const i = edgeIndex(mixDoc(), 'edge-a');
  const p = `graphs[0].edges[${i}].mix`;
  const cases: [unknown, string][] = [
    [{ gain: -0.01, pan: 0 }, `${p}.gain`], [{ gain: 2.01, pan: 0 }, `${p}.gain`],
    [{ gain: NaN, pan: 0 }, `${p}.gain`], [{ gain: Infinity, pan: 0 }, `${p}.gain`],
    [{ gain: '1', pan: 0 }, `${p}.gain`],
    [{ gain: 1, pan: 1.01 }, `${p}.pan`], [{ gain: 1, pan: -1.01 }, `${p}.pan`],
    [{ gain: 1, pan: 0, width: 1 }, p], [{ gain: 1 }, p], [null, p], [[1, 0], p],
  ];
  for (const [mix, path] of cases) {
    const d = mixDoc();
    edge(d, 'edge-a').mix = mix as never;
    assert.ok(codes(d).includes(`INVALID_VALUE@${path}`), `${JSON.stringify(mix)} → ${JSON.stringify(codes(d))}`);
  }
});

test('mix is rejected on edges not targeting AudioMix.inputs', () => {
  const d = mixDoc();
  edge(d, 'edge-out').mix = { gain: 1, pan: 0 };
  assert.ok(codes(d).includes(`INVALID_VALUE@graphs[0].edges[${edgeIndex(d, 'edge-out')}].mix`));
});

test('absent, default and -0 mixes hash identically; non-default values are kept in stable key order', () => {
  const base = canonicalSemanticJson(mixDoc());
  assert.ok(!base.includes('"mix"'));
  for (const mix of [{ gain: 1, pan: 0 }, { pan: 0, gain: 1 }, { gain: 1, pan: -0 }]) {
    const d = mixDoc();
    edge(d, 'edge-a').mix = mix;
    assert.equal(canonicalSemanticJson(d), base);
    assert.deepEqual(edge(d, 'edge-a').mix, mix, 'input must not be mutated');
  }
  const a = mixDoc(); edge(a, 'edge-a').mix = { pan: -0.5, gain: 1.5 };
  const b = mixDoc(); edge(b, 'edge-a').mix = { gain: 1.5, pan: -0.5 };
  const ja = canonicalSemanticJson(a);
  assert.notEqual(ja, base);
  assert.equal(ja, canonicalSemanticJson(b));
  assert.ok(ja.includes('"mix":{"gain":1.5,"pan":-0.5}'));
});

test('existing documents without mix keep their canonical form', () => {
  const d = minimalDocument();
  assert.equal(canonicalSemanticJson(d), canonicalSemanticJson(minimalDocument()));
  assert.ok(!canonicalSemanticJson(d).includes('"mix"'));
});
