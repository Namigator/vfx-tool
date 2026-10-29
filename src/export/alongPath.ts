// Shared by the engine exporters (Unreal IR -> Unity/Godot, Roblox).
import type { ParticleEmitterDescriptor } from '../runtime/particles.ts';
type Vec3 = [number, number, number];

/** Engines have no "spawn along a polyline" shape: a path emitter becomes K small cone emitters spaced evenly along the
 *  path's arc length (K ~ one per 30 cm, 2..12), each with 1/K of the rate and bursts. It exported as ONE point at the
 *  path start before (feature grid shape-path row, 2026-10-29). Returns undefined for any other emitter. */
export function alongPath(d: ParticleEmitterDescriptor): ParticleEmitterDescriptor[] | undefined {
  const em = d.emission;
  if (!em || em.shape !== 'path' || !em.paths?.length) return undefined;
  const segs: [Vec3, Vec3, number][] = [];
  for (const line of em.paths) for (let i = 1; i < line.length; i++) segs.push([line[i - 1], line[i], Math.hypot(...line[i].map((v, k) => v - line[i - 1][k]))]);
  const total = segs.reduce((n, sg) => n + sg[2], 0);
  if (!(total > 1e-6)) return undefined;
  const K = Math.max(2, Math.min(12, Math.round(total / 0.3)));
  const pointAt = (u: number): Vec3 => { let want = u * total; for (const sg of segs) { const [a, b, l] = sg; if (want <= l || sg === segs.at(-1)) { const t = l > 0 ? Math.min(1, want / l) : 0; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; } want -= l; } return segs.at(-1)![1]; };
  return Array.from({ length: K }, (_, i) => ({
    ...d, sourcePosition: pointAt((i + 0.5) / K), sourceTrack: undefined, extraSourceTracks: undefined,
    emission: { ...em, shape: 'cone' as const, radius: total / K / 2, paths: undefined },
    rate: d.rate ? { ...d.rate, perSecond: d.rate.perSecond / K } : undefined,
    bursts: d.bursts.map(b => ({ ...b, count: Math.max(1, Math.round(b.count / K)) })),
  }));
}
