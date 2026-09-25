// Deterministic SFX synthesis core (plan11 "Nodes", plan24 "Audio source definitions").
// Pure functions only: no Web Audio device, DOM, assets or global state.
// Random identity follows runtime/random.ts and plan24 Amendment A2; object IDs are never part of a key.
import { assertStoredId, assertUint32, mulberry32First, randomTupleHash } from '../runtime/random.ts';

export const AUDIO_SAMPLE_RATE = 48000;
export const TICKS_PER_SECOND = 60;
export const SAMPLES_PER_TICK = AUDIO_SAMPLE_RATE / TICKS_PER_SECOND; // 800, exact
export const MIN_DURATION_TICKS = 1;
export const MAX_DURATION_TICKS = 600;
export const MAX_OFFSET_TICKS = 36000; // frozen: 10 minutes of cue offset
export const MIN_FREQUENCY_HZ = 20;
export const MAX_FREQUENCY_HZ = 16000;
export const MAX_RENDER_FREQUENCY_HZ = 0.45 * AUDIO_SAMPLE_RATE; // plan24 clamp after pitch ratio
export const MIN_GAIN = 0;
export const MAX_GAIN = 2;
export const MIN_PITCH_RATIO = 0.25;
export const MAX_PITCH_RATIO = 4;
export const MIN_PULSE_DUTY = 0.05;
export const MAX_PULSE_DUTY = 0.95;
export const BOUNDARY_RAMP_SAMPLES = 240; // 5 ms linear fade at each voice boundary
export const MAX_VOICE_SAMPLES = MAX_DURATION_TICKS * SAMPLES_PER_TICK;
export const MAX_VOICES = 64;
export const MAX_TOTAL_VOICE_SAMPLES = 4_800_000; // 100 s of voice audio per render
export const PINK_ROWS = 16;
/** Golden-ratio increment: n -> (laneSeed + n*G) mod 2^32 is a bijection, so lane samples never repeat a seed. */
export const SAMPLE_SEED_INCREMENT = 0x9e3779b9;

export type OscillatorWaveform = 'sine' | 'triangle' | 'saw' | 'pulse';
export type NoiseColor = 'white' | 'pink' | 'brown';
export type ChirpSweep = 'linear' | 'exponential';

export interface OscillatorSource { kind: 'oscillator'; waveform: OscillatorWaveform; frequencyHz: number; pulseDuty?: number }
export interface NoiseSource { kind: 'noise'; color: NoiseColor; randomStreamId: string }
export interface ChirpSource { kind: 'chirp'; startHz: number; endHz: number; sweep: ChirpSweep }
export type SynthSource = OscillatorSource | NoiseSource | ChirpSource;

export interface VoiceSpec {
  source: SynthSource;
  offsetTicks: number;
  durationTicks: number;
  gain: number;
  pitchRatio?: number;
}

/** Random identity for noise voices; eventRandomKey/entityOrdinal come from the cue schedule, never object IDs. */
export interface VoiceRandomContext { documentSeed: number; eventRandomKey: string; entityOrdinal: number }

export interface RenderedVoice { startSample: number; samples: Float32Array }

function assertRange(value: unknown, min: number, max: number, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a finite number in [${min}, ${max}].`);
  }
}

function assertIntRange(value: unknown, min: number, max: number, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}].`);
  }
}

export function ticksToSamples(ticks: number): number {
  return Math.round((ticks / TICKS_PER_SECOND) * AUDIO_SAMPLE_RATE);
}

export function validateVoice(spec: VoiceSpec): void {
  assertIntRange(spec.offsetTicks, 0, MAX_OFFSET_TICKS, 'offsetTicks');
  assertIntRange(spec.durationTicks, MIN_DURATION_TICKS, MAX_DURATION_TICKS, 'durationTicks');
  assertRange(spec.gain, MIN_GAIN, MAX_GAIN, 'gain');
  if (spec.pitchRatio !== undefined) assertRange(spec.pitchRatio, MIN_PITCH_RATIO, MAX_PITCH_RATIO, 'pitchRatio');
  const s = spec.source;
  switch (s.kind) {
    case 'oscillator':
      if (!['sine', 'triangle', 'saw', 'pulse'].includes(s.waveform)) throw new TypeError('waveform is not supported.');
      assertRange(s.frequencyHz, MIN_FREQUENCY_HZ, MAX_FREQUENCY_HZ, 'frequencyHz');
      if (s.pulseDuty !== undefined) assertRange(s.pulseDuty, MIN_PULSE_DUTY, MAX_PULSE_DUTY, 'pulseDuty');
      break;
    case 'noise':
      if (!['white', 'pink', 'brown'].includes(s.color)) throw new TypeError('noise color is not supported.');
      assertStoredId(s.randomStreamId, 'randomStreamId');
      break;
    case 'chirp':
      if (s.sweep !== 'linear' && s.sweep !== 'exponential') throw new TypeError('sweep is not supported.');
      assertRange(s.startHz, MIN_FREQUENCY_HZ, MAX_FREQUENCY_HZ, 'startHz');
      assertRange(s.endHz, MIN_FREQUENCY_HZ, MAX_FREQUENCY_HZ, 'endHz');
      break;
    default:
      throw new TypeError('source kind is not supported.');
  }
}

/** Validates every voice and the voice/sample caps before any buffer is allocated. Returns total samples. */
export function assertVoiceBudget(specs: readonly VoiceSpec[]): number {
  if (specs.length > MAX_VOICES) throw new RangeError(`voice count exceeds ${MAX_VOICES}.`);
  let total = 0;
  for (const spec of specs) {
    validateVoice(spec);
    total += ticksToSamples(spec.durationTicks);
  }
  if (total > MAX_TOTAL_VOICE_SAMPLES) throw new RangeError(`total voice samples exceed ${MAX_TOTAL_VOICE_SAMPLES}.`);
  return total;
}

function clampRenderHz(hz: number): number {
  return Math.min(hz, MAX_RENDER_FREQUENCY_HZ);
}

/** plan24 PolyBLEP correction for normalized phase x and increment dt. */
export function polyBlep(x: number, dt: number): number {
  if (x < dt) { const t = x / dt; return 2 * t - t * t - 1; }
  if (x > 1 - dt) { const t = (x - 1) / dt; return t * t + 2 * t + 1; }
  return 0;
}

function oscillatorSample(waveform: OscillatorWaveform, x: number, dt: number, duty: number): number {
  switch (waveform) {
    case 'sine': return Math.sin(2 * Math.PI * x);
    case 'triangle': return 4 * Math.abs(x - 0.5) - 1; // +1 at x=0, -1 at x=.5
    case 'saw': return 2 * x - 1 - polyBlep(x, dt);
    case 'pulse': {
      const naive = x < duty ? 1 : -1;
      let x2 = x + 1 - duty;
      if (x2 >= 1) x2 -= 1;
      // plan24 A2: overlapping edge windows (dt near duty or 1-duty) can reach |3|; hard clamp to [-1,1].
      return Math.max(-1, Math.min(1, naive + polyBlep(x, dt) - polyBlep(x2, dt)));
    }
  }
}

function laneSeed(ctx: VoiceRandomContext, streamId: string, propertyKey: string): number {
  return randomTupleHash({
    documentSeed: ctx.documentSeed, randomStreamId: streamId, eventRandomKey: ctx.eventRandomKey,
    entityOrdinal: ctx.entityOrdinal, propertyKey, sampleOrdinal: 0,
  });
}

/** Bipolar white value in [-1,1) for lane sample n. */
function laneWhite(seed: number, n: number): number {
  return 2 * mulberry32First((seed + Math.imul(n, SAMPLE_SEED_INCREMENT)) >>> 0) - 1;
}

function trailingZeros(n: number): number {
  return 31 - Math.clz32(n & -n);
}

function fillNoise(out: Float32Array, color: NoiseColor, streamId: string, ctx: VoiceRandomContext): void {
  const white = laneSeed(ctx, streamId, 'noiseWhite');
  if (color === 'white') {
    for (let n = 0; n < out.length; n++) out[n] = laneWhite(white, n);
  } else if (color === 'brown') {
    let b = 0;
    for (let n = 0; n < out.length; n++) {
      b = Math.max(-1, Math.min(1, 0.98 * b + 0.02 * laneWhite(white, n)));
      out[n] = b;
    }
  } else {
    const rowSeeds = new Array<number>(PINK_ROWS);
    const rows = new Float64Array(PINK_ROWS);
    let sum = 0;
    for (let r = 0; r < PINK_ROWS; r++) {
      rowSeeds[r] = laneSeed(ctx, streamId, `noisePinkRow${r}`);
      rows[r] = laneWhite(rowSeeds[r], 0);
      sum += rows[r];
    }
    for (let n = 0; n < out.length; n++) {
      if (n >= 1) {
        const r = trailingZeros(n);
        if (r < PINK_ROWS) {
          const v = laneWhite(rowSeeds[r], n);
          sum += v - rows[r];
          rows[r] = v;
        }
      }
      out[n] = (sum + laneWhite(white, n)) / (PINK_ROWS + 1);
    }
  }
}

/** Instantaneous chirp frequency at normalized voice time u in [0,1]. */
export function chirpFrequency(source: ChirpSource, u: number): number {
  if (source.sweep === 'linear') return source.startHz + (source.endHz - source.startHz) * u;
  return source.startHz * Math.pow(source.endHz / source.startHz, u);
}

/** Linear fade-in/out over BOUNDARY_RAMP_SAMPLES (halved for very short voices); endpoints reach exactly 0. */
export function applyBoundaryRamps(buffer: Float32Array): void {
  const len = buffer.length;
  const ramp = Math.min(BOUNDARY_RAMP_SAMPLES, Math.floor(len / 2));
  if (ramp < 1) return;
  for (let i = 0; i < ramp; i++) {
    const w = i / ramp;
    buffer[i] *= w;
    buffer[len - 1 - i] *= w;
  }
}

/**
 * Renders one mono voice at 48 kHz. Length is exactly durationTicks*800 samples;
 * startSample = offsetTicks*800. Phase starts at 0 and is continuous within the voice.
 */
export function renderVoice(spec: VoiceSpec, ctx: VoiceRandomContext): RenderedVoice {
  validateVoice(spec);
  assertUint32(ctx.documentSeed, 'documentSeed');
  if (typeof ctx.eventRandomKey !== 'string') throw new TypeError('eventRandomKey must be a string.');
  assertUint32(ctx.entityOrdinal, 'entityOrdinal');
  const length = ticksToSamples(spec.durationTicks);
  if (length > MAX_VOICE_SAMPLES) throw new RangeError('voice exceeds sample budget.');
  const out = new Float32Array(length);
  const pitch = spec.pitchRatio ?? 1;
  const s = spec.source;
  if (s.kind === 'oscillator') {
    const dt = clampRenderHz(s.frequencyHz * pitch) / AUDIO_SAMPLE_RATE;
    const duty = s.pulseDuty ?? 0.5;
    let x = 0;
    for (let n = 0; n < length; n++) {
      out[n] = oscillatorSample(s.waveform, x, dt, duty);
      x += dt;
      if (x >= 1) x -= 1;
    }
  } else if (s.kind === 'chirp') {
    let x = 0;
    const span = Math.max(1, length - 1);
    for (let n = 0; n < length; n++) {
      out[n] = Math.sin(2 * Math.PI * x);
      x += clampRenderHz(chirpFrequency(s, n / span) * pitch) / AUDIO_SAMPLE_RATE;
      x -= Math.floor(x);
    }
  } else {
    fillNoise(out, s.color, s.randomStreamId, ctx);
  }
  for (let n = 0; n < length; n++) {
    const v = out[n] * spec.gain;
    if (!Number.isFinite(v)) throw new RangeError('voice rendered a nonfinite sample.');
    out[n] = v;
  }
  applyBoundaryRamps(out);
  return { startSample: ticksToSamples(spec.offsetTicks), samples: out };
}
