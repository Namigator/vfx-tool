// MotionTrail Spiral: winds a trail around its own centre line (e.g. strands wrapped around a flying lance).
// Pure geometry on trail paths (points tail → head); no DOM or Three. Used by PreviewViewport#updateTrails.
import type { CurveValue, Vec3 } from '../model/types.ts';
import { evaluateCurve } from '../runtime/curves.ts';

export type TrailSpiral = {
  /** Distance from the centre line (m) before Radius over trail. */
  radius: number;
  /** Full turns over the trail length (tail → head). */
  turns: number;
  /** Extra rotation in radians per second of effect time (the spiral spins as it flies). */
  spin: number;
  /** Start angle (radians): two strands with phases 0 and π braid. */
  phase: number;
  /** Radius multiplier over the trail, 0 = tail .. 1 = head; absent = 1. */
  radiusOverTrail?: CurveValue;
};

/** Number of points each spiralled trail is resampled to (enough for a few smooth turns). */
export const SPIRAL_SAMPLES = 64;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 | undefined => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : undefined; };

/** `points` resampled to `n` points evenly spaced by arc length; undefined when the polyline has no length. */
export function resampleByLength(points: readonly Vec3[], n: number): Vec3[] | undefined {
  const cum = [0];
  for (let i = 1; i < points.length; i++) { const d = sub(points[i], points[i - 1]); cum.push(cum[i - 1] + Math.hypot(d[0], d[1], d[2])); }
  const total = cum[cum.length - 1];
  if (!(total > 1e-9)) return undefined;
  const out: Vec3[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const s = (k / (n - 1)) * total;
    while (j < points.length - 1 && cum[j] < s) j++;
    const seg = cum[j] - cum[j - 1], t = seg > 0 ? Math.min(1, Math.max(0, (s - cum[j - 1]) / seg)) : 0, a = points[j - 1], b = points[j];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

/**
 * The trail's points wound around its centre line: sample k at fraction u (0 = tail, 1 = head) moves `radius ·
 * radiusOverTrail(u)` out from the line at angle phase + spin·seconds + 2π·turns·(1 − u), measured in a frame
 * perpendicular to the local direction (stable while the trail flies straight). Trails without length are kept.
 */
export function spiralPoints(points: readonly Vec3[], s: TrailSpiral, seconds: number): Vec3[] {
  const c = resampleByLength(points, SPIRAL_SAMPLES);
  if (!c) return points.map(p => [p[0], p[1], p[2]] as Vec3);
  const n = c.length, out: Vec3[] = [];
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1);
    const t = norm(sub(c[Math.min(n - 1, k + 1)], c[Math.max(0, k - 1)])) ?? [1, 0, 0];
    const n1 = norm(cross(t, Math.abs(t[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]))!, n2 = cross(t, n1);
    const r = s.radius * (s.radiusOverTrail ? evaluateCurve(s.radiusOverTrail, u) : 1);
    const a = s.phase + s.spin * seconds + 2 * Math.PI * s.turns * (1 - u), ca = Math.cos(a) * r, sa = Math.sin(a) * r;
    out.push([c[k][0] + n1[0] * ca + n2[0] * sa, c[k][1] + n1[1] * ca + n2[1] * sa, c[k][2] + n1[2] * ca + n2[2] * sa]);
  }
  return out;
}
