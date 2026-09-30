// Deterministic RingPath core (design e3bbd3e7). Pure: no DOM, React or Three. Proof-of-concept
// alternate to the planned RingRenderer: a closed ring emitted as ordinary PathData for RibbonRenderer.
//
// Decisions:
// - Local frame: the ring lies in the XZ plane around `center`; `orientation` (xyzw, normalized here)
//   rotates it. Point i is at angle 2πi/samples starting on local +X, turning toward +Z.
// - The loop is closed by an exact copy of the first point, so a path has samples + 1 points.
// - Actual radius = max(minRadius, radius * radiusScale). A zero radius collapses to the center (finite).
// - No randomness: the output depends only on the arguments. One path, ID "p0".
import type { Quaternion, Vec3 } from '../model/types.ts';
import type { PathData } from './paths.ts';

export interface RingOptions {
  /** Meters. */
  radius: number;
  /** Meters; lower bound of the actual radius. */
  minRadius: number;
  /** Normalized [0,1] multiplier of radius. */
  radiusScale: number;
  samples: number;
  orientation: Quaternion;
}

export const MIN_RING_SAMPLES = 8;
export const MAX_RING_SAMPLES = 256;
export const MIN_RING_RADIUS = 0.001;
export const MAX_RING_RADIUS = 50;
export const RING_DEFAULTS = {
  radius: 1, minRadius: 0, radiusScale: 1, samples: 64, orientation: [0, 0, 0, 1] as Quaternion,
};

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function rotate(q: Quaternion, v: Vec3): Vec3 {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  const qx = q[0] / n, qy = q[1] / n, qz = q[2] / n, qw = q[3] / n;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Actual radius in meters. */
export function ringRadius(o: Pick<RingOptions, 'radius' | 'minRadius' | 'radiusScale'>): number {
  return Math.max(o.minRadius, o.radius * o.radiusScale);
}

export function ringPath(center: Vec3, options: RingOptions): PathData {
  if (!Array.isArray(center) || center.length !== 3 || !center.every(finite)) throw new TypeError('center must be a finite Vec3.');
  if (typeof options !== 'object' || options === null) throw new TypeError('options must be an object.');
  const o = options;
  if (!finite(o.radius) || o.radius < MIN_RING_RADIUS || o.radius > MAX_RING_RADIUS) {
    throw new RangeError(`radius must be a finite number in [${MIN_RING_RADIUS},${MAX_RING_RADIUS}].`);
  }
  if (!finite(o.minRadius) || o.minRadius < 0 || o.minRadius > MAX_RING_RADIUS) {
    throw new RangeError(`minRadius must be a finite number in [0,${MAX_RING_RADIUS}].`);
  }
  if (!finite(o.radiusScale) || o.radiusScale < 0 || o.radiusScale > 1) throw new RangeError('radiusScale must be a finite number in [0,1].');
  if (!Number.isInteger(o.samples) || o.samples < MIN_RING_SAMPLES || o.samples > MAX_RING_SAMPLES) {
    throw new RangeError(`samples must be an integer in [${MIN_RING_SAMPLES},${MAX_RING_SAMPLES}].`);
  }
  const q = o.orientation;
  if (!Array.isArray(q) || q.length !== 4 || !q.every(finite) || Math.hypot(q[0], q[1], q[2], q[3]) === 0) {
    throw new TypeError('orientation must be a finite nonzero quaternion (xyzw).');
  }
  const r = ringRadius(o);
  const points: Vec3[] = [];
  for (let i = 0; i < o.samples; i += 1) {
    const a = (2 * Math.PI * i) / o.samples;
    const d = rotate(q, [Math.cos(a) * r, 0, Math.sin(a) * r]);
    points.push([center[0] + d[0], center[1] + d[1], center[2] + d[2]]);
  }
  const first = points[0];
  points.push([first[0], first[1], first[2]]);
  return { id: 'p0', points, widthScale: 1, opacityScale: 1 };
}
