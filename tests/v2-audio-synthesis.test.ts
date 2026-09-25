import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_SAMPLE_RATE, BOUNDARY_RAMP_SAMPLES, MAX_VOICES, applyBoundaryRamps, assertVoiceBudget, chirpFrequency,
  polyBlep, renderVoice, type ChirpSource, type VoiceRandomContext, type VoiceSpec,
} from '../src/audio/synthesis.ts';

const ctx: VoiceRandomContext = { documentSeed: 1234, eventRandomKey: '["schedule","cue",0,0]', entityOrdinal: 0 };

function osc(waveform: 'sine' | 'triangle' | 'saw' | 'pulse', frequencyHz: number, extra: Partial<VoiceSpec> = {}): VoiceSpec {
  return { source: { kind: 'oscillator', waveform, frequencyHz }, offsetTicks: 0, durationTicks: 60, gain: 1, ...extra };
}

function noise(color: 'white' | 'pink' | 'brown', randomStreamId = 'crackle'): VoiceSpec {
  return { source: { kind: 'noise', color, randomStreamId }, offsetTicks: 0, durationTicks: 30, gain: 1 };
}

/** Rising zero crossings in [from,to). */
function risingCrossings(s: Float32Array, from: number, to: number): number {
  let c = 0;
  for (let i = Math.max(1, from); i < to; i++) if (s[i - 1] < 0 && s[i] >= 0) c++;
  return c;
}

function peak(s: Float32Array): number {
  let p = 0;
  for (const v of s) p = Math.max(p, Math.abs(v));
  return p;
}

test('exact length and start sample from ticks (800 samples per tick)', () => {
  const v = renderVoice(osc('sine', 440, { offsetTicks: 7, durationTicks: 3 }), ctx);
  assert.equal(v.samples.length, 2400);
  assert.equal(v.startSample, 5600);
  assert.equal(renderVoice(noise('pink'), ctx).samples.length, 24000);
});

test('replay identity for every source kind', () => {
  const specs: VoiceSpec[] = [
    osc('sine', 440), osc('triangle', 300), osc('saw', 1000), osc('pulse', 250),
    noise('white'), noise('pink'), noise('brown'),
    { source: { kind: 'chirp', startHz: 100, endHz: 4000, sweep: 'exponential' }, offsetTicks: 0, durationTicks: 20, gain: 0.5 },
  ];
  for (const s of specs) assert.deepEqual(renderVoice(s, ctx).samples, renderVoice(s, { ...ctx }).samples);
});

test('oscillator frequency matches zero crossings', () => {
  const s = renderVoice(osc('sine', 440), ctx).samples; // 1 s
  assert.ok(Math.abs(risingCrossings(s, 0, s.length) - 440) <= 1);
  const p = renderVoice(osc('pulse', 100, { pitchRatio: 2 }), ctx).samples;
  assert.ok(Math.abs(risingCrossings(p, 0, p.length) - 200) <= 1);
  const saw = renderVoice(osc('saw', 1000), ctx).samples;
  assert.ok(peak(saw) <= 1.0001, 'PolyBLEP saw stays bounded');
});

test('pulse duty controls positive fraction', () => {
  const s = renderVoice(osc('pulse', 100, { source: { kind: 'oscillator', waveform: 'pulse', frequencyHz: 100, pulseDuty: 0.25 } }), ctx).samples;
  let pos = 0;
  for (let i = BOUNDARY_RAMP_SAMPLES; i < s.length - BOUNDARY_RAMP_SAMPLES; i++) if (s[i] > 0) pos++;
  assert.ok(Math.abs(pos / (s.length - 2 * BOUNDARY_RAMP_SAMPLES) - 0.25) < 0.01);
});

test('polyBlep matches plan24 edge formulas', () => {
  assert.equal(polyBlep(0, 0.1), -1);
  assert.equal(polyBlep(0.5, 0.1), 0);
  assert.ok(Math.abs(polyBlep(0.95, 0.1) - 0.25) < 1e-12);
});

test('chirp sweeps linearly and exponentially', () => {
  const lin: ChirpSource = { kind: 'chirp', startHz: 200, endHz: 2000, sweep: 'linear' };
  const exp: ChirpSource = { ...lin, sweep: 'exponential' };
  assert.equal(chirpFrequency(lin, 0.5), 1100);
  assert.ok(Math.abs(chirpFrequency(exp, 0.5) - Math.sqrt(200 * 2000)) < 1e-9);
  const s = renderVoice({ source: lin, offsetTicks: 0, durationTicks: 60, gain: 1 }, ctx).samples;
  const q = s.length / 10;
  // First tenth averages ~290 Hz, last tenth ~1910 Hz over 0.1 s windows.
  assert.ok(Math.abs(risingCrossings(s, 0, q) - 29) <= 2);
  assert.ok(Math.abs(risingCrossings(s, 9 * q, s.length) - 191) <= 2);
  // Phase continuity: no sample-to-sample jump larger than the max per-sample sine slope.
  const maxStep = 2 * Math.PI * 2000 / AUDIO_SAMPLE_RATE + 1e-4;
  for (let i = 1; i < s.length; i++) assert.ok(Math.abs(s[i] - s[i - 1]) <= maxStep + 1 / BOUNDARY_RAMP_SAMPLES);
});

test('boundary ramps start and end at zero and scale linearly', () => {
  const s = renderVoice(osc('triangle', 50, { gain: 2 }), ctx).samples; // triangle starts at +1
  assert.equal(s[0], 0);
  assert.equal(s[s.length - 1], 0);
  assert.ok(Math.abs(s[120] - 2 * 0.5 * (4 * Math.abs(120 * 50 / AUDIO_SAMPLE_RATE - 0.5) - 1)) < 1e-5);
  const short = new Float32Array(10).fill(1);
  applyBoundaryRamps(short);
  assert.deepEqual(Array.from(short), [0, 0.2, 0.4, 0.6, 0.8, 0.8, 0.6, 0.4, 0.2, 0].map(Math.fround));
});

test('gain scales and noise stays bounded without normalization', () => {
  const a = renderVoice(noise('white'), ctx).samples;
  const half = renderVoice({ ...noise('white'), gain: 0.5 }, ctx).samples;
  for (let i = 0; i < a.length; i++) assert.equal(half[i], Math.fround(a[i] * 0.5));
  for (const c of ['white', 'pink', 'brown'] as const) {
    const s = renderVoice(noise(c), ctx).samples;
    assert.ok(peak(s) <= 1 && peak(s) > 0, `${c} bounded and nonzero`);
    assert.ok(s.every(Number.isFinite));
  }
  // Brown noise is low-passed: adjacent samples highly correlated vs white.
  const b = renderVoice(noise('brown'), ctx).samples;
  let maxStep = 0;
  for (let i = 1; i < b.length; i++) maxStep = Math.max(maxStep, Math.abs(b[i] - b[i - 1]));
  assert.ok(maxStep <= 0.04 + 1 / BOUNDARY_RAMP_SAMPLES + 1e-6); // leak step plus ramp slope
});

test('noise independence: stream/seed/event change pattern, unrelated renders do not', () => {
  const first = renderVoice(noise('pink', 'snap'), ctx).samples;
  renderVoice(noise('white', 'other'), ctx);
  renderVoice(osc('saw', 500), ctx);
  assert.deepEqual(renderVoice(noise('pink', 'snap'), ctx).samples, first);
  assert.notDeepEqual(renderVoice(noise('pink', 'snap2'), ctx).samples, first);
  assert.notDeepEqual(renderVoice(noise('pink', 'snap'), { ...ctx, documentSeed: 1235 }).samples, first);
  assert.notDeepEqual(renderVoice(noise('pink', 'snap'), { ...ctx, entityOrdinal: 1 }).samples, first);
  for (const c of ['white', 'pink', 'brown'] as const) {
    assert.notDeepEqual(
      renderVoice(noise(c, 'snap'), { ...ctx, eventRandomKey: '["schedule","cue",1,0]' }).samples,
      renderVoice(noise(c, 'snap'), ctx).samples, `${c} eventRandomKey changes noise`);
  }
  // Same key with a longer duration yields an identical prefix (before ramps).
  const longer = renderVoice({ ...noise('white', 'snap'), durationTicks: 60 }, ctx).samples;
  const shorter = renderVoice(noise('white', 'snap'), ctx).samples;
  for (let i = BOUNDARY_RAMP_SAMPLES; i < shorter.length - BOUNDARY_RAMP_SAMPLES; i++) assert.equal(longer[i], shorter[i]);
});

test('pulse and saw stay bounded and finite at extreme frequency/duty (A2 clamp)', () => {
  for (const [hz, pitchRatio] of [[20, 0.25], [20, 1], [8000, 1], [16000, 1], [16000, 4]] as const) {
    for (const pulseDuty of [0.05, 0.5, 0.95]) {
      const s = renderVoice(osc('pulse', hz, { pitchRatio, source: { kind: 'oscillator', waveform: 'pulse', frequencyHz: hz, pulseDuty } }), ctx).samples;
      assert.ok(s.every(Number.isFinite));
      assert.ok(peak(s) <= 1, `pulse ${hz}Hz x${pitchRatio} duty ${pulseDuty} peak ${peak(s)}`);
    }
    const saw = renderVoice(osc('saw', hz, { pitchRatio }), ctx).samples;
    assert.ok(peak(saw) <= 1 + 1e-6, `saw ${hz}Hz x${pitchRatio} peak ${peak(saw)}`);
  }
});

// Golden Float32 noise samples captured from the implemented A2 noise scheme v1.
const GOLDEN: Record<'white' | 'pink' | 'brown', number[]> = {
  white: [0.6973916888237, 0.6412504315376282, -0.6873721480369568, -0.4436509907245636, -0.4599282443523407, 0.9879837036132812],
  pink: [0.3215795159339905, 0.27973833680152893, 0.2040766328573227, 0.07503345608711243, 0.13972905278205872, -0.0891118198633194],
  brown: [0.07990673929452896, 0.09113361686468124, 0.07556349784135818, 0.04542379453778267, 0.08094197511672974, 0.10148640722036362],
};
const GOLDEN_INDICES = [300, 301, 302, 1000, 5000, 20000];

test('golden noise sample vectors (plan24 A2)', () => {
  for (const c of ['white', 'pink', 'brown'] as const) {
    const s = renderVoice(noise(c, 'golden'), ctx).samples;
    const got = GOLDEN_INDICES.map((i) => s[i]);
    assert.deepEqual(got, GOLDEN[c].map(Math.fround));
  }
});

test('range validation rejects out-of-plan values', () => {
  const bad: VoiceSpec[] = [
    osc('sine', 19.9), osc('sine', 16001), osc('sine', Number.NaN),
    osc('sine', 440, { gain: 2.1 }), osc('sine', 440, { gain: -0.1 }),
    osc('sine', 440, { durationTicks: 0 }), osc('sine', 440, { durationTicks: 601 }), osc('sine', 440, { durationTicks: 1.5 }),
    osc('sine', 440, { offsetTicks: -1 }), osc('sine', 440, { pitchRatio: 0.2 }), osc('sine', 440, { pitchRatio: 4.1 }),
    osc('pulse', 440, { source: { kind: 'oscillator', waveform: 'pulse', frequencyHz: 440, pulseDuty: 0.96 } }),
    { source: { kind: 'chirp', startHz: 10, endHz: 100, sweep: 'linear' }, offsetTicks: 0, durationTicks: 1, gain: 1 },
  ];
  for (const s of bad) assert.throws(() => renderVoice(s, ctx), RangeError);
  assert.throws(() => renderVoice(noise('white', 'bad id!'), ctx), TypeError);
  assert.throws(() => renderVoice(noise('white'), { ...ctx, documentSeed: -1 }), RangeError);
  // Pitched frequency clamps below .45*Fs rather than aliasing past Nyquist.
  const hi = renderVoice(osc('sine', 16000, { pitchRatio: 4 }), ctx).samples;
  assert.ok(hi.every(Number.isFinite));
});

test('budget is checked before allocation', () => {
  assert.equal(assertVoiceBudget([osc('sine', 440), noise('white')]), 48000 + 24000);
  assert.throws(() => assertVoiceBudget(Array.from({ length: MAX_VOICES + 1 }, () => osc('sine', 440, { durationTicks: 1 }))), RangeError);
  assert.throws(() => assertVoiceBudget(Array.from({ length: 11 }, () => osc('sine', 440, { durationTicks: 600 }))), RangeError);
});
