import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITER_CEILING, LIMITER_KNEE, MAX_MIX_FRAMES, MAX_MIX_INPUTS, mixStereo, panGains, peakToDbfs, softLimit, type MixInput,
} from '../src/audio/mix.ts';
import { encodeWavPcm16Stereo, floatToPcm16 } from '../src/audio/wav.ts';

const f32 = (...v: number[]) => new Float32Array(v);
const input = (samples: Float32Array, startSample = 0, gain = 1, pan = -1): MixInput => ({ samples, startSample, gain, pan });

test('ordered summation below the knee is exact and hard pan leaves the other channel silent', () => {
  const r = mixStereo([input(f32(0.25, 0.125, -0.25)), input(f32(0.125, 0.25, 0), 0, 0.5)]);
  assert.deepEqual([...r.left], [0.3125, 0.25, -0.25]);
  assert.deepEqual([...r.right], [0, 0, 0]);
  assert.equal(r.prePeak, 0.3125);
  assert.equal(r.postPeak, 0.3125);
  assert.equal(r.limitedSamples, 0);
  assert.equal(r.limitedFraction, 0);
  assert.equal(r.severeLimiting, false);
  assert.equal(r.sampleRate, 48000);
});

test('equal-power pan', () => {
  assert.deepEqual(panGains(1), [0, 1]);
  const [l, r] = panGains(0);
  assert.ok(Math.abs(l - Math.SQRT1_2) < 1e-15 && Math.abs(r - Math.SQRT1_2) < 1e-15);
  for (const p of [-0.7, -0.2, 0.3, 0.9]) {
    const [a, b] = panGains(p);
    assert.ok(Math.abs(a * a + b * b - 1) < 1e-12);
  }
  const m = mixStereo([input(f32(0.5), 0, 1, 1)]);
  assert.equal(m.left[0], 0);
  assert.equal(m.right[0], 0.5);
});

test('startSample offsets place audio and empty/zero mixes are silent', () => {
  const r = mixStereo([input(f32(0.5, 0.5), 3)]);
  assert.deepEqual([...r.left], [0, 0, 0, 0.5, 0.5]);
  const empty = mixStereo([]);
  assert.equal(empty.left.length, 0);
  assert.equal(empty.postPeak, 0);
  const muted = mixStereo([input(f32(0.9, -0.9))], 0);
  assert.deepEqual([...muted.left], [0, 0]);
  assert.equal(muted.prePeak, 0);
  assert.equal(peakToDbfs(0), -Infinity);
});

test('master gain scales without per-layer normalization', () => {
  const r = mixStereo([input(f32(0.4)), input(f32(0.2))], 0.5);
  assert.ok(Math.abs(r.left[0] - 0.3) < 1e-7);
});

test('soft limiter keeps output <= -1 dBFS, is monotonic, and reports peaks', () => {
  assert.equal(softLimit(LIMITER_KNEE), LIMITER_KNEE);
  let prev = 0;
  for (let x = 0; x <= 20; x += 0.01) {
    const y = softLimit(x);
    assert.ok(y >= prev && y <= LIMITER_CEILING);
    assert.equal(softLimit(-x), -y);
    prev = y;
  }
  const loud = mixStereo([input(f32(1, 1, 1)), input(f32(0.9, 0.9, 0.9), 0, 2)]);
  assert.ok(Math.abs(loud.prePeak - 2.8) < 1e-6);
  assert.ok(loud.postPeak < LIMITER_CEILING);
  assert.ok(peakToDbfs(loud.postPeak) <= -1);
  assert.equal(loud.limitedSamples, 3);
  assert.equal(loud.limitedFraction, 0.5);
  assert.equal(loud.severeLimiting, true);
  const mild = mixStereo([input(f32(0.95))]);
  assert.equal(mild.severeLimiting, false);
  assert.equal(mild.limitedSamples, 1);
  assert.ok(mild.postPeak < LIMITER_CEILING && mild.postPeak > LIMITER_KNEE);
});

test('mix is deterministic', () => {
  const s = f32(0.3, -0.8, 0.95, 0.1);
  const a = mixStereo([input(s, 1, 1.3, 0.2), input(s, 0, 0.7, -0.4)], 0.8);
  const b = mixStereo([input(s, 1, 1.3, 0.2), input(s, 0, 0.7, -0.4)], 0.8);
  assert.deepEqual(a, b);
});

test('invalid inputs are rejected before mixing', () => {
  assert.throws(() => mixStereo([input(f32(Number.NaN))]), RangeError);
  assert.throws(() => mixStereo([input(f32(Infinity))]), RangeError);
  assert.throws(() => mixStereo([input(f32(0), -1)]), RangeError);
  assert.throws(() => mixStereo([input(f32(0), 0.5)]), RangeError);
  assert.throws(() => mixStereo([input(f32(0), 0, 2.1)]), RangeError);
  assert.throws(() => mixStereo([input(f32(0), 0, 1, 1.5)]), RangeError);
  assert.throws(() => mixStereo([input(f32(0), 0, 1, Number.NaN)]), RangeError);
  assert.throws(() => mixStereo([], 1.1), RangeError);
  assert.throws(() => mixStereo([{ samples: [0] as unknown as Float32Array, startSample: 0, gain: 1, pan: 0 }]), TypeError);
  const many = Array.from({ length: MAX_MIX_INPUTS + 1 }, () => input(f32(0)));
  assert.throws(() => mixStereo(many), RangeError);
  assert.throws(() => mixStereo([input(f32(0), MAX_MIX_FRAMES)]), /mix length/);
});

test('PCM16 conversion clips deterministically', () => {
  assert.equal(floatToPcm16(0), 0);
  assert.equal(floatToPcm16(1), 32767);
  assert.equal(floatToPcm16(-1), -32767);
  assert.equal(floatToPcm16(3), 32767);
  assert.equal(floatToPcm16(-3), -32767);
  assert.equal(floatToPcm16(0.5), 16384);
  assert.equal(floatToPcm16(-0.5), -16384);
  assert.throws(() => floatToPcm16(Number.NaN), RangeError);
});

test('WAV header and interleaved little-endian data decode correctly', () => {
  const bytes = encodeWavPcm16Stereo(f32(1, -1, 0), f32(0.5, 2, -0.5));
  assert.equal(bytes.length, 44 + 12);
  const v = new DataView(bytes.buffer);
  const ascii = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  assert.equal(ascii(0), 'RIFF');
  assert.equal(v.getUint32(4, true), 36 + 12);
  assert.equal(ascii(8), 'WAVE');
  assert.equal(ascii(12), 'fmt ');
  assert.equal(v.getUint32(16, true), 16);
  assert.equal(v.getUint16(20, true), 1);
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(28, true), 192000);
  assert.equal(v.getUint16(32, true), 4);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(ascii(36), 'data');
  assert.equal(v.getUint32(40, true), 12);
  const pcm = [0, 1, 2, 3, 4, 5].map((i) => v.getInt16(44 + i * 2, true));
  assert.deepEqual(pcm, [32767, 16384, -32767, 32767, 0, -16384]);
  assert.deepEqual([...bytes.subarray(44, 48)], [0xff, 0x7f, 0x00, 0x40]);
  assert.throws(() => encodeWavPcm16Stereo(f32(0), f32()), RangeError);
  assert.throws(() => encodeWavPcm16Stereo(f32(Number.NaN), f32(0)), RangeError);
});

test('mix to WAV round trip stays under -1 dBFS', () => {
  const r = mixStereo([input(f32(1.5, -1.5), 0, 2, 0)]);
  const v = new DataView(encodeWavPcm16Stereo(r.left, r.right).buffer);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(v.getInt16(44 + i * 2, true)) <= Math.round(LIMITER_CEILING * 32767));
});

test('comfortGain: loud sustained noise is turned down to about -20 dBFS RMS; quiet sounds are never boosted', async () => {
  const { comfortGain, COMFORT_TARGET_RMS, COMFORT_PEAK_CEILING } = await import('../src/audio/mix.ts');
  const n = 48000, loud = { sampleRate: 48000, left: new Float32Array(n), right: new Float32Array(n) };
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  for (let i = 0; i < n; i++) { loud.left[i] = 0.89 * rnd(); loud.right[i] = 0.89 * rnd(); }
  const g = comfortGain(loud);
  assert.ok(g < 0.25, `loud noise gain ${g}`);
  let sum = 0; for (let i = 0; i < n; i++) sum += ((loud.left[i] * g) ** 2 + (loud.right[i] * g) ** 2) / 2;
  assert.ok(Math.abs(Math.sqrt(sum / n) - COMFORT_TARGET_RMS) < 0.01, 'played at the comfort level');
  const quiet = { sampleRate: 48000, left: new Float32Array(n).fill(0.01), right: new Float32Array(n).fill(0.01) };
  assert.equal(comfortGain(quiet), 1);
  const spike = { sampleRate: 48000, left: new Float32Array(n), right: new Float32Array(n) };
  spike.left[100] = 0.95;
  assert.ok(Math.abs(comfortGain(spike) - COMFORT_PEAK_CEILING / 0.95) < 1e-6, 'a lone peak is held under -6 dBFS');
  assert.equal(comfortGain({ sampleRate: 48000, left: new Float32Array(0), right: new Float32Array(0) }), 1);
});
