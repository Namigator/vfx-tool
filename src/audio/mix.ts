// Deterministic stereo mix and fixed soft limiter (plan24 Amendment A3).
// Pure functions only: no Web Audio device, DOM or global state. Layers are never normalized independently.
import { AUDIO_SAMPLE_RATE, MAX_TOTAL_VOICE_SAMPLES, MAX_VOICES } from './synthesis.ts';

export const MIX_SAMPLE_RATE = AUDIO_SAMPLE_RATE;
export const MIN_INPUT_GAIN = 0;
export const MAX_INPUT_GAIN = 2;
export const MIN_MASTER_GAIN = 0;
export const MAX_MASTER_GAIN = 1;
export const MAX_MIX_INPUTS = MAX_VOICES;
export const MAX_MIX_INPUT_SAMPLES = MAX_TOTAL_VOICE_SAMPLES;
export const MAX_MIX_FRAMES = MAX_TOTAL_VOICE_SAMPLES;
/** Limiter ceiling: -1 dBFS (may be reached exactly after floating-point saturation). */
export const LIMITER_CEILING = Math.pow(10, -1 / 20);
/** Samples at or below this magnitude pass unchanged (about -3 dBFS). */
export const LIMITER_KNEE = 0.7;
/** Pre-limiter peak above this (about +6 dB over the ceiling) is reported as severe limiting. */
export const SEVERE_LIMITING_PEAK = 2 * LIMITER_CEILING;

export interface MixInput { startSample: number; samples: Float32Array; gain: number; pan: number }

export interface MixResult {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  prePeak: number;
  postPeak: number;
  limitedSamples: number;
  limitedFraction: number;
  severeLimiting: boolean;
}

function assertRange(value: unknown, min: number, max: number, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a finite number in [${min}, ${max}].`);
  }
}

/** Equal-power pan; endpoints are exact so hard-panned inputs leave the other channel bit-silent. */
export function panGains(pan: number): [number, number] {
  assertRange(pan, -1, 1, 'pan');
  if (pan === -1) return [1, 0];
  if (pan === 1) return [0, 1];
  const theta = (pan + 1) * Math.PI / 4;
  return [Math.cos(theta), Math.sin(theta)];
}

/** Fixed soft limiter: identity up to the knee, tanh shoulder that asymptotically approaches the ceiling. */
export function softLimit(x: number): number {
  const a = Math.abs(x);
  if (a <= LIMITER_KNEE) return x;
  const range = LIMITER_CEILING - LIMITER_KNEE;
  const y = LIMITER_KNEE + range * Math.tanh((a - LIMITER_KNEE) / range);
  return x < 0 ? -y : y;
}

/** Validates every input and the frame/sample caps before any buffer is allocated. Returns frame count. */
export function assertMixBudget(inputs: readonly MixInput[], masterGain: number): number {
  if (!Array.isArray(inputs)) throw new TypeError('inputs must be an array.');
  if (inputs.length > MAX_MIX_INPUTS) throw new RangeError(`mix input count exceeds ${MAX_MIX_INPUTS}.`);
  assertRange(masterGain, MIN_MASTER_GAIN, MAX_MASTER_GAIN, 'masterGain');
  let total = 0;
  let frames = 0;
  for (const input of inputs) {
    if (!(input.samples instanceof Float32Array)) throw new TypeError('samples must be a Float32Array.');
    if (!Number.isInteger(input.startSample) || input.startSample < 0) throw new RangeError('startSample must be a non-negative integer.');
    assertRange(input.gain, MIN_INPUT_GAIN, MAX_INPUT_GAIN, 'gain');
    panGains(input.pan);
    total += input.samples.length;
    frames = Math.max(frames, input.startSample + input.samples.length);
  }
  if (total > MAX_MIX_INPUT_SAMPLES) throw new RangeError(`total input samples exceed ${MAX_MIX_INPUT_SAMPLES}.`);
  if (frames > MAX_MIX_FRAMES) throw new RangeError(`mix length exceeds ${MAX_MIX_FRAMES} frames.`);
  for (const input of inputs) {
    for (let n = 0; n < input.samples.length; n++) {
      if (!Number.isFinite(input.samples[n])) throw new RangeError('input contains a nonfinite sample.');
    }
  }
  return frames;
}

/**
 * Sums inputs in array order at float64 precision, applies master gain then the fixed soft limiter.
 * Length is max(startSample + length) over inputs (0 when empty).
 */
export function mixStereo(inputs: readonly MixInput[], masterGain = 1): MixResult {
  const frames = assertMixBudget(inputs, masterGain);
  const accL = new Float64Array(frames);
  const accR = new Float64Array(frames);
  for (const input of inputs) {
    const [pl, pr] = panGains(input.pan);
    const gl = input.gain * pl;
    const gr = input.gain * pr;
    const s = input.samples;
    const o = input.startSample;
    for (let n = 0; n < s.length; n++) {
      accL[o + n] += s[n] * gl;
      accR[o + n] += s[n] * gr;
    }
  }
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  let prePeak = 0;
  let postPeak = 0;
  let limitedSamples = 0;
  const channels: [Float64Array, Float32Array][] = [[accL, left], [accR, right]];
  for (const [acc, out] of channels) {
    for (let n = 0; n < frames; n++) {
      const v = acc[n] * masterGain + 0; // +0 canonicalizes -0 so silence is bit-identical
      if (!Number.isFinite(v)) throw new RangeError('mix produced a nonfinite sample.');
      const a = Math.abs(v);
      if (a > prePeak) prePeak = a;
      if (a > LIMITER_KNEE) limitedSamples++;
      out[n] = softLimit(v);
      const p = Math.abs(out[n]);
      if (p > postPeak) postPeak = p;
    }
  }
  return { sampleRate: MIX_SAMPLE_RATE, left, right, prePeak, postPeak, limitedSamples,
    limitedFraction: frames === 0 ? 0 : limitedSamples / (2 * frames),
    severeLimiting: prePeak > SEVERE_LIMITING_PEAK };
}

export function peakToDbfs(peak: number): number {
  return peak <= 0 ? -Infinity : 20 * Math.log10(peak);
}

/** Comfortable listening level: the loudest 400 ms window of a mix plays back at about -20 dBFS RMS. */
export const COMFORT_TARGET_RMS = Math.pow(10, -20 / 20);
/** ...and no sample above -6 dBFS. */
export const COMFORT_PEAK_CEILING = Math.pow(10, -6 / 20);

/**
 * Playback gain (0..1) that brings a mix to a comfortable level: the user reported effect sounds that "hurt my
 * ears" - sustained near-full-scale noise passes the -1 dBFS peak limiter untouched. Measures the loudest 400 ms
 * window (RMS over both channels) and the peak, and only ever turns down (never boosts quiet sounds). Pure.
 */
export function comfortGain(mix: Pick<MixResult, 'left' | 'right' | 'sampleRate'>): number {
  const { left, right } = mix, n = left.length;
  if (!n) return 1;
  const win = Math.max(1, Math.round(mix.sampleRate * 0.4));
  let sum = 0, loudest = 0, peak = 0;
  const sq = (i: number) => (left[i] * left[i] + right[i] * right[i]) / 2;
  for (let i = 0; i < n; i++) {
    sum += sq(i);
    if (i >= win) sum -= sq(i - win);
    const rms = Math.sqrt(Math.max(0, sum) / Math.min(win, i + 1));
    if (i >= Math.min(win, n) - 1 && rms > loudest) loudest = rms;
    const p = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (p > peak) peak = p;
  }
  const byLoudness = loudest > 0 ? COMFORT_TARGET_RMS / loudest : 1;
  const byPeak = peak > 0 ? COMFORT_PEAK_CEILING / peak : 1;
  return Math.min(1, byLoudness, byPeak);
}
