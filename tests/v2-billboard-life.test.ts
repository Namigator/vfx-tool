import test from 'node:test';
import assert from 'node:assert/strict';
import type { CurveValue } from '../src/model/types.ts';
import {
  compileLifeCurve, flatLifeCurve, lifeCurveError, lifeFraction, OPACITY_OVER_LIFE_BOUNDS, sampleLifeCurve, SIZE_OVER_LIFE_BOUNDS,
} from '../src/render/billboardLife.ts';

const curve = (interpolation: 'linear' | 'hold', keys: [number, number][]): CurveValue =>
  ({ domain: 'normalized', interpolation, keys: keys.map(([x, y]) => ({ x, y })) });

test('lifeFraction interpolates within a tick and clamps to [0,1]', () => {
  assert.equal(lifeFraction(0, 60, 0), 0);
  assert.equal(lifeFraction(30, 60, 0), 0.5);
  assert.equal(lifeFraction(29, 60, 0.5), 29.5 / 60);
  assert.ok(lifeFraction(59, 60, 0.999) < 1);
  assert.equal(lifeFraction(80, 60, 0), 1);
  assert.equal(lifeFraction(-5, 60, 0), 0);
  assert.equal(lifeFraction(3, 0, 0), 1);
  assert.equal(lifeFraction(Number.NaN, 60, 0), 1);
});

test('sampler matches linear and hold semantics with endpoint clamp', () => {
  const lin = compileLifeCurve(curve('linear', [[0.25, 0], [0.75, 2], [1, 1]]));
  assert.equal(sampleLifeCurve(lin, 0), 0);
  assert.equal(sampleLifeCurve(lin, 0.5), 1);
  assert.equal(sampleLifeCurve(lin, 0.875), 1.5);
  assert.equal(sampleLifeCurve(lin, 1), 1);
  const hold = compileLifeCurve(curve('hold', [[0, 1], [0.5, 0.25]]));
  assert.equal(sampleLifeCurve(hold, 0.49), 1);
  assert.equal(sampleLifeCurve(hold, 0.5), 0.25);
  assert.equal(sampleLifeCurve(hold, 1), 0.25);
});

test('flat default is detected as constant 1', () => {
  const s = compileLifeCurve(flatLifeCurve());
  assert.equal(s.constant, 1);
  assert.equal(sampleLifeCurve(s, 0.37), 1);
  assert.equal(compileLifeCurve(curve('linear', [[0, 1], [1, 0]])).constant, undefined);
});

test('lifeCurveError enforces normalized domain, x in [0,1] and y bounds', () => {
  assert.equal(lifeCurveError(flatLifeCurve(), SIZE_OVER_LIFE_BOUNDS), undefined);
  assert.equal(lifeCurveError(curve('linear', [[0, 0], [1, 20]]), SIZE_OVER_LIFE_BOUNDS), undefined);
  assert.match(lifeCurveError(curve('linear', [[0, 0], [1, 21]]), SIZE_OVER_LIFE_BOUNDS)!, /outside \[0,20\]/);
  assert.match(lifeCurveError(curve('linear', [[0, 1.2]]), OPACITY_OVER_LIFE_BOUNDS)!, /outside \[0,1\]/);
  assert.match(lifeCurveError(curve('linear', [[0, 1], [1.5, 1]]), OPACITY_OVER_LIFE_BOUNDS)!, /x 1.5/);
  assert.match(lifeCurveError(curve('linear', [[0.5, 1], [0.5, 1]]), OPACITY_OVER_LIFE_BOUNDS)!, /strictly greater/);
  assert.match(lifeCurveError({ ...flatLifeCurve(), domain: 'effectSeconds' }, OPACITY_OVER_LIFE_BOUNDS)!, /normalized/);
});

test('compileLifeCurve does not mutate its input', () => {
  const c = curve('linear', [[0, 0], [1, 3]]);
  const before = JSON.stringify(c);
  compileLifeCurve(c);
  assert.equal(JSON.stringify(c), before);
});
