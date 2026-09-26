// Pure helpers for fixed path-preview framing across the whole effect timeline (no DOM/Three).
import type { PathPreviewPlan } from '../graph/toPaths.ts';
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
