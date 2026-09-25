import test from 'node:test';
import assert from 'node:assert/strict';
import type { EffectDocumentV2, NodeDefinition, ValidationResult } from '../src/model/types.ts';
import { compileAudio } from '../src/graph/toAudio.ts';
import { compilePathPreview } from '../src/graph/toPaths.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';
import { createF01Document, createL01Document } from '../src/graph/fixtures.ts';

const node = (id: string, type: string, params: NodeDefinition['params'] = {}): NodeDefinition =>
  ({ id, type, definitionVersion: 1, label: id, enabled: true, randomStreamId: `rs-${id}`, params });
const edge = (id: string, s: string, sp: string, t: string, tp: string, order = 0) =>
  ({ id, source: { nodeId: s, port: sp }, target: { nodeId: t, port: tp }, order });

/** Adds a minimal valid Schedule.start → AudioSource → AudioOutput → EffectOutput.audio chain. */
function withAudio(d: EffectDocumentV2): EffectDocumentV2 {
  const g = d.graphs[0];
  g.nodes.push(
    node('n-hcue', 'Schedule', { startTicks: 10, durationTicks: 20, mode: 'once' }),
    node('n-hsrc', 'AudioSource', { source: 'oscillator', waveform: 'saw', frequencyHz: 220, offsetTicks: 5, durationTicks: 12, gain: 0.5 }),
    node('n-haout', 'AudioOutput'),
  );
  g.edges.push(
    edge('e-htrig', 'n-hcue', 'start', 'n-hsrc', 'trigger'),
    edge('e-hsa', 'n-hsrc', 'audio', 'n-haout', 'audio'),
    edge('e-hao', 'n-haout', 'audio', 'node-output', 'audio'),
  );
  return d;
}
const ok = <T>(r: ValidationResult<T>): { value: T; warnings: unknown } => {
  if (!r.ok) assert.fail(`compile failed: ${JSON.stringify(r.errors, null, 1)}`);
  return { value: r.value, warnings: r.warnings };
};
const audioErrors = (r: ValidationResult<unknown>) => {
  if (r.ok) assert.fail('expected the root audio edge to be reported');
  return r.errors.filter(e => e.nodeId === 'node-output' && e.message.includes('EffectOutput.audio'));
};

test('the audio chain used below is itself valid for the audio compiler', () => {
  assert.equal(compileAudio(withAudio(createF01Document())).ok, true);
  assert.equal(compileAudio(withAudio(createL01Document())).ok, true);
});

test('path preview: root audio is an error by default and ignored only with audioHandled', () => {
  const d = withAudio(createL01Document());
  assert.equal(audioErrors(compilePathPreview(d, 30)).length, 1);
  assert.equal(audioErrors(compilePathPreview(d, 30, {})).length, 1);
  assert.equal(audioErrors(compilePathPreview(d, 30, { audioHandled: false })).length, 1);
  // With the flag the plan (layers and warnings) is identical to the audio-free document.
  assert.deepEqual(ok(compilePathPreview(d, 30, { audioHandled: true })), ok(compilePathPreview(createL01Document(), 30)));
  // The flag changes nothing for documents without audio.
  assert.deepEqual(ok(compilePathPreview(createL01Document(), 30, { audioHandled: true })), ok(compilePathPreview(createL01Document(), 30)));
});

test('particle preview: root audio is an error by default and ignored only with audioHandled', () => {
  const d = withAudio(createF01Document());
  assert.equal(audioErrors(compileParticlePreview(d)).length, 1);
  assert.equal(audioErrors(compileParticlePreview(d, { audioHandled: false })).length, 1);
  assert.deepEqual(ok(compileParticlePreview(d, { audioHandled: true })), ok(compileParticlePreview(createF01Document())));
  assert.deepEqual(ok(compileParticlePreview(createF01Document(), { audioHandled: true })), ok(compileParticlePreview(createF01Document())));
});
