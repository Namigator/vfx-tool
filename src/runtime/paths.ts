// Deterministic path core (plan07 paths, plan24 path random identity, WP03 decisions).
// Pure functions only: inputs are never mutated and outputs never alias inputs.
// Path ids never participate in random keys.
import type { Vec3 } from '../model/types.ts';
import { assertStoredId, assertUint32, sampleUnit } from './random.ts';

export interface PathData {
  id: string;
  points: Vec3[];
  widthScale: number;
  opacityScale: number;
}

export interface StableFrame { t: Vec3; n1: Vec3; n2: Vec3 }

export interface JaggedOptions {
  documentSeed: number;
  randomStreamId: string;
  pathOrdinal: number;
  amplitude: number;
  samples: number;
  regenerationHz: number;
  effectLocalSeconds: number;
  pinned: boolean;
}

export const MIN_PATH_SAMPLES = 2;
export const MAX_PATH_SAMPLES = 128;
/** Packed jagged sampleOrdinal = regeneration * JAGGED_ORDINAL_STRIDE + vertexIndex. */
export const JAGGED_ORDINAL_STRIDE = 128;
export const BEZIER_OVERSAMPLE = 8;

const UINT32_MAX = 0xffffffff;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clone = (v: Vec3): Vec3 => [v[0], v[1], v[2]];
function normalize(v: Vec3): Vec3 | null {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 0 && Number.isFinite(l) ? [v[0] / l, v[1] / l, v[2] / l] : null;
}

function assertVec3(value: unknown, name: string): asserts value is Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((c) => typeof c === 'number' && Number.isFinite(c))) {
    throw new TypeError(`${name} must be a finite Vec3.`);
  }
}
function assertPoints(value: unknown, name: string): asserts value is Vec3[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array of Vec3.`);
  value.forEach((p, i) => assertVec3(p, `${name}[${i}]`));
}
function assertFiniteNonNegative(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite nonnegative number.`);
  }
}
function assertSamples(value: unknown, name = 'samples'): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_PATH_SAMPLES || value > MAX_PATH_SAMPLES) {
    throw new RangeError(`${name} must be an integer in [${MIN_PATH_SAMPLES},${MAX_PATH_SAMPLES}].`);
  }
}
function assertFraction(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be a finite number in [0,1].`);
  }
}
function assertPath(path: unknown): asserts path is PathData {
  if (typeof path !== 'object' || path === null) throw new TypeError('path must be an object.');
  const p = path as PathData;
  if (typeof p.id !== 'string') throw new TypeError('path.id must be a string.');
  assertPoints(p.points, 'path.points');
  assertFiniteNonNegative(p.widthScale, 'path.widthScale');
  assertFiniteNonNegative(p.opacityScale, 'path.opacityScale');
}

function withPoints(path: PathData, points: Vec3[]): PathData {
  return { id: path.id, points, widthScale: path.widthScale, opacityScale: path.opacityScale };
}

function cumulativeLengths(points: Vec3[]): number[] {
  const out = new Array<number>(points.length);
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    if (i > 0) total += dist(points[i - 1], points[i]);
    out[i] = total;
  }
  return out;
}

/** Point at arc distance `target` given precomputed cumulative lengths (clamped). */
function pointAtDistance(points: Vec3[], cum: number[], target: number): Vec3 {
  const last = points.length - 1;
  if (target <= 0 || cum[last] === 0) return clone(points[0]);
  if (target >= cum[last]) return clone(points[last]);
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid; else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  return seg > 0 ? lerp(points[lo], points[hi], (target - cum[lo]) / seg) : clone(points[lo]);
}

/** Polyline arc length. Empty or single point yields 0. */
export function pathLength(points: Vec3[]): number {
  assertPoints(points, 'points');
  return points.length === 0 ? 0 : cumulativeLengths(points)[points.length - 1];
}

/** Point at normalized polyline arc fraction. Throws RangeError for an empty path. */
export function pointAtArcFraction(points: Vec3[], fraction: number): Vec3 {
  assertPoints(points, 'points');
  assertFraction(fraction, 'fraction');
  if (points.length === 0) throw new RangeError('pointAtArcFraction requires at least one point.');
  const cum = cumulativeLengths(points);
  return pointAtDistance(points, cum, fraction * cum[points.length - 1]);
}

/**
 * Resample to `samples` points at equal cumulative polyline arc-length targets.
 * Empty input yields []; single-point or zero-length input duplicates the first point.
 * First/last outputs are exact clones of the input endpoints.
 */
export function resampleByArcLength(points: Vec3[], samples: number): Vec3[] {
  assertPoints(points, 'points');
  assertSamples(samples);
  if (points.length === 0) return [];
  const cum = cumulativeLengths(points);
  const total = cum[points.length - 1];
  const out: Vec3[] = [];
  for (let i = 0; i < samples; i += 1) {
    if (i === samples - 1) out.push(clone(points[points.length - 1]));
    else out.push(pointAtDistance(points, cum, (total * i) / (samples - 1)));
  }
  return out;
}

export function linePath(id: string, start: Vec3, end: Vec3, samples: number): PathData {
  assertVec3(start, 'start');
  assertVec3(end, 'end');
  assertSamples(samples);
  const points: Vec3[] = [];
  for (let i = 0; i < samples; i += 1) {
    points.push(i === 0 ? clone(start) : i === samples - 1 ? clone(end) : lerp(start, end, i / (samples - 1)));
  }
  return { id: String(id), points, widthScale: 1, opacityScale: 1 };
}

/** Cubic Bezier: uniform-t dense samples, then arc-length resampling of that polyline. */
export function bezierPath(id: string, p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, samples: number): PathData {
  assertVec3(p0, 'p0'); assertVec3(p1, 'p1'); assertVec3(p2, 'p2'); assertVec3(p3, 'p3');
  assertSamples(samples);
  const dense = samples * BEZIER_OVERSAMPLE;
  const raw: Vec3[] = [];
  for (let i = 0; i <= dense; i += 1) {
    if (i === 0) { raw.push(clone(p0)); continue; }
    if (i === dense) { raw.push(clone(p3)); continue; }
    const t = i / dense;
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    raw.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
      a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2],
    ]);
  }
  return { id: String(id), points: resampleByArcLength(raw, samples), widthScale: 1, opacityScale: 1 };
}

/** Frozen WP03 frame: t=normalize(end-start) (+X if zero), ref +Y unless |t.y|>0.99 then +X. */
export function stableFrame(start: Vec3, end: Vec3): StableFrame {
  assertVec3(start, 'start');
  assertVec3(end, 'end');
  const t = normalize(sub(end, start)) ?? [1, 0, 0];
  const ref: Vec3 = Math.abs(t[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
  const n1 = normalize(cross(t, ref)) as Vec3;
  return { t, n1, n2: cross(t, n1) };
}

/** floor(effectLocalSeconds*hz); hz 0 freezes at 0. Packed jagged ordinal must fit uint32. */
export function regenerationIndex(effectLocalSeconds: number, regenerationHz: number): number {
  assertFiniteNonNegative(effectLocalSeconds, 'effectLocalSeconds');
  assertFiniteNonNegative(regenerationHz, 'regenerationHz');
  if (regenerationHz === 0) return 0;
  const index = Math.floor(effectLocalSeconds * regenerationHz);
  const maxPacked = index * JAGGED_ORDINAL_STRIDE + (JAGGED_ORDINAL_STRIDE - 1);
  if (!Number.isSafeInteger(maxPacked) || maxPacked > UINT32_MAX) {
    throw new RangeError('regeneration index exceeds the packed uint32 sampleOrdinal range.');
  }
  return index;
}

/**
 * Resample by arc length then displace in the stable perpendicular plane.
 * Offset = amplitude*taper*((2r1-1)*n1 + (2r2-1)*n2); taper=sin(pi*u) when pinned, else 1.
 * Pinned endpoints are exact clones. Zero-length input is returned resampled without displacement.
 */
export function jaggedPath(path: PathData, options: JaggedOptions): PathData {
  assertPath(path);
  if (typeof options !== 'object' || options === null) throw new TypeError('options must be an object.');
  assertUint32(options.documentSeed, 'documentSeed');
  assertStoredId(options.randomStreamId, 'randomStreamId');
  assertUint32(options.pathOrdinal, 'pathOrdinal');
  assertFiniteNonNegative(options.amplitude, 'amplitude');
  assertSamples(options.samples);
  if (typeof options.pinned !== 'boolean') throw new TypeError('pinned must be a boolean.');
  const regen = regenerationIndex(options.effectLocalSeconds, options.regenerationHz);
  const base = resampleByArcLength(path.points, options.samples);
  if (base.length === 0 || pathLength(path.points) === 0) return withPoints(path, base);
  const { n1, n2 } = stableFrame(base[0], base[base.length - 1]);
  const last = base.length - 1;
  const points = base.map((p, i): Vec3 => {
    if (options.pinned && (i === 0 || i === last)) return p;
    const u = i / last;
    const scale = options.amplitude * (options.pinned ? Math.sin(Math.PI * u) : 1);
    const key = {
      documentSeed: options.documentSeed, randomStreamId: options.randomStreamId, eventRandomKey: '',
      entityOrdinal: options.pathOrdinal, sampleOrdinal: regen * JAGGED_ORDINAL_STRIDE + i,
    };
    const a = (2 * sampleUnit({ ...key, propertyKey: 'jaggedN1' }) - 1) * scale;
    const b = (2 * sampleUnit({ ...key, propertyKey: 'jaggedN2' }) - 1) * scale;
    return [p[0] + n1[0] * a + n2[0] * b, p[1] + n1[1] * a + n2[1] * b, p[2] + n1[2] * a + n2[2] * b];
  });
  return withPoints(path, points);
}

/**
 * Clip to fraction of cumulative arc length. 0 → empty points; 1 → exact clone;
 * interior keeps vertices strictly before the target plus the interpolated endpoint.
 * Zero-length non-empty input returns a clone (finite degenerate data).
 */
export function revealPath(path: PathData, fraction: number): PathData {
  assertPath(path);
  assertFraction(fraction, 'fraction');
  const src = path.points;
  if (fraction === 0 || src.length === 0) return withPoints(path, []);
  if (fraction === 1) return withPoints(path, src.map(clone));
  const cum = cumulativeLengths(src);
  const total = cum[src.length - 1];
  if (total === 0) return withPoints(path, src.map(clone));
  const target = fraction * total;
  const points: Vec3[] = [];
  for (let i = 0; i < src.length && cum[i] < target; i += 1) points.push(clone(src[i]));
  points.push(pointAtDistance(src, cum, target));
  return withPoints(path, points);
}
