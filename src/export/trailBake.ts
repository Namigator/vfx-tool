// Trails baked from the editor's own simulation for engine exports: the same TrailHistory (smoothing), spiral and width
// shape as PreviewViewport#updateTrails, sampled every `step` ticks into polylines with a width per point. Engines draw
// them as ribbon / beam frames, so trails the engines cannot build natively (many particles, a spiral, a width over the
// trail) look like the editor everywhere (feature grid 2026-10-30). Pure data: no DOM or Three.
import type { ParticleTrailLayer } from '../graph/toParticles.ts';
import type { Vec3 } from '../model/types.ts';
import { ParticleSimulation, PARTICLE_DT, type ParticleEmitterDescriptor } from '../runtime/particles.ts';
import { evaluateCurve } from '../runtime/curves.ts';
import { TrailHistory } from '../render/particleTrails.ts';
import { spiralPoints } from '../render/trailSpiral.ts';

/** One baked path: points tail -> head in editor metres, `width` (m) per point, and its opacity at that tick. */
export type BakedTrailPath = { points: Vec3[]; widths: number[]; alpha: number };
export type BakedTrailFrame = { tick: number; paths: BakedTrailPath[] };

/** True when the trail needs the bake to look right in an engine: a spiral or a width over the trail. */
export const trailNeedsBake = (layer: ParticleTrailLayer): boolean =>
  !!layer.spiral || !!layer.widthOverTrail?.keys.some(k => k.y !== 1);

/**
 * Frames every `step` ticks plus an empty closing frame at `duration`. Width per point = layer width x width over trail
 * (0 tail .. 1 head) x the tail end fade (smoothstep over `endFade`, the head stays full: fadeHead false in the editor).
 */
export function bakeTrailFrames(layer: ParticleTrailLayer, d: ParticleEmitterDescriptor, duration: number, step = 2): BakedTrailFrame[] {
  const created = ParticleSimulation.create(d);
  if (!created.ok) return [];
  const sim = created.value, history = new TrailHistory(layer.historyTicks, layer.maxPoints, layer.systemId === layer.nodeId);
  const fade = (u: number) => { const f = layer.endFade > 0 ? Math.min(1, u / layer.endFade) : 1; return f * f * (3 - 2 * f); };
  const shape = (u: number) => (layer.widthOverTrail ? evaluateCurve(layer.widthOverTrail, u) : 1);
  const frames: BakedTrailFrame[] = [];
  const end = Math.min(duration, d.durationTicks);
  while (sim.tick < end) {
    const tick = sim.tick;
    history.push(tick, sim.snapshot().particles);
    if (tick % step === 0) {
      const paths = history.paths(tick).map(p => {
        const points = layer.spiral ? spiralPoints(p.points, layer.spiral, tick * PARTICLE_DT) : p.points;
        const n = points.length;
        return { points, widths: points.map((_, i) => { const u = n > 1 ? i / (n - 1) : 1; return layer.width * shape(u) * fade(u); }), alpha: p.opacityScale };
      }).filter(p => p.points.length >= 2);
      frames.push({ tick, paths });
    }
    if (!sim.step().ok) break;
  }
  frames.push({ tick: duration, paths: [] });
  return frames;
}
