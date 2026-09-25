import test from 'node:test';
import assert from 'node:assert/strict';
import type { Diagnostic, EffectDocumentV2, NodeDefinition, ValidationResult } from '../src/model/types.ts';
import { compileAudio, type AudioCompilePlan } from '../src/graph/toAudio.ts';
import { createF01Document } from '../src/graph/fixtures.ts';
import { renderVoice } from '../src/audio/synthesis.ts';
import { mixStereo } from '../src/audio/mix.ts';
import { scheduleEventRandomKey } from '../src/runtime/random.ts';

const node = (id: string, type: string, params: NodeDefinition['params'] = {}, enabled = true): NodeDefinition =>
  ({ id, type, definitionVersion: 1, label: id, enabled, randomStreamId: `rs-${id}`, params });
const edge = (id: string, s: string, sp: string, t: string, tp: string, order = 0) =>
  ({ id, source: { nodeId: s, port: sp }, target: { nodeId: t, port: tp }, order });
const root = (d: EffectDocumentV2) => d.graphs[0];
const find = (d: EffectDocumentV2, id: string) => root(d).nodes.find(n => n.id === id) as NodeDefinition;

/** F01 (visual chain untouched) plus cue Schedule.start → AudioSource → AudioOutput → EffectOutput.audio. */
function audioDoc(srcParams: NodeDefinition['params'], mutate?: (d: EffectDocumentV2) => void): EffectDocumentV2 {
  const d = createF01Document();
  const g = root(d);
  g.nodes.push(node('n-cue', 'Schedule', { startTicks: 10, durationTicks: 20, mode: 'once' }), node('n-src', 'AudioSource', srcParams), node('n-aout', 'AudioOutput'));
  g.edges.push(
    edge('e-trig', 'n-cue', 'start', 'n-src', 'trigger'),
    edge('e-sa', 'n-src', 'audio', 'n-aout', 'audio'),
    edge('e-ao', 'n-aout', 'audio', 'node-output', 'audio'),
  );
  mutate?.(d);
  return d;
}
function plan(d: EffectDocumentV2): AudioCompilePlan {
  const r = compileAudio(d);
  if (!r.ok) assert.fail(`compile failed: ${JSON.stringify(r.errors, null, 1)}`);
  return r.value;
}
function errorsOf(r: ValidationResult<unknown>): Diagnostic[] {
  if (r.ok) assert.fail('expected compile errors');
  return r.errors;
}

const OSC = { source: 'oscillator', waveform: 'saw', frequencyHz: 220, offsetTicks: 5, durationTicks: 12, gain: 0.5 };

test('oscillator: exact 800-sample tick timing and golden equality with renderVoice + centered mixStereo', () => {
  const p = plan(audioDoc(OSC));
  assert.equal(p.cueTick, 10);
  assert.equal(p.startTick, 15);
  assert.equal(p.startSample, 15 * 800);
  assert.equal(p.mix.left.length, (15 + 12) * 800);
  assert.equal(p.mix.sampleRate, 48000);
  const key = scheduleEventRandomKey('rs-n-cue', 10, 0);
  assert.equal(p.eventRandomKey, key);
  const v = renderVoice({ source: { kind: 'oscillator', waveform: 'saw', frequencyHz: 220, pulseDuty: 0.5 }, offsetTicks: 15, durationTicks: 12, gain: 0.5, pitchRatio: 1 },
    { documentSeed: 42, eventRandomKey: key, entityOrdinal: 0 });
  const m = mixStereo([{ startSample: v.startSample, samples: v.samples, gain: 1, pan: 0 }], 1);
  assert.deepEqual(p.mix.left, m.left);
  assert.deepEqual(p.mix.right, m.right);
  // Silence before the cue; centered, so both channels are identical.
  assert.ok(p.mix.left.subarray(0, 15 * 800).every(s => s === 0));
  assert.ok(p.mix.left.subarray(15 * 800).some(s => s !== 0));
  assert.deepEqual(p.mix.left, p.mix.right);
  // Deterministic across compiles; the input document is not mutated.
  const d = audioDoc(OSC);
  const before = structuredClone(d);
  assert.deepEqual(plan(d).mix.left, p.mix.left);
  assert.deepEqual(d, before);
});

test('noise identity: seed and randomStreamId drive the pattern, node IDs do not', () => {
  const NOISE = { source: 'noise', noiseColor: 'pink', durationTicks: 6 };
  const base = plan(audioDoc(NOISE)).mix.left;
  const v = renderVoice({ source: { kind: 'noise', color: 'pink', randomStreamId: 'rs-n-src' }, offsetTicks: 10, durationTicks: 6, gain: 1, pitchRatio: 1 },
    { documentSeed: 42, eventRandomKey: scheduleEventRandomKey('rs-n-cue', 10, 0), entityOrdinal: 0 });
  assert.deepEqual(base, mixStereo([{ startSample: v.startSample, samples: v.samples, gain: 1, pan: 0 }]).left);

  // Renaming the node (object ID) keeps the pattern; changing randomStreamId or seed changes it.
  const renamed = plan(audioDoc(NOISE, d => {
    find(d, 'n-src').id = 'n-renamed';
    for (const e of root(d).edges) {
      if (e.source.nodeId === 'n-src') e.source.nodeId = 'n-renamed';
      if (e.target.nodeId === 'n-src') e.target.nodeId = 'n-renamed';
    }
    const pos = d.editor.graphs['graph-root']?.nodes;
    if (pos && pos['n-src']) { pos['n-renamed'] = pos['n-src']; delete pos['n-src']; }
  }));
  assert.deepEqual(renamed.mix.left, base);
  assert.notDeepEqual(plan(audioDoc(NOISE, d => { find(d, 'n-src').randomStreamId = 'rs-other'; })).mix.left, base);
  assert.notDeepEqual(plan(audioDoc(NOISE, d => { d.seed = 43; })).mix.left, base);
});

test('unsupported or ambiguous audio graphs return addressed errors, never silent drops', () => {
  const cases: [string, (d: EffectDocumentV2) => void, string, string][] = [
    ['connected window', d => root(d).edges.push(edge('e-win', 'n-cue', 'window', 'n-src', 'window')), 'INVALID_VALUE', 'n-src'],
    ['missing trigger', d => { root(d).edges = root(d).edges.filter(e => e.id !== 'e-trig'); }, 'MISSING_REFERENCE', 'n-src'],
    ['multiple triggers', d => {
      root(d).nodes.push(node('n-cue2', 'Schedule', { startTicks: 20 }));
      root(d).edges.push(edge('e-trig2', 'n-cue2', 'start', 'n-src', 'trigger', 1));
    }, 'MULTIPLE_DRIVERS', 'n-src'],
    ['end event trigger', d => { (root(d).edges.find(e => e.id === 'e-trig') as ReturnType<typeof edge>).source.port = 'end'; }, 'UNKNOWN_NODE', 'n-cue'],
    ['repeat schedule', d => { find(d, 'n-cue').params.mode = 'repeat'; }, 'INVALID_VALUE', 'n-cue'],
    ['multiple outputs', d => {
      root(d).nodes.push(node('n-aout2', 'AudioOutput'));
      root(d).edges.push(edge('e-sa2', 'n-src', 'audio', 'n-aout2', 'audio'), edge('e-ao2', 'n-aout2', 'audio', 'node-output', 'audio', 1));
    }, 'MULTIPLE_DRIVERS', 'node-output'],
    ['cue after document end', d => { find(d, 'n-cue').params.startTicks = 120; }, 'INVALID_VALUE', 'n-cue'],
  ];
  for (const [name, mutate, code, nodeId] of cases) {
    const errs = errorsOf(compileAudio(audioDoc(OSC, mutate)));
    assert.ok(errs.some(e => e.code === code && e.nodeId === nodeId && typeof e.fieldPath === 'string'), `${name}: ${JSON.stringify(errs)}`);
  }
  // Connected but unsupported root audio (an extra source into the root AudioOutput) is rejected, not dropped.
  const extra = errorsOf(compileAudio(audioDoc(OSC, d => {
    root(d).nodes.push(node('n-src2', 'AudioSource', { ...OSC }));
    root(d).edges.push(edge('e-trig2', 'n-cue', 'start', 'n-src2', 'trigger', 1), edge('e-sa2', 'n-src2', 'audio', 'n-aout', 'audio', 1));
  })));
  assert.ok(extra.some(e => e.code === 'MULTIPLE_DRIVERS'), JSON.stringify(extra));
  // No audio output at all, and a disabled source: both rejected (analysis or compiler, never ok).
  errorsOf(compileAudio(createF01Document()));
  errorsOf(compileAudio(audioDoc(OSC, d => { find(d, 'n-src').enabled = false; })));
  errorsOf(compileAudio(audioDoc(OSC, d => { find(d, 'n-cue').enabled = false; })));
});

test('offset and mix budgets are BUDGET_EXCEEDED on AudioSource before rendering', () => {
  // Mix cap 4_800_000 frames = 6000 ticks; offset cap 36000 ticks (cue + offsetTicks combined).
  const cases: [string, number, number, string][] = [
    ['offset 36000 + cue 10 exceeds offset cap', 36000, 12, 'offsetTicks'],
    ['cue + offset exactly 36000 still exceeds mix cap', 35990, 12, 'offsetTicks'],
    ['start at mix cap', 5990, 1, 'offsetTicks'],
    ['tail one tick past mix cap', 5979, 12, 'durationTicks'],
  ];
  for (const [name, offsetTicks, durationTicks, field] of cases) {
    const errs = errorsOf(compileAudio(audioDoc({ ...OSC, offsetTicks, durationTicks })));
    assert.ok(errs.some(e => e.code === 'BUDGET_EXCEEDED' && e.nodeId === 'n-src' && e.fieldPath?.endsWith(`.params.${field}`)), `${name}: ${JSON.stringify(errs)}`);
  }
  // Offset and tail may run past the visual document end (cue must not): F01 is shorter than tick 130.
  const p = plan(audioDoc({ ...OSC, offsetTicks: 120, durationTicks: 12 }));
  assert.equal(p.startTick, 130);
  assert.ok(p.startTick > p.durationTicks);
  assert.equal(p.mix.left.length, 142 * 800);
});

test('enabled orphan audio nodes are warned drafts, not executed, and do not fail compilation', () => {
  const base = plan(audioDoc(OSC));
  const r = compileAudio(audioDoc(OSC, d => {
    root(d).nodes.push(node('n-osrc', 'AudioSource', { ...OSC, gain: 1 }), node('n-oout', 'AudioOutput'), node('n-off', 'AudioSource', {}, false));
    root(d).edges.push(edge('e-o1', 'n-cue', 'start', 'n-osrc', 'trigger', 1), edge('e-o2', 'n-osrc', 'audio', 'n-oout', 'audio'));
  }));
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  assert.deepEqual(r.value.mix.left, base.mix.left);
  for (const id of ['n-osrc', 'n-oout']) {
    assert.ok(r.warnings.some(w => w.severity === 'warning' && w.nodeId === id), `${id}: ${JSON.stringify(r.warnings)}`);
  }
  assert.ok(!r.warnings.some(w => w.nodeId === 'n-off' && /draft/.test(w.message)));
});
