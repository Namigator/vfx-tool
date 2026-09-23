import type { Recipe } from '../core/types.ts';

const TAU = Math.PI * 2;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const smooth = (value: number) => { const x = clamp(value, 0, 1); return x * x * (3 - 2 * x); };

/** Pure, seeded mono synthesis. Times are seconds; the discharge begins at charge. */
export function synthesize(recipe: Recipe, sampleRate = 48000): Float32Array {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Sample rate must be an integer from 8000 to 192000.');
  const p = recipe.parameters;
  const charge = clamp(p.charge, 0, 30), active = clamp(p.active, 0, 30), decay = clamp(p.decay, 0, 30);
  const length = charge + active + decay;
  const samples = new Float32Array(Math.ceil(length * sampleRate));
  const volume = clamp(p.volume, 0, 1), pitch = clamp(p.pitch, 0.5, 2);
  if (volume === 0 || length === 0) return samples;
  let seed = recipe.seed >>> 0;
  const random = () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let x = seed;
    x = Math.imul(x ^ x >>> 15, x | 1);
    x ^= x + Math.imul(x ^ x >>> 7, x | 61);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
  let low = 0, mid = 0, phase = 0, overtone = 0, crackle = 0;
  const lowAlpha = 1 - Math.exp(-TAU * 160 * pitch / sampleRate);
  const midAlpha = 1 - Math.exp(-TAU * 1600 * pitch / sampleRate);
  const intensity = clamp(p.intensity, 0, 3);
  const familyHz = { lightning: 72, fire: 48, ice: 820, water: 190, wind: 105, earth: 36, light: 330, shadow: 55, poison: 125, energy: 180 };
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate, u = Math.max(0, t - charge);
    const charged = charge > 0 ? smooth(t / charge) : 0;
    const released = t >= charge;
    const attack = smooth(u / 0.007);
    const tail = u <= active ? 1 : decay > 0 ? Math.pow(1 - smooth((u - active) / decay), 1.4) : 0;
    const bodyEnvelope = released ? attack * tail : 0;
    const onset = Math.exp(-u * 24);
    const noise = random() * 2 - 1;
    low += lowAlpha * (noise - low);
    mid += midAlpha * (noise - mid);
    const hiss = noise - mid;
    crackle *= Math.exp(-110 / sampleRate);
    if (random() < (30 + 24 * intensity) / sampleRate) crackle = random() * 2 - 1;
    const fundamental = familyHz[recipe.family] * pitch;
    const chargeHz = (180 + 620 * charged) * pitch;
    const sweep = recipe.family === 'ice' ? 1 + 0.2 * Math.exp(-u * 4) : 1 + 1.3 * Math.exp(-u * 15);
    phase += TAU * (released ? fundamental * sweep : chargeHz) / sampleRate;
    overtone += TAU * fundamental * 2.756 / sampleRate;
    const tone = Math.sin(phase), bell = Math.sin(overtone), wobble = Math.sin(TAU * u * 7 * pitch);
    let body = 0;
    switch (recipe.family) {
      case 'lightning': body = hiss * (0.26 + onset * 0.72) + low * 2.7 + crackle * 0.72 + tone * 0.14 * Math.exp(-u * 5); break;
      case 'fire': body = low * 3.4 + mid * (0.5 + 0.25 * wobble) + crackle * 0.62; break;
      case 'ice': body = (tone * 0.4 + bell * 0.25 + Math.sin(phase * 3) * 0.12) * Math.exp(-u * 2.1) + hiss * 0.17 + crackle * 0.26; break;
      case 'water': body = low * 2 + mid * 0.7 + Math.sin(phase + 4 * Math.sin(TAU * u * 3)) * 0.22 * Math.pow(0.5 + 0.5 * wobble, 4); break;
      case 'wind': body = (mid - low) * (1.3 + 0.6 * Math.sin(TAU * u * 1.3)) + low * 1.3 + tone * 0.035; break;
      case 'earth': body = low * 4 + tone * 0.48 * Math.exp(-u * 3) + mid * 0.55 * Math.exp(-u * 7) + crackle * 0.3; break;
      case 'light': body = (tone * 0.32 + bell * 0.2 + Math.sin(phase * 1.5) * 0.2) * (0.7 + 0.3 * Math.cos(TAU * u * 1.5)) + mid * 0.12; break;
      case 'shadow': body = tone * (0.35 + 0.15 * wobble) + low * 2.8 + Math.sin(phase * 0.51) * 0.25 + hiss * 0.06; break;
      case 'poison': body = mid * 0.45 + hiss * 0.12 + Math.sin(phase + 5 * Math.sin(TAU * u * 4.1)) * 0.3 * Math.pow(0.5 + 0.5 * wobble, 3) + crackle * 0.3; break;
      case 'energy': body = (tone * 0.34 + Math.sin(phase * 2 + 2 * wobble) * 0.23) * (0.7 + 0.3 * Math.sin(TAU * u * 24)) + hiss * 0.18 + low * 1.2; break;
    }
    // Quiet rising anticipation stops at release; a short crossfade avoids a click.
    const chargeEnvelope = !released && charge > 0 ? charged * (1 - smooth((t - charge + 0.012) / 0.012)) : 0;
    const anticipation = (tone * 0.085 + mid * 0.09) * chargeEnvelope;
    const edgeFade = smooth(t / 0.006) * smooth((length - t - 1 / sampleRate) / 0.014);
    // A soft limiter supplies headroom even at maximum intensity. Volume is applied once.
    samples[i] = Math.tanh((body * bodyEnvelope + anticipation) * (0.8 + intensity * 0.16)) * 0.84 * volume * edgeFade;
  }
  if (samples.length) { samples[0] = 0; samples[samples.length - 1] = 0; }
  return samples;
}

/** Standard little-endian mono PCM16 WAV, suitable for downloading and engine import. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Invalid WAV sample rate.');
  const result = new ArrayBuffer(44 + samples.length * 2), view = new DataView(result);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, result.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = clamp(samples[i], -1, 1);
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return result;
}

/** Call unlock from a user gesture. Importing this module never accesses browser globals. */
export class EffectAudio {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private cache: { key: string; buffer: AudioBuffer } | null = null;
  private startedAt = 0;
  private offset = 0;
  get position(): number | null { return this.source && this.context ? Math.min(this.source.buffer?.duration ?? Infinity, this.offset + (this.context.currentTime - this.startedAt)) : null; }
  get state(): string { return this.context?.state ?? 'locked'; }
  async unlock(): Promise<void> {
    if (!this.context || this.context.state === 'closed') { this.context = new AudioContext(); this.cache = null; }
    if (this.context.state === 'suspended') await this.context.resume();
  }
  play(recipe: Recipe, offset = 0): void {
    this.stop();
    const context = this.context;
    if (!context || context.state !== 'running') return;
    const key = JSON.stringify([recipe.family, recipe.seed, recipe.parameters]);
    if (this.cache?.key !== key) {
      const samples = synthesize(recipe, context.sampleRate);
      if (!samples.length) return;
      const buffer = context.createBuffer(1, samples.length, context.sampleRate);
      buffer.getChannelData(0).set(samples);
      this.cache = { key, buffer };
    }
    const buffer = this.cache.buffer;
    const position = Math.max(0, Number.isFinite(offset) ? offset : 0);
    if (position >= buffer.duration) return;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer;
    source.connect(gain); gain.connect(context.destination);
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(1, context.currentTime + 0.005);
    source.onended = () => { source.disconnect(); gain.disconnect(); if (this.source === source) { this.source = null; this.gain = null; } };
    this.source = source; this.gain = gain;
    this.startedAt = context.currentTime; this.offset = position;
    source.start(0, position);
  }
  stop(): void {
    const source = this.source, gain = this.gain, context = this.context;
    this.source = null; this.gain = null;
    if (!source || !context) return;
    if (gain) { gain.gain.cancelScheduledValues(context.currentTime); gain.gain.setValueAtTime(gain.gain.value, context.currentTime); gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.008); }
    source.stop(context.currentTime + 0.01);
  }
  dispose(): void {
    this.stop();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null; this.cache = null;
  }
}
