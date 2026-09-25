import test from 'node:test';
import assert from 'node:assert/strict';
import type { Diagnostic, EdgeDefinition, EffectDocumentV2, NodeDefinition, ValidationResult } from '../src/model/types.ts';
import { compileAudio, type AudioMixCompilePlan, type DirectAudioCompilePlan } from '../src/graph/toAudio.ts';
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
function plan(d: EffectDocumentV2): DirectAudioCompilePlan {
  const r = compileAudio(d);
  if (!r.ok) assert.fail(`compile failed: ${JSON.stringify(r.errors, null, 1)}`);
  if (r.value.kind !== 'direct') assert.fail(`expected a direct plan, got ${r.value.kind}`);
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

// ---- Phase 3: one root AudioMix@1 ----

type MixIn = { id: string; params: NodeDefinition['params']; cue?: number; order?: number; mix?: { gain: number; pan: number } };

/** F01 plus, per input, Schedule.start → AudioSource.audio → AudioMix.inputs; AudioMix → AudioOutput → EffectOutput. */
function mixDoc(inputs: MixIn[], mixParams: NodeDefinition['params'] = {}, mutate?: (d: EffectDocumentV2) => void): EffectDocumentV2 {
  const d = createF01Document();
  const g = root(d);
  g.nodes.push(node('n-mix', 'AudioMix', mixParams), node('n-aout', 'AudioOutput'));
  g.edges.push(edge('e-ma', 'n-mix', 'audio', 'n-aout', 'audio'), edge('e-ao', 'n-aout', 'audio', 'node-output', 'audio'));
  inputs.forEach((s, i) => {
    g.nodes.push(node(`n-cue-${s.id}`, 'Schedule', { startTicks: s.cue ?? 10, durationTicks: 20, mode: 'once' }), node(`n-src-${s.id}`, 'AudioSource', s.params));
    const e: EdgeDefinition = edge(`e-in-${s.id}`, `n-src-${s.id}`, 'audio', 'n-mix', 'inputs', s.order ?? i);
    if (s.mix) e.mix = s.mix;
    g.edges.push(edge(`e-trig-${s.id}`, `n-cue-${s.id}`, 'start', `n-src-${s.id}`, 'trigger'), e);
  });
  mutate?.(d);
  return d;
}
function mixPlan(d: EffectDocumentV2): AudioMixCompilePlan {
  const r = compileAudio(d);
  if (!r.ok) assert.fail(`compile failed: ${JSON.stringify(r.errors, null, 1)}`);
  if (r.value.kind !== 'mix') assert.fail(`expected a mix plan, got ${r.value.kind}`);
  return r.value;
}
const NOISE_B = { source: 'noise', noiseColor: 'white', durationTicks: 6, gain: 0.8 };
const renderA = () => renderVoice({ source: { kind: 'oscillator', waveform: 'saw', frequencyHz: 220, pulseDuty: 0.5 }, offsetTicks: 15, durationTicks: 12, gain: 0.5, pitchRatio: 1 },
  { documentSeed: 42, eventRandomKey: scheduleEventRandomKey('rs-n-cue-a', 10, 0), entityOrdinal: 0 });
const renderB = () => renderVoice({ source: { kind: 'noise', color: 'white', randomStreamId: 'rs-n-src-b' }, offsetTicks: 20, durationTicks: 6, gain: 0.8, pitchRatio: 1 },
  { documentSeed: 42, eventRandomKey: scheduleEventRandomKey('rs-n-cue-b', 20, 0), entityOrdinal: 0 });

test('two-source AudioMix equals independent renderVoice + one mixStereo with edge gain/pan and masterGain', () => {
  const d = mixDoc([
    { id: 'a', params: OSC, mix: { gain: 1.5, pan: -0.25 } },
    { id: 'b', params: NOISE_B, cue: 20, mix: { gain: 0.5, pan: 1 } },
  ], { masterGain: 0.75 });
  const before = structuredClone(d);
  const p = mixPlan(d);
  assert.deepEqual(d, before);
  assert.equal(p.mixNodeId, 'n-mix');
  assert.equal(p.masterGain, 0.75);
  assert.deepEqual(p.voices.map(v => [v.edgeId, v.sourceNodeId, v.gain, v.pan]), [['e-in-a', 'n-src-a', 1.5, -0.25], ['e-in-b', 'n-src-b', 0.5, 1]]);
  assert.equal(p.voices[1].eventRandomKey, scheduleEventRandomKey('rs-n-cue-b', 20, 0));
  const a = renderA();
  const b = renderB();
  const m = mixStereo([
    { startSample: a.startSample, samples: a.samples, gain: 1.5, pan: -0.25 },
    { startSample: b.startSample, samples: b.samples, gain: 0.5, pan: 1 },
  ], 0.75);
  assert.deepEqual(p.mix.left, m.left);
  assert.deepEqual(p.mix.right, m.right);
  assert.equal(p.mix.left.length, 27 * 800);
  // Deterministic across compiles.
  assert.deepEqual(mixPlan(mixDoc([{ id: 'a', params: OSC, mix: { gain: 1.5, pan: -0.25 } }, { id: 'b', params: NOISE_B, cue: 20, mix: { gain: 0.5, pan: 1 } }], { masterGain: 0.75 })).mix.left, p.mix.left);
});

test('hard pan leaves the other channel bit-silent; absent edge mix equals the default {1, 0}', () => {
  const left = mixPlan(mixDoc([{ id: 'a', params: OSC, mix: { gain: 1, pan: -1 } }]));
  assert.ok(left.mix.right.every(s => s === 0));
  assert.ok(left.mix.left.some(s => s !== 0));
  const absent = mixPlan(mixDoc([{ id: 'a', params: OSC }]));
  const explicit = mixPlan(mixDoc([{ id: 'a', params: OSC, mix: { gain: 1, pan: 0 } }]));
  assert.deepEqual(absent.voices.map(v => [v.gain, v.pan]), [[1, 0]]);
  assert.deepEqual(absent.mix.left, explicit.mix.left);
  // A single default input through the mix matches the direct chain.
  assert.deepEqual(absent.mix.left, plan(audioDoc(OSC)).mix.left);
});

test('edge order (then edge ID) sets summation order; gains follow their edges', () => {
  const ab = mixPlan(mixDoc([{ id: 'a', params: OSC, order: 0, mix: { gain: 2, pan: 0 } }, { id: 'b', params: NOISE_B, cue: 20, order: 1 }]));
  const ba = mixPlan(mixDoc([{ id: 'a', params: OSC, order: 1, mix: { gain: 2, pan: 0 } }, { id: 'b', params: NOISE_B, cue: 20, order: 0 }]));
  assert.deepEqual(ab.voices.map(v => v.edgeId), ['e-in-a', 'e-in-b']);
  assert.deepEqual(ba.voices.map(v => v.edgeId), ['e-in-b', 'e-in-a']);
  assert.equal(ba.voices[1].gain, 2);
  const a = renderA();
  const b = renderB();
  const m = mixStereo([{ startSample: b.startSample, samples: b.samples, gain: 1, pan: 0 }, { startSample: a.startSample, samples: a.samples, gain: 2, pan: 0 }]);
  assert.deepEqual(ba.mix.left, m.left);
  // Equal order: the edge ID breaks the tie.
  const tie = mixPlan(mixDoc([{ id: 'b', params: NOISE_B, cue: 20, order: 0 }, { id: 'a', params: OSC, order: 0 }]));
  assert.deepEqual(tie.voices.map(v => v.edgeId), ['e-in-a', 'e-in-b']);
});

test('disabled AudioMix contributes nothing; zero inputs is a 0-frame mix', () => {
  const off = mixPlan(mixDoc([{ id: 'a', params: OSC }], {}, d => { find(d, 'n-mix').enabled = false; }));
  assert.equal(off.voices.length, 0);
  assert.equal(off.mix.left.length, 0);
  const none = mixPlan(mixDoc([]));
  assert.equal(none.mix.left.length, 0);
  assert.equal(none.mix.right.length, 0);
});

test('invalid mix values, nested mixes and unsupported inputs return addressed errors', () => {
  const at = (r: ValidationResult<unknown>, code: string, pred: (e: Diagnostic) => boolean, name: string) => {
    const errs = errorsOf(r);
    assert.ok(errs.some(e => e.code === code && pred(e)), `${name}: ${JSON.stringify(errs)}`);
  };
  at(compileAudio(mixDoc([{ id: 'a', params: OSC, mix: { gain: 2.5, pan: 0 } }])), 'INVALID_VALUE', e => e.fieldPath?.endsWith('.mix.gain') === true, 'gain > 2');
  at(compileAudio(mixDoc([{ id: 'a', params: OSC, mix: { gain: 1, pan: -1.01 } }])), 'INVALID_VALUE', e => e.fieldPath?.endsWith('.mix.pan') === true, 'pan < -1');
  at(compileAudio(mixDoc([{ id: 'a', params: OSC }], { masterGain: 1.5 })), 'INVALID_VALUE', e => e.fieldPath?.includes('masterGain') === true, 'masterGain > 1');
  const addressed = (id: string) => (e: Diagnostic) => e.nodeId === id && typeof e.fieldPath === 'string';
  at(compileAudio(mixDoc([{ id: 'a', params: OSC }], {}, d => {
    root(d).nodes.push(node('n-mix2', 'AudioMix'));
    root(d).edges.push(edge('e-nest', 'n-mix2', 'audio', 'n-mix', 'inputs', 5));
  })), 'INVALID_VALUE', addressed('n-mix2'), 'nested mix');
  at(compileAudio(mixDoc([{ id: 'a', params: OSC }], {}, d => { find(d, 'n-src-a').enabled = false; })), 'INVALID_VALUE', addressed('n-src-a'), 'disabled source');
  at(compileAudio(mixDoc([{ id: 'a', params: OSC }], {}, d => { find(d, 'n-cue-a').params.mode = 'repeat'; })), 'INVALID_VALUE', addressed('n-cue-a'), 'repeat schedule');
  at(compileAudio(mixDoc([{ id: 'a', params: OSC }], {}, d => {
    root(d).edges.push(edge('e-win', 'n-cue-a', 'window', 'n-src-a', 'window'));
  })), 'INVALID_VALUE', addressed('n-src-a'), 'connected window');
  at(compileAudio(mixDoc([{ id: 'a', params: OSC }], {}, d => {
    root(d).edges = root(d).edges.filter(e => e.id !== 'e-trig-a');
  })), 'MISSING_REFERENCE', addressed('n-src-a'), 'missing trigger');
  // A second root feed into AudioOutput alongside the mix is rejected, never dropped.
  at(compileAudio(mixDoc([{ id: 'a', params: OSC }], {}, d => {
    root(d).nodes.push(node('n-cue-x', 'Schedule', { startTicks: 10 }), node('n-src-x', 'AudioSource', { ...OSC }));
    root(d).edges.push(edge('e-trig-x', 'n-cue-x', 'start', 'n-src-x', 'trigger'), edge('e-sx', 'n-src-x', 'audio', 'n-aout', 'audio', 1));
  })), 'MULTIPLE_DRIVERS', () => true, 'extra root feed');
});

test('mix budgets are BUDGET_EXCEEDED on the AudioMix before any voice renders', () => {
  const many = Array.from({ length: 65 }, (_, i) => ({ id: `v${String(i).padStart(2, '0')}`, params: { ...OSC, durationTicks: 1 } }));
  const count = errorsOf(compileAudio(mixDoc(many)));
  assert.ok(count.some(e => e.code === 'BUDGET_EXCEEDED' && e.nodeId === 'n-mix'), JSON.stringify(count));
  mixPlan(mixDoc(many.slice(0, 64)));
  // 11 × 600 ticks × 800 = 5.28M voice samples > 4.8M.
  const long = Array.from({ length: 11 }, (_, i) => ({ id: `l${String(i).padStart(2, '0')}`, params: { ...OSC, offsetTicks: 0, durationTicks: 600 } }));
  const total = errorsOf(compileAudio(mixDoc(long)));
  assert.ok(total.some(e => e.code === 'BUDGET_EXCEEDED' && e.nodeId === 'n-mix'), JSON.stringify(total));
  // Per-voice frame cap is still addressed to the offending AudioSource.
  const late = errorsOf(compileAudio(mixDoc([{ id: 'a', params: OSC }, { id: 'b', params: { ...OSC, offsetTicks: 5979 } }])));
  assert.ok(late.some(e => e.code === 'BUDGET_EXCEEDED' && e.nodeId === 'n-src-b'), JSON.stringify(late));
});

test('one AudioSource feeding two mix edges is two ordered voices with independent gain/pan, counted twice', () => {
  const fan = (params: NodeDefinition['params']) => mixDoc([{ id: 'a', params, mix: { gain: 1.5, pan: -0.5 } }], {}, d => {
    const e: EdgeDefinition = edge('e-in-a2', 'n-src-a', 'audio', 'n-mix', 'inputs', 1);
    e.mix = { gain: 0.5, pan: 1 };
    root(d).edges.push(e);
  });
  const p = mixPlan(fan(OSC));
  assert.deepEqual(p.voices.map(v => [v.edgeId, v.sourceNodeId, v.gain, v.pan]), [['e-in-a', 'n-src-a', 1.5, -0.5], ['e-in-a2', 'n-src-a', 0.5, 1]]);
  const a = renderA();
  const m = mixStereo([
    { startSample: a.startSample, samples: a.samples, gain: 1.5, pan: -0.5 },
    { startSample: a.startSample, samples: a.samples, gain: 0.5, pan: 1 },
  ]);
  assert.deepEqual(p.mix.left, m.left);
  assert.deepEqual(p.mix.right, m.right);
  // 11 x 600 ticks x 800 = 5,280,000 voice samples > 4.8M; each fanout edge counts.
  const over = fan({ ...OSC, offsetTicks: 0, durationTicks: 600 });
  for (let i = 3; i <= 11; i += 1) {
    root(over).edges.push(edge(`e-in-a${i}`, 'n-src-a', 'audio', 'n-mix', 'inputs', i - 1));
  }
  const errs = errorsOf(compileAudio(over));  assert.ok(errs.some(e => e.code === 'BUDGET_EXCEEDED' && e.nodeId === 'n-mix'), JSON.stringify(errs));
});

test('an exposed-control driver aborts with an addressed error before any chain walk or render', () => {
  // Root: an otherwise valid direct chain plus Group node-outer(graph-mid). In graph-mid a GroupInput with a literal
  // default drives exposed control ctl-op of Group node-inner(graph-inner) → one expanded control driver.
  const d = audioDoc(OSC, doc => {
    root(doc).nodes.push(node('n-outer', 'Group', { graphId: 'graph-mid' }));
    doc.graphs.push(
      {
        id: 'graph-mid',
        inputs: [{ id: 'op', label: 'op', type: 'scalarSignal', unit: 'normalized', domains: ['constant'], cardinality: 'one', required: false, direction: 'input', defaultValue: 0.3 }],
        outputs: [],
        nodes: [node('n-mid-op', 'GroupInput', { portId: 'op' }), node('n-inner', 'Group', { graphId: 'graph-inner' })],
        edges: [edge('e-mid-ctl', 'n-mid-op', 'out', 'n-inner', 'ctl-op')],
      },
      { id: 'graph-inner', inputs: [], outputs: [], nodes: [], edges: [] },
    );
    doc.controls.push({ id: 'ctl-op', scopeGraphId: 'graph-inner', label: 'Op', type: 'number', unit: 'normalized',
      value: 0.5, default: 0.5, section: 'Main', description: '', editPolicy: 'live', bindings: [] });
  });
  const r = compileAudio(d);
  assert.equal(r.ok, false);
  assert.ok(!('value' in r), 'no plan or rendered mix is returned');
  const errs = errorsOf(r);
  // Only the control-driver error: compilation stopped before the (valid) chain was walked or rendered.
  assert.equal(errs.length, 1, JSON.stringify(errs));
  assert.equal(errs[0].code, 'INVALID_VALUE');
  assert.equal(errs[0].nodeId, 'n-inner');
  assert.equal(errs[0].fieldPath, 'graphs[1].nodes[1]');
  assert.match(errs[0].message, /ctl-op/);
});

test('orphan AudioMix drafts warn and do not change the direct chain', () => {
  const base = plan(audioDoc(OSC));
  const r = compileAudio(audioDoc(OSC, d => { root(d).nodes.push(node('n-omix', 'AudioMix')); }));
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  assert.equal(r.value.kind, 'direct');
  assert.deepEqual(r.value.mix.left, base.mix.left);
  assert.ok(r.warnings.some(w => w.nodeId === 'n-omix' && w.severity === 'warning'));
});
