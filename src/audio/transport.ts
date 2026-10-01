// Live browser audio transport for an already rendered canonical mix.
// Depends only on a minimal AudioContext-like interface so it can be tested
// with fakes; no DOM, React or Three imports.
import { comfortGain, type MixResult } from './mix.ts';

export const TRANSPORT_SAMPLE_RATE = 48000;
export const SCHEDULE_LEAD_SECONDS = 0.05;

export interface AudioParamLike { value: number }
export interface AudioNodeLike { connect(destination: unknown): unknown; disconnect(): void }
export interface GainNodeLike extends AudioNodeLike { gain: AudioParamLike }
export interface AudioBufferLike { getChannelData(channel: number): Float32Array }
export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  onended: (() => void) | null;
  start(when: number, offset: number): void;
  stop(): void;
}
export interface OutputTimestampLike { contextTime?: number; performanceTime?: number }
export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  createGain(): GainNodeLike;
  createBufferSource(): BufferSourceLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  getOutputTimestamp?(): OutputTimestampLike;
}

export type TransportStatus = 'empty' | 'ready' | 'playing' | 'suspended' | 'disposed';

export type PlayResult =
  | {
    ok: true;
    revision: string;
    /** Context time at which sample `offsetSample` is scheduled to play. */
    startTime: number;
    offsetSample: number;
    /** Context time corresponding to sample 0 (cast origin). */
    castOrigin: number;
    /** performance.now() estimate of startTime, if getOutputTimestamp is usable; latency uncertainty otherwise. */
    startPerformanceTime: number | null;
  }
  | { ok: false; reason: 'no-buffer' | 'suspended' | 'resume-rejected' | 'stale' | 'disposed' | 'offset-out-of-range' };

export class AudioTransport {
  private readonly ctx: AudioContextLike;
  private readonly previewGain: GainNodeLike;
  private buffer: AudioBufferLike | null = null;
  private frames = 0;
  private revision: string | null = null;
  private source: BufferSourceLike | null = null;
  private generation = 0;
  private disposed = false;
  private muted = false;
  /** Comfort level for the current mix (comfortGain): loud mixes play turned down, quiet ones unchanged. */
  private level = 1;

  constructor(ctx: AudioContextLike) {
    this.ctx = ctx;
    this.previewGain = ctx.createGain();
    this.previewGain.gain.value = 1;
    this.previewGain.connect(ctx.destination);
  }

  get currentRevision(): string | null { return this.revision; }
  get isMuted(): boolean { return this.muted; }

  /** Playing only when a source is scheduled AND the device context is running. */
  get status(): TransportStatus {
    if (this.disposed) return 'disposed';
    if (!this.buffer) return 'empty';
    if (this.ctx.state !== 'running') return 'suspended';
    return this.source ? 'playing' : 'ready';
  }

  /** Replace the buffer; stops any playing source and invalidates pending plays. */
  setMix(revision: string, mix: MixResult): void {
    this.assertLive();
    if (mix.sampleRate !== TRANSPORT_SAMPLE_RATE) throw new Error(`transport requires ${TRANSPORT_SAMPLE_RATE} Hz mix, got ${mix.sampleRate}`);
    if (mix.left.length !== mix.right.length) throw new Error('mix channel lengths differ');
    if (mix.left.length === 0) throw new Error('mix is empty');
    this.stop();
    const buf = this.ctx.createBuffer(2, mix.left.length, TRANSPORT_SAMPLE_RATE);
    buf.getChannelData(0).set(mix.left);
    buf.getChannelData(1).set(mix.right);
    this.buffer = buf;
    this.frames = mix.left.length;
    this.level = comfortGain(mix);
    this.previewGain.gain.value = this.muted ? 0 : this.level;
    this.revision = revision;
  }

  /** Call from a user gesture. Resolves true only if the context ends up running. */
  async unlock(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.ctx.state === 'running') return true;
    try { await this.ctx.resume(); } catch { return false; }
    return !this.disposed && this.ctx.state === 'running';
  }

  /** Stop any current source and schedule the mix from `offsetSample` at currentTime + lead. */
  async play(offsetSample = 0): Promise<PlayResult> {
    if (this.disposed) return { ok: false, reason: 'disposed' };
    if (!this.buffer || this.revision === null) return { ok: false, reason: 'no-buffer' };
    if (!Number.isInteger(offsetSample) || offsetSample < 0 || offsetSample >= this.frames) {
      return { ok: false, reason: 'offset-out-of-range' };
    }
    this.stop();
    const gen = this.generation;
    const revision = this.revision;
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch {
        return gen === this.generation && !this.disposed ? { ok: false, reason: 'resume-rejected' } : this.staleReason();
      }
    }
    if (this.disposed) return { ok: false, reason: 'disposed' };
    if (gen !== this.generation || revision !== this.revision) return { ok: false, reason: 'stale' };
    if (this.ctx.state !== 'running') return { ok: false, reason: 'suspended' };

    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.previewGain);
    const startTime = this.ctx.currentTime + SCHEDULE_LEAD_SECONDS;
    const offsetSeconds = offsetSample / TRANSPORT_SAMPLE_RATE;
    src.onended = () => { if (this.source === src) { this.source = null; src.disconnect(); } };
    src.start(startTime, offsetSeconds);
    this.source = src;
    return {
      ok: true,
      revision,
      startTime,
      offsetSample,
      castOrigin: startTime - offsetSeconds,
      startPerformanceTime: this.toPerformanceTime(startTime),
    };
  }

  /** Stop playback and invalidate any pending play. Safe to call repeatedly. */
  stop(): void {
    this.generation++;
    const src = this.source;
    this.source = null;
    if (!src) return;
    src.onended = null;
    try { src.stop(); } catch { /* already stopped / never started */ }
    src.disconnect();
  }

  /** Preview-only mute; never touches the authored mix. */
  setMuted(muted: boolean): void {
    this.assertLive();
    this.muted = muted;
    this.previewGain.gain.value = muted ? 0 : this.level;
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.buffer = null;
    this.revision = null;
    this.frames = 0;
    this.previewGain.disconnect();
  }

  private staleReason(): PlayResult {
    return { ok: false, reason: this.disposed ? 'disposed' : 'stale' };
  }

  private toPerformanceTime(contextTime: number): number | null {
    if (!this.ctx.getOutputTimestamp) return null;
    const ts = this.ctx.getOutputTimestamp();
    if (typeof ts.contextTime !== 'number' || typeof ts.performanceTime !== 'number' || !Number.isFinite(ts.contextTime) || !Number.isFinite(ts.performanceTime) || ts.performanceTime <= 0) return null;
    return ts.performanceTime + (contextTime - ts.contextTime) * 1000;
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('audio transport disposed');
  }
}
