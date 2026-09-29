// Pure helpers for fixed path-preview framing across the whole effect timeline (no DOM/Three).
import type { PathPreviewPlan } from '../graph/toPaths.ts';
import type { ParticlePreviewPlan } from '../graph/toParticles.ts';
import { ParticleSimulation } from '../runtime/particles.ts';
import type { Vec3 } from '../model/types.ts';
import type { FramePointSet } from './RibbonGeometry.ts';

/** Bounded, sorted, unique sample ticks: 0, ~1/4, ~1/2, ~3/4 and durationTicks-1. */
export function framingSampleTicks(durationTicks: number): number[] {
  const last = Math.max(0, Math.floor(durationTicks) - 1);
  const ticks = [0, Math.round(last / 4), Math.round(last / 2), Math.round((3 * last) / 4), last];
  return [...new Set(ticks)].sort((a, b) => a - b);
}

function finitePoint(p: Vec3): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);
}

/** Appends active, finite path point sets (width-padded) of `plan` to `out`. */
export function appendFrameSets(plan: PathPreviewPlan, out: FramePointSet[]): void {
  for (const layer of plan.layers) if (layer.active) {
    for (const p of layer.paths) {
      if (!p.points.length) continue;
      const pad = (layer.width * p.widthScale) / 2;
      if (!Number.isFinite(pad)) continue;
      const points = p.points.every(finitePoint) ? p.points : p.points.filter(finitePoint);
      if (points.length) out.push({ points, pad });
    }
  }
}

/**
 * Union of frame sets over the sample ticks. `plan0` is the already-compiled tick 0; other ticks go
 * through `compile`. Failed or throwing samples are skipped (framing only; playback reports errors).
 */
export function collectTimelineFrameSets(
  plan0: PathPreviewPlan,
  durationTicks: number,
  compile: (tick: number) => { ok: true; value: PathPreviewPlan } | { ok: false },
): FramePointSet[] {
  const sets: FramePointSet[] = [];
  for (const tick of framingSampleTicks(durationTicks)) {
    if (tick === 0) { appendFrameSets(plan0, sets); continue; }
    let r;
    try { r = compile(tick); } catch { continue; }
    if (r.ok) appendFrameSets(r.value, sets);
  }
  return sets;
}

/** Most particle positions kept per system per sample tick (even stride), bounding framing cost. */
export const MAX_FRAMED_PARTICLES_PER_SAMPLE = 512;

/**
 * Frame sets for point layers: each system replayed to the framing sample ticks; positions padded by the
 * largest billboard half-extent that system can reach (size × max size-over-life × stretch). Failed
 * replays are skipped (framing only; playback reports errors).
 */
export function particleFrameSets(plan: ParticlePreviewPlan): FramePointSet[] {
  const out: FramePointSet[] = [];
  for (const sys of plan.systems) {
    const layers = plan.layers.filter(l => l.systemId === sys.id), trails = (plan.trails ?? []).filter(t => t.systemId === sys.id), meshes = (plan.meshes ?? []).filter(m => m.systemId === sys.id);
    if (!layers.length && !trails.length && !meshes.length) continue;
    const grow = Math.max(1, ...layers.map(l => Math.max(...l.sizeOverLife.keys.map(k => k.y)) * Math.max(1, l.stretchRatio)));
    const pad = Math.max(sys.descriptor.size.max * grow, ...trails.map(t => t.width), ...meshes.map(m => sys.descriptor.size.max * m.scale * Math.max(...m.sizeOverLife.keys.map(k => k.y)))) / 2;
    // One forward replay per system, snapshotting at each sample tick (15 performance: replaying from tick 0 for every
    // sample cost ~200 ms per edit on a flamethrower).
    let sim: ParticleSimulation | undefined;
    try { const c = ParticleSimulation.create(sys.descriptor); if (c.ok) sim = c.value; } catch { sim = undefined; }
    if (!sim) continue;
    for (const tick of [...framingSampleTicks(sys.descriptor.durationTicks)].sort((a, b) => a - b)) {
      let failed = false;
      while (sim.tick < tick) { let r; try { r = sim.step(); } catch { r = { ok: false }; } if (!r.ok) { failed = true; break; } }
      if (failed) break;
      const ps = sim.snapshot().particles, stride = Math.max(1, Math.ceil(ps.length / MAX_FRAMED_PARTICLES_PER_SAMPLE));
      const points: Vec3[] = [];
      for (let i = 0; i < ps.length; i += stride) if (finitePoint(ps[i].position)) points.push(ps[i].position);
      if (points.length) out.push({ points, pad: Number.isFinite(pad) ? pad : 0 });
    }
  }
  return out;
}
