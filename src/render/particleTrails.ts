// ParticleTrail history (05 ParticleTrail: history .15 s, ≤ maxPoints, independent fade after parent
// death). Pure data: fed one snapshot per simulated tick, emits PathData for ribbon geometry. A dead
// particle's trail stops growing and its tail recedes until the history window has passed.
import type { Vec3 } from '../model/types.ts';
import type { PathData } from '../runtime/paths.ts';
import type { ParticleState } from '../runtime/particles.ts';

type Entry = { ticks: number[]; points: Vec3[]; lastTick: number };

export class TrailHistory {
  readonly historyTicks: number;
  readonly maxPoints: number;
  readonly #entries = new Map<string, Entry>();

  constructor(historyTicks: number, maxPoints: number) {
    if (!(historyTicks >= 1) || !(maxPoints >= 2)) throw new RangeError('historyTicks >= 1 and maxPoints >= 2 required.');
    this.historyTicks = Math.floor(historyTicks);
    this.maxPoints = Math.floor(maxPoints);
  }

  clear(): void { this.#entries.clear(); }
  get size(): number { return this.#entries.size; }

  /** Records the particles alive at `tick` and drops samples older than the history window. */
  push(tick: number, particles: readonly ParticleState[]): void {
    for (const p of particles) {
      let e = this.#entries.get(p.id);
      if (!e) { e = { ticks: [], points: [], lastTick: tick }; this.#entries.set(p.id, e); }
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
  paths(tick: number, heads?: ReadonlyMap<string, Vec3>): PathData[] {
    const out: PathData[] = [];
    for (const [id, e] of this.#entries) {
      const points = e.points.slice();
      const head = heads?.get(id);
      if (head && e.lastTick === tick) points.push(head);
      if (points.length < 2) continue;
      const deadFor = tick - e.lastTick;
      out.push({ id, points, widthScale: 1, opacityScale: deadFor > 0 ? Math.max(0, 1 - deadFor / this.historyTicks) : 1 });
    }
    return out;
  }
}
