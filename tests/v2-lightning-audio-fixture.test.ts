import test from 'node:test';
import assert from 'node:assert/strict';
import type { ValidationResult } from '../src/model/types.ts';
import { validateDocument } from '../src/model/document.ts';
import { compileAudio } from '../src/graph/toAudio.ts';
import { compilePathPreview } from '../src/graph/toPaths.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { createL01Document } from '../src/graph/fixtures.ts';
import { createL01AudioDocument } from '../src/graph/audioFixtures.ts';

const ok = <T>(r: ValidationResult<T>): { value: T; warnings: unknown } => {
  if (!r.ok) assert.fail(`compile failed: ${JSON.stringify(r.errors, null, 1)}`);
  return { value: r.value, warnings: r.warnings };
};

test('audio lightning document validates with unique node, edge and random stream IDs', () => {
  const d = createL01AudioDocument();
  ok(validateDocument(d, { registry: createRegistry() }));
  const nodes = d.graphs[0].nodes;
  assert.equal(new Set(nodes.map(n => n.id)).size, nodes.length);
  assert.equal(new Set(nodes.map(n => n.randomStreamId)).size, nodes.length);
  assert.equal(new Set(d.graphs[0].edges.map(e => e.id)).size, d.graphs[0].edges.length);
  // Builder returns fresh documents and leaves the plain L01 fixture untouched.
  assert.notEqual(createL01AudioDocument(), d);
  assert.equal(createL01Document().graphs[0].nodes.some(n => n.type.startsWith('Audio')), false);
});

test('compileAudio: mix of a charge chirp (0-24) and a discharge noise burst at tick 24', () => {
  const { value: plan, warnings } = ok(compileAudio(createL01AudioDocument()));
  // No audio node is left as an unrendered draft.
  assert.equal((warnings as { message: string }[]).some(w => w.message.includes('EffectOutput.audio')), false);
  assert.equal(plan.kind, 'mix');
  if (plan.kind !== 'mix') return;
  assert.equal(plan.mixNodeId, 'node-audio-mix');
  assert.ok(plan.masterGain > 0 && plan.masterGain <= 1);
  assert.deepEqual(plan.voices.map(v => [v.sourceNodeId, v.cueTick, v.startTick, v.startSample, v.voice.durationTicks, v.pan]), [
    ['node-charge-sound', 0, 0, 0, 24, 0],
    ['node-strike-sound', 24, 24, 24 * 800, 6, 0],
  ]);
  assert.equal(plan.voices[0].voice.source.kind, 'chirp');
  assert.equal(plan.voices[1].voice.source.kind, 'noise');
  assert.ok(plan.voices[0].voice.gain * plan.voices[0].gain < plan.voices[1].voice.gain * plan.voices[1].gain, 'charge is quieter than discharge');
  const m = plan.mix;
  assert.equal(m.left.length, 30 * 800);
  assert.ok(Number.isFinite(m.prePeak) && Number.isFinite(m.postPeak));
  assert.ok(m.postPeak > 0 && m.postPeak <= 1);
  for (const ch of [m.left, m.right]) for (const s of ch) assert.ok(Number.isFinite(s));
  // Centered: identical channels.
  assert.deepEqual(m.left, m.right);
});

test('compileAudio is deterministic for the audio lightning document', () => {
  const a = ok(compileAudio(createL01AudioDocument())).value;
  const b = ok(compileAudio(createL01AudioDocument())).value;
  assert.deepEqual(a, b);
});

test('path preview: audio is rejected by default and ignored with audioHandled (matches L01 at tick 30)', () => {
  const d = createL01AudioDocument();
  const def = compilePathPreview(d, 30);
  assert.equal(def.ok, false);
  if (!def.ok) assert.ok(def.errors.some(e => e.nodeId === 'node-output' && e.message.includes('EffectOutput.audio')));
  assert.deepEqual(ok(compilePathPreview(d, 30, { audioHandled: true })), ok(compilePathPreview(createL01Document(), 30)));
});

test('audio chains Source → Filter → Envelope → Mix compile into shaped voices; disabled modifiers bypass', async () => {
  const { createL01AudioDocument } = await import('../src/graph/audioFixtures.ts');
  const { compileAudio } = await import('../src/graph/toAudio.ts');
  const d = createL01AudioDocument();
  const g = d.graphs[0];
  const into = g.edges.find(e => e.target.nodeId === 'node-audio-mix' && e.source.nodeId === 'node-strike-sound')!;
  g.nodes.push(
    { id: 'node-f', type: 'AudioFilter', definitionVersion: 1, label: 'f', enabled: true, randomStreamId: 'rs-f', params: { mode: 'lowpass', cutoffHz: 4000, cutoffEndHz: 300, q: 1 } },
    { id: 'node-e', type: 'AudioEnvelope', definitionVersion: 1, label: 'e', enabled: true, randomStreamId: 'rs-e', params: { attack: 0.005, hold: 0.05, release: 0.4 } },
  );
  g.edges.push({ id: 'e-sf', source: { nodeId: 'node-strike-sound', port: 'audio' }, target: { nodeId: 'node-f', port: 'audio' }, order: 0 },
    { id: 'e-fe', source: { nodeId: 'node-f', port: 'audio' }, target: { nodeId: 'node-e', port: 'audio' }, order: 0 });
  into.source = { nodeId: 'node-e', port: 'audio' };
  const r = compileAudio(d);
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  assert.equal(r.value.kind, 'mix');
  const v = r.value.kind === 'mix' ? r.value.voices.find(x => x.sourceNodeId === 'node-strike-sound')!.voice : undefined;
  assert.deepEqual(v?.filters, [{ mode: 'lowpass', cutoffHz: 4000, cutoffEndHz: 300, q: 1 }]);
  assert.equal(v?.envelopes?.[0].release, 0.4);
  g.nodes.find(n => n.id === 'node-f')!.enabled = false;
  const b = compileAudio(d);
  if (!b.ok) assert.fail(JSON.stringify(b.errors));
  assert.equal(b.value.kind === 'mix' && b.value.voices.find(x => x.sourceNodeId === 'node-strike-sound')!.voice.filters, undefined, 'disabled filter bypassed');
});
