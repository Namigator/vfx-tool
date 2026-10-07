// ParticleTrail history (05 ParticleTrail: history .15 s, ≤ maxPoints, independent fade after parent
// death). Pure data: fed one snapshot per simulated tick, emits PathData for ribbon geometry. A dead
// particle's trail stops growing and its tail recedes until the history window has passed.
import type { Vec3 } from '../model/types.ts';
import type { PathData } from '../runtime/paths.ts';
import type { ParticleState } from '../runtime/particles.ts';

type Entry = { ticks: number[]; points: Vec3[]; lastTick: number; track: number };
/** A trail at the current tick plus the source track (path index) of its particle. */
export type TrailPath = PathData & { track: number };

/** Sub-points per segment when smoothing (Catmull-Rom through the recorded per-tick points). */
export const TRAIL_SMOOTH_STEPS = 4;

/** Uniform Catmull-Rom through `pts` with `steps` sub-segments per segment (fast movers stop looking faceted). */
export function smoothTrail(pts: readonly Vec3[], steps = TRAIL_SMOOTH_STEPS): Vec3[] {
  if (pts.length < 3 || steps < 2) return pts.slice();
  const out: Vec3[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map(c => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)) as Vec3);
    }
  }
  out.push([...pts[pts.length - 1]] as Vec3);
  return out;
}

export class TrailHistory {
  readonly historyTicks: number;
  readonly maxPoints: number;
  /** Smooth the recorded points into a curve when drawing (MotionTrail: few, fast trails). */
  readonly smooth: boolean;
  readonly #entries = new Map<string, Entry>();

  constructor(historyTicks: number, maxPoints: number, smooth = false) {
    if (!(historyTicks >= 1) || !(maxPoints >= 2)) throw new RangeError('historyTicks >= 1 and maxPoints >= 2 required.');
    this.historyTicks = Math.floor(historyTicks);
    this.maxPoints = Math.floor(maxPoints);
    this.smooth = smooth;
  }

  clear(): void { this.#entries.clear(); }
  get size(): number { return this.#entries.size; }
  /** Stored trail samples (15 hard limit: 65536 across the effect). */
  get sampleCount(): number { let n = 0; for (const e of this.#entries.values()) n += e.points.length; return n; }

  /** Records the particles alive at `tick` and drops samples older than the history window. */
  push(tick: number, particles: readonly ParticleState[]): void {
    for (const p of particles) {
      let e = this.#entries.get(p.id);
      if (!e) { e = { ticks: [], points: [], lastTick: tick, track: p.track ?? 0 }; this.#entries.set(p.id, e); }
      e.ticks.push(tick); e.points.push([p.position[0], p.position[1], p.position[2]]); e.lastTick = tick;
    }
    const oldest = tick - this.historyTicks;
    for (const [id, e] of this.#entries) {
      let drop = 0;
      while (drop < e.ticks.length && e.ticks[drop] < oldest) drop++;
      const over = Math.max(0, e.ticks.length - drop - this.maxPoints);
      if (drop + over) { e.ticks.splice(0, drop + over); e.points.splice(0, drop + over); }
      if (e.ticks.length === 0) this.#entries.delete(id);
    }
  }

  /**
   * Trails at the current tick. `heads` optionally extends live trails to an interpolated head position
   * (render alpha between ticks). Trails of dead particles fade via opacityScale as their tail recedes.
   */
  paths(tick: number, heads?: ReadonlyMap<string, Vec3>): TrailPath[] {
    const out: TrailPath[] = [];
    for (const [id, e] of this.#entries) {
      let points = e.points.slice();
      const head = heads?.get(id);
      if (head && e.lastTick === tick) points.push(head);
      if (points.length < 2) continue;
      if (this.smooth) points = smoothTrail(points);
      const deadFor = tick - e.lastTick;
      out.push({ id, points, widthScale: 1, opacityScale: deadFor > 0 ? Math.max(0, 1 - deadFor / this.historyTicks) : 1, track: e.track });
    }
    return out;
  }
}
