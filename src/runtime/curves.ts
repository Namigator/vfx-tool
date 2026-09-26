// Pure authored-curve evaluation (EffectTimeCurve driver). No DOM, React or Three.
// Linear or hold interpolation between sorted keys; x outside the key range clamps to the endpoint key.
// Malformed curves throw RangeError/TypeError (callers turn them into addressed diagnostics); values are
// never silently clamped into bounds.
import type { CurveValue } from '../model/types.ts';

export type CurveBounds = { min: number; max: number };

/** Validates keys (>= 1, finite, strictly increasing x, y within bounds when given). Throws on error. */
export function checkCurve(curve: CurveValue, bounds?: CurveBounds): void {
  if (curve === null || typeof curve !== 'object' || !Array.isArray(curve.keys)) throw new TypeError('Curve must be {domain, interpolation, keys}.');
  if (curve.interpolation !== 'linear' && curve.interpolation !== 'hold') throw new RangeError(`Curve interpolation must be "linear" or "hold"; got ${String(curve.interpolation)}.`);
  if (curve.keys.length < 1) throw new RangeError('Curve needs at least one key.');
  let prev = -Infinity;
  curve.keys.forEach((k, i) => {
    if (k === null || typeof k !== 'object') throw new TypeError(`Curve key ${i} must be {x, y}.`);
    if (typeof k.x !== 'number' || !Number.isFinite(k.x)) throw new RangeError(`Curve key ${i} x must be finite; got ${String(k.x)}.`);
    if (typeof k.y !== 'number' || !Number.isFinite(k.y)) throw new RangeError(`Curve key ${i} y must be finite; got ${String(k.y)}.`);
    if (k.x <= prev) throw new RangeError(`Curve key ${i} x must be strictly greater than the previous key.`);
    if (bounds && (k.y < bounds.min || k.y > bounds.max)) throw new RangeError(`Curve key ${i} y ${k.y} is outside [${bounds.min},${bounds.max}].`);
    prev = k.x;
  });
}

/** Evaluates the curve at x. Does not mutate the curve. */
export function evaluateCurve(curve: CurveValue, x: number, bounds?: CurveBounds): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new RangeError(`Curve input must be finite; got ${String(x)}.`);
  checkCurve(curve, bounds);
  const keys = curve.keys;
  if (x <= keys[0].x) return keys[0].y;
  const last = keys[keys.length - 1];
  if (x >= last.x) return last.y;
  let i = 1;
  while (keys[i].x <= x) i++;
  const a = keys[i - 1], b = keys[i];
  if (curve.interpolation === 'hold') return a.y;
  return a.y + (b.y - a.y) * ((x - a.x) / (b.x - a.x));
}
