import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Vec3 } from '../src/model/types.ts';
import {
  bezierPath, jaggedPath, linePath, pathLength, pointAtArcFraction, regenerationIndex,
  resampleByArcLength, revealPath, stableFrame, type JaggedOptions,
} from '../src/runtime/paths.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const jag = (over: Partial<JaggedOptions> = {}): JaggedOptions => ({
  documentSeed: 7, randomStreamId: 'bolt', pathOrdinal: 0, amplitude: 0.3, samples: 42,
  regenerationHz: 24, effectLocalSeconds: 0, pinned: true, ...over,
});

test('linePath keeps exact endpoints and independent straight length', () => {
  const s: Vec3 = [-1, 0.1, 3];
  const e: Vec3 = [2.5, -4, 0.25];
  const p = linePath('main', s, e, 42);
  assert.equal(p.points.length, 42);
  assert.deepEqual(p.points[0], s);
  assert.deepEqual(p.points[41], e);
  assert.notEqual(p.points[0], s);
  near(pathLength(p.points), Math.hypot(3.5, -4.1, -2.75), 1e-9);
  assert.equal(p.widthScale, 1);
  assert.equal(p.opacityScale, 1);
});

test('resample hits cumulative polyline arc targets', () => {
  const poly: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 3, 0]];
  const out = resampleByArcLength(poly, 5);
  assert.deepEqual(out, [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 2, 0], [1, 3, 0]]);
  assert.deepEqual(resampleByArcLength([], 4), []);
  assert.deepEqual(resampleByArcLength([[2, 2, 2]], 3), [[2, 2, 2], [2, 2, 2], [2, 2, 2]]);
  near(pathLength([]), 0);
  near(pathLength([[1, 1, 1]]), 0);
  assert.throws(() => pointAtArcFraction([], 0.5), RangeError);
  assert.deepEqual(pointAtArcFraction(poly, 0.5), [1, 1, 0]);
});

test('bezier samples exact endpoints and are evenly spaced along its own polyline', () => {
  const p = bezierPath('arch', [0, 0, 0], [0, 2, 0], [3, 2, 0], [3, 0, 0], 64);
  assert.deepEqual(p.points[0], [0, 0, 0]);
  assert.deepEqual(p.points[63], [3, 0, 0]);
  // Straight Bezier with collinear controls equals the line.
  const straight = bezierPath('s', [0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], 4);
  straight.points.forEach((q, i) => { near(q[0], i, 1e-9); near(q[1], 0); });
  // Midpoint of symmetric arch lies on the symmetry axis.
  near(pointAtArcFraction(p.points, 0.5)[0], 1.5, 1e-6);
});

test('stable frame follows the frozen definition', () => {
  const f = stableFrame([0, 0, 0], [2, 0, 0]);
  assert.deepEqual(f.t, [1, 0, 0]);
  assert.deepEqual(f.n1, [0, 0, 1]);
  assert.deepEqual(f.n2, [0, -1, 0]);
  const v = stableFrame([0, 0, 0], [0, 5, 0]);
  assert.deepEqual(v.t, [0, 1, 0]);
  assert.deepEqual(v.n1, [0, 0, -1]);
  assert.deepEqual(stableFrame([1, 1, 1], [1, 1, 1]).t, [1, 0, 0]);
});

test('regeneration boundaries at 24 Hz and frozen at 0 Hz', () => {
  assert.equal(regenerationIndex(0, 24), 0);
  assert.equal(regenerationIndex(1 / 24 - 1e-9, 24), 0);
  assert.equal(regenerationIndex(1, 24), 24);
  assert.equal(regenerationIndex(1000, 0), 0);
  assert.throws(() => regenerationIndex(-1, 24), RangeError);
  assert.throws(() => regenerationIndex(1, Number.NaN), RangeError);
  assert.throws(() => regenerationIndex(1e9, 60), RangeError);
});

test('jagged is deterministic per regeneration, stream-sensitive and id-independent', () => {
  const base = linePath('a', [-1, 0, 0], [1, 0, 0], 42);
  const a0 = jaggedPath(base, jag({ effectLocalSeconds: 0.01 }));
  const a0b = jaggedPath(base, jag({ effectLocalSeconds: 0.04 }));
  const a1 = jaggedPath(base, jag({ effectLocalSeconds: 1 / 24 + 1e-6 }));
  assert.deepEqual(a0.points, a0b.points);
  assert.notDeepEqual(a0.points, a1.points);
  const renamed = jaggedPath({ ...base, id: 'other' }, jag({ effectLocalSeconds: 0.01 }));
  assert.deepEqual(renamed.points, a0.points);
  assert.equal(renamed.id, 'other');
  assert.notDeepEqual(jaggedPath(base, jag({ randomStreamId: 'bolt2' })).points, a0.points);
  assert.notDeepEqual(jaggedPath(base, jag({ pathOrdinal: 1 })).points, a0.points);
  const frozen = jaggedPath(base, jag({ regenerationHz: 0, effectLocalSeconds: 0 }));
  assert.deepEqual(jaggedPath(base, jag({ regenerationHz: 0, effectLocalSeconds: 99 })).points, frozen.points);
});

test('pinned jagged keeps exact endpoints, stays in plane and within taper bound', () => {
  const base = linePath('a', [-1, 0, 0], [1, 0, 0], 42);
  const snapshot = structuredClone(base);
  for (let tick = 0; tick < 30; tick += 1) {
    const out = jaggedPath(base, jag({ effectLocalSeconds: tick / 24 }));
    assert.deepEqual(out.points[0], [-1, 0, 0]);
    assert.deepEqual(out.points[41], [1, 0, 0]);
    out.points.forEach((q, i) => {
      const u = i / 41;
      const offset: Vec3 = [q[0] - base.points[i][0], q[1] - base.points[i][1], q[2] - base.points[i][2]];
      near(dot(offset, [1, 0, 0]), 0, 1e-12);
      assert.ok(Math.hypot(...offset) <= 0.3 * Math.SQRT2 * Math.sin(Math.PI * u) + 1e-12);
    });
  }
  assert.deepEqual(base, snapshot);
  const unpinned = jaggedPath(base, jag({ pinned: false }));
  assert.ok(unpinned.points.some((q, i) => dist(q, base.points[i]) > 0));
  const zero = jaggedPath(linePath('z', [1, 2, 3], [1, 2, 3], 5), jag({ samples: 5 }));
  zero.points.forEach((q) => assert.deepEqual(q, [1, 2, 3]));
  assert.deepEqual(jaggedPath({ ...base, points: [] }, jag()).points, []);
});

test('reveal clips at interpolated arc length', () => {
  const base = { ...linePath('r', [-1, 0, 0], [1, 0, 0], 5), widthScale: 0.5, opacityScale: 0.3 };
  const half = revealPath(base, 0.5);
  assert.deepEqual(half.points, [[-1, 0, 0], [-0.5, 0, 0], [0, 0, 0]]);
  near(pathLength(half.points), 1);
  assert.equal(half.widthScale, 0.5);
  const partial = revealPath(base, 0.3);
  near(pathLength(partial.points), 0.6, 1e-12);
  assert.deepEqual(revealPath(base, 0).points, []);
  const full = revealPath(base, 1);
  assert.deepEqual(full.points, base.points);
  assert.notEqual(full.points[0], base.points[0]);
  assert.deepEqual(revealPath({ ...base, points: [] }, 0.5).points, []);
  const degenerate = revealPath({ ...base, points: [[2, 2, 2], [2, 2, 2]] }, 0.5);
  degenerate.points.forEach((q) => assert.ok(q.every(Number.isFinite)));
});

test('invalid inputs are rejected', () => {
  const base = linePath('a', [0, 0, 0], [1, 0, 0], 4);
  assert.throws(() => linePath('a', [0, Number.NaN, 0], [1, 0, 0], 4), TypeError);
  assert.throws(() => linePath('a', [0, 0, 0], [1, 0, 0], 1), RangeError);
  assert.throws(() => linePath('a', [0, 0, 0], [1, 0, 0], 129), RangeError);
  assert.throws(() => resampleByArcLength([[0, 0, 0]], 2.5), RangeError);
  assert.throws(() => pointAtArcFraction(base.points, 1.1), RangeError);
  assert.throws(() => revealPath(base, -0.1), RangeError);
  assert.throws(() => revealPath({ ...base, widthScale: -1 }, 0.5), RangeError);
  assert.throws(() => jaggedPath(base, jag({ amplitude: -0.1 })), RangeError);
  assert.throws(() => jaggedPath(base, jag({ amplitude: Number.POSITIVE_INFINITY })), RangeError);
  assert.throws(() => jaggedPath(base, jag({ pathOrdinal: -1 })), RangeError);
  assert.throws(() => jaggedPath(base, jag({ randomStreamId: 'bad id' })), TypeError);
  assert.throws(() => jaggedPath(base, jag({ effectLocalSeconds: -1 })), RangeError);
});
