// Pure billboard life-curve helpers (BillboardRenderer sizeOverLife / opacityOverLife). No DOM, React
// or Three. Curves are validated once at compile time (toParticles); the viewport builds one sampler per
// layer with compileLifeCurve and calls sampleLifeCurve per particle per frame without re-validation.
import type { CurveValue } from '../model/types.ts';

export const SIZE_OVER_LIFE_BOUNDS = { min: 0, max: 20 } as const;
export const OPACITY_OVER_LIFE_BOUNDS = { min: 0, max: 1 } as const;

export const flatLifeCurve = (): CurveValue => ({ domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] });

/**
 * Normalized life fraction of a particle, clamped to [0,1]. `alpha` in [0,1) is the render interpolation
 * between the current and next tick. A non-positive lifetime or non-finite input yields 1 (fully aged).
 */
export function lifeFraction(ageTicks: number, lifetimeTicks: number, alpha: number): number {
  const f = (ageTicks + alpha) / lifetimeTicks;
  if (!(lifetimeTicks > 0) || !Number.isFinite(f)) return 1;
  return f <= 0 ? 0 : f >= 1 ? 1 : f;
}

/** Returns an error message for a curve that is not a valid normalized life curve within bounds, else undefined. */
export function lifeCurveError(curve: CurveValue, bounds: { min: number; max: number }): string | undefined {
  if (curve === null || typeof curve !== 'object' || !Array.isArray(curve.keys)) return 'Curve must be {domain, interpolation, keys}.';
  if (curve.domain !== 'normalized') return `Life curves use the "normalized" domain; got "${String(curve.domain)}".`;
  if (curve.interpolation !== 'linear' && curve.interpolation !== 'hold') return `Curve interpolation must be "linear" or "hold"; got ${String(curve.interpolation)}.`;
  if (curve.keys.length < 1) return 'Curve needs at least one key.';
  let prev = -Infinity;
  for (let i = 0; i < curve.keys.length; i++) {
    const k = curve.keys[i];
    if (k === null || typeof k !== 'object' || !Number.isFinite(k.x) || !Number.isFinite(k.y)) return `Curve key ${i} must have finite x and y.`;
    if (k.x < 0 || k.x > 1) return `Curve key ${i} x ${k.x} is outside [0,1].`;
    if (k.x <= prev) return `Curve key ${i} x must be strictly greater than the previous key.`;
    if (k.y < bounds.min || k.y > bounds.max) return `Curve key ${i} y ${k.y} is outside [${bounds.min},${bounds.max}].`;
    prev = k.x;
  }
  return undefined;
}

/** Precomputed sampler; `constant` is set when every key has the same y (callers may skip per-particle work). */
export type LifeCurveSampler = { xs: Float64Array; ys: Float64Array; hold: boolean; constant: number | undefined };

/** Builds a sampler from an already validated curve. Does not mutate the curve. */
export function compileLifeCurve(curve: CurveValue): LifeCurveSampler {
  const xs = Float64Array.from(curve.keys, k => k.x);
  const ys = Float64Array.from(curve.keys, k => k.y);
  const constant = ys.every(y => y === ys[0]) ? ys[0] : undefined;
  return { xs, ys, hold: curve.interpolation === 'hold', constant };
}

/** Samples at life fraction t (endpoint clamp, linear or hold). Allocation-free. */
export function sampleLifeCurve(s: LifeCurveSampler, t: number): number {
  if (s.constant !== undefined) return s.constant;
  const { xs, ys } = s;
  const n = xs.length;
  if (t <= xs[0]) return ys[0];
  if (t >= xs[n - 1]) return ys[n - 1];
  let i = 1;
  while (xs[i] <= t) i++;
  if (s.hold) return ys[i - 1];
  return ys[i - 1] + (ys[i] - ys[i - 1]) * ((t - xs[i - 1]) / (xs[i] - xs[i - 1]));
}
