// Fixed-step playback clock (docs/v2-plan/07-SIMULATION.md, 12-EDITOR.md, 21 D07).
// Platform-neutral: callers pass explicit elapsed seconds; no Date/performance/DOM/global state.
// Loop is deferred until simulation integration; this clock stops exactly at durationTicks.

import { MAX_DURATION_TICKS, MIN_DURATION_TICKS, TICKS_PER_SECOND } from '../model/types.ts';

export const CLOCK_SNAPSHOT_VERSION = 1;
export const MIN_PLAYBACK_SPEED = 0.25;
export const MAX_PLAYBACK_SPEED = 4;
/**
 * Fractional tick remainders within this distance of an integer snap to it, so equal elapsed time
 * delivered at 30/60/144 Hz resolves to the same integer tick despite float summation error.
 */
export const TICK_EPSILON = 1e-9;

export type PlaybackClockOptions = { durationTicks: number; speed?: number };

export type ClockSnapshot = {
  version: number;
  durationTicks: number;
  tick: number;
  /** Fraction of the next tick accumulated, in [0,1). 0 when tick === durationTicks. */
  fraction: number;
  playing: boolean;
  speed: number;
};

export type AdvanceResult = {
  /** Whole ticks crossed by this advance (0 when paused or ended). */
  ticksAdvanced: number;
  /** True when this advance landed exactly on durationTicks. */
  reachedEnd: boolean;
  /** Elapsed seconds (wall time, pre-speed) not consumed because the endpoint was reached. Never silently dropped. */
  unusedSeconds: number;
};

function assertDuration(v: unknown): number {
  if (!Number.isSafeInteger(v) || (v as number) < MIN_DURATION_TICKS || (v as number) > MAX_DURATION_TICKS) {
    throw new RangeError(`durationTicks must be a whole number in [${MIN_DURATION_TICKS},${MAX_DURATION_TICKS}].`);
  }
  return v as number;
}

function assertSpeed(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < MIN_PLAYBACK_SPEED || v > MAX_PLAYBACK_SPEED) {
    throw new RangeError(`speed must be a finite number in [${MIN_PLAYBACK_SPEED},${MAX_PLAYBACK_SPEED}].`);
  }
  return v;
}

export class PlaybackClock {
  #duration: number;
  #tick = 0;
  #fraction = 0;
  #playing = false;
  #speed: number;

  constructor(options: PlaybackClockOptions) {
    if (typeof options !== 'object' || options === null) throw new TypeError('options must be an object.');
    this.#duration = assertDuration(options.durationTicks);
    this.#speed = options.speed === undefined ? 1 : assertSpeed(options.speed);
  }

  get durationTicks(): number { return this.#duration; }
  /** Current integer simulation tick in [0,durationTicks]. */
  get tick(): number { return this.#tick; }
  /** Render interpolation factor between tick and tick+1, in [0,1). Always 0 at the endpoint. */
  get alpha(): number { return this.#fraction; }
  get playing(): boolean { return this.#playing; }
  get ended(): boolean { return this.#tick === this.#duration; }
  get speed(): number { return this.#speed; }

  /** Starts playback. No-op at the endpoint (returns false); call restart() to replay. */
  play(): boolean {
    if (this.ended) return false;
    this.#playing = true;
    return true;
  }

  pause(): void { this.#playing = false; }

  setSpeed(speed: number): void { this.#speed = assertSpeed(speed); }

  /** Jumps to an exact tick, discarding the fractional remainder. Pause state is retained; seeking to the endpoint stops. */
  seek(tick: number): void {
    if (!Number.isSafeInteger(tick) || tick < 0 || tick > this.#duration) {
      throw new RangeError(`seek tick must be a whole number in [0,${this.#duration}].`);
    }
    this.#tick = tick;
    this.#fraction = 0;
    if (this.ended) this.#playing = false;
  }

  /** Returns to tick 0 with no remainder and starts playing (explicit replay signal). */
  restart(): void {
    this.#tick = 0;
    this.#fraction = 0;
    this.#playing = true;
  }

  /** Advances by elapsed wall seconds scaled by speed. Paused or ended clocks advance nothing. */
  advance(deltaSeconds: number): AdvanceResult {
    if (typeof deltaSeconds !== 'number' || !Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('deltaSeconds must be a finite number >= 0.');
    }
    if (!this.#playing || this.ended) return { ticksAdvanced: 0, reachedEnd: false, unusedSeconds: 0 };
    const total = this.#fraction + deltaSeconds * TICKS_PER_SECOND * this.#speed;
    if (!Number.isFinite(total)) throw new RangeError('deltaSeconds is too large.');
    let whole = Math.floor(total);
    let rem = total - whole;
    if (1 - rem < TICK_EPSILON) { whole += 1; rem = 0; } else if (rem < TICK_EPSILON) rem = 0;
    const remaining = this.#duration - this.#tick;
    if (whole < remaining) {
      this.#tick += whole;
      this.#fraction = rem;
      return { ticksAdvanced: whole, reachedEnd: false, unusedSeconds: 0 };
    }
    const overTicks = (whole - remaining) + rem;
    this.#tick = this.#duration;
    this.#fraction = 0;
    this.#playing = false;
    const unused = overTicks / (TICKS_PER_SECOND * this.#speed);
    return { ticksAdvanced: remaining, reachedEnd: true, unusedSeconds: unused < 0 ? 0 : unused };
  }

  snapshot(): ClockSnapshot {
    return {
      version: CLOCK_SNAPSHOT_VERSION, durationTicks: this.#duration, tick: this.#tick,
      fraction: this.#fraction, playing: this.#playing, speed: this.#speed,
    };
  }

  /** Rebuilds a clock from a snapshot, rejecting malformed or inconsistent data. */
  static restore(snapshot: unknown): PlaybackClock {
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
      throw new TypeError('snapshot must be a plain object.');
    }
    const s = snapshot as Record<string, unknown>;
    const keys = ['version', 'durationTicks', 'tick', 'fraction', 'playing', 'speed'];
    const own = Object.keys(s);
    if (own.length !== keys.length || !keys.every(k => Object.prototype.hasOwnProperty.call(s, k))) {
      throw new TypeError(`snapshot must have exactly the fields ${keys.join(', ')}.`);
    }
    if (s.version !== CLOCK_SNAPSHOT_VERSION) throw new RangeError(`Unsupported clock snapshot version.`);
    const clock = new PlaybackClock({ durationTicks: s.durationTicks as number, speed: assertSpeed(s.speed) });
    if (typeof s.playing !== 'boolean') throw new TypeError('snapshot.playing must be boolean.');
    const f = s.fraction;
    if (typeof f !== 'number' || !Number.isFinite(f) || f < 0 || f >= 1) {
      throw new RangeError('snapshot.fraction must be a finite number in [0,1).');
    }
    clock.seek(s.tick as number);
    if (clock.ended && (f !== 0 || s.playing)) {
      throw new RangeError('snapshot at the endpoint must have fraction 0 and not be playing.');
    }
    clock.#fraction = f;
    clock.#playing = s.playing;
    return clock;
  }
}
