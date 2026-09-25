import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Vec3 } from '../src/model/types.ts';
import { branchId, branchPaths, type BranchOptionsInput } from '../src/runtime/branches.ts';
import { linePath, pointAtArcFraction, type PathData } from '../src/runtime/paths.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

const opts = (over: Partial<BranchOptionsInput> = {}): BranchOptionsInput => ({ documentSeed: 7, randomStreamId: 'bolt', ...over });
const parents = (): PathData[] => [
  linePath('a', [-1, 1, 0], [1, 1, 0], 5),
  linePath('b', [0, 2, 0], [0, 4, 0], 3),
  { id: 'c', points: [[0, 0, 0], [1, 0, 0], [1, 0, 2]], widthScale: 0.5, opacityScale: 0.8 },
];

test('total mode yields count total; perParent yields count per parent', () => {
  assert.equal(branchPaths(parents(), opts({ count: 7 })).branches.length, 7);
  assert.equal(branchPaths(parents(), opts({ count: 7, countMode: 'perParent' })).branches.length, 21);
  assert.equal(branchPaths([], opts()).branches.length, 0);
  assert.equal(branchPaths(parents(), opts({ count: 0 })).branches.length, 0);
});

test('trunks are exact non-aliased clones and never appear in branches', () => {
  const input = parents();
  const { trunks, branches } = branchPaths(input, opts());
  assert.deepEqual(trunks, input);
  assert.notEqual(trunks[0].points, input[0].points);
  assert.notEqual(trunks[0].points[0], input[0].points[0]);
  const trunkIds = new Set(input.map((p) => p.id));
  for (const b of branches) assert.ok(!trunkIds.has(b.id));
  assert.equal(new Set(branches.map((b) => b.id)).size, branches.length);
});

test('input order invariance in both modes', () => {
  for (const countMode of ['total', 'perParent'] as const) {
    const a = branchPaths(parents(), opts({ count: 5, countMode })).branches;
    const b = branchPaths(parents().reverse(), opts({ count: 5, countMode })).branches;
    assert.deepEqual(b, a);
  }
});

test('attachment equals interpolated parent point within the arc-length range', () => {
  const p = parents()[2];
  const { branches } = branchPaths([p], opts({ count: 32, attachmentMin: 0.3, attachmentMax: 0.6 }));
  for (const b of branches) {
    const s = b.points[0];
    // parent c: segment 1 has length 1 along +X at y=z=0, segment 2 length 2 along +Z at x=1.
    const d = s[2] > 0 ? 1 + s[2] : s[0];
    assert.ok(d >= 0.3 * 3 - 1e-9 && d <= 0.6 * 3 + 1e-9, `arc distance ${d}`);
    pointAtArcFraction(p.points, d / 3).forEach((x, i) => near(x, s[i]));
    assert.ok(s[1] === 0 && (s[2] === 0 || s[0] === 1), 'start lies on a parent segment');
  }
});

test('length, width and opacity stay in ranges; direction within tangent cone', () => {
  const [a] = parents();
  const o = opts({ count: 64, lengthMin: 0.5, lengthMax: 1.5, spread: 0.4, widthMin: 0.2, widthMax: 0.4 });
  const { branches } = branchPaths([{ ...a, widthScale: 2, opacityScale: 0.5 }], o);
  for (const b of branches) {
    const v = sub(b.points[1], b.points[0]);
    const l = len(v);
    assert.ok(l >= 0.5 - 1e-9 && l <= 1.5 + 1e-9);
    const cos = dot(v, [1, 0, 0]) / l;
    assert.ok(cos >= Math.cos(0.4) - 1e-9, `angle ${Math.acos(cos)}`);
    assert.ok(b.widthScale >= 0.4 - 1e-9 && b.widthScale <= 0.8 + 1e-9);
    assert.ok(b.opacityScale >= 0.1 - 1e-9 && b.opacityScale <= 0.24 + 1e-9);
    for (const q of b.points) q.forEach((x) => assert.ok(Number.isFinite(x)));
  }
  const clamped = branchPaths([{ ...a, widthScale: 10, opacityScale: 10 }], opts({ count: 3 })).branches;
  for (const b of clamped) { assert.equal(b.widthScale, 1); assert.equal(b.opacityScale, 1); }
});

test('spread 0 follows the tangent exactly; ranges are sampled independently', () => {
  const [a] = parents();
  const base = branchPaths([a], opts({ count: 8, spread: 0 })).branches;
  for (const b of base) {
    const v = sub(b.points[1], b.points[0]);
    near(v[1], 0); near(v[2], 0); assert.ok(v[0] > 0);
  }
  const moreSpread = branchPaths([a], opts({ count: 8, spread: 2 })).branches;
  const longer = branchPaths([a], opts({ count: 8, lengthMin: 3, lengthMax: 4 })).branches;
  base.forEach((b, i) => {
    assert.deepEqual(moreSpread[i].points[0], b.points[0]);
    assert.equal(moreSpread[i].widthScale, b.widthScale);
    assert.deepEqual(longer[i].points[0], b.points[0]);
  });
});

test('ground clamp only when explicit and only moves the endpoint', () => {
  const low = linePath('low', [-1, 0.1, 0], [1, 0.1, 0], 2);
  const o = opts({ count: 64, spread: Math.PI, lengthMin: 1, lengthMax: 1 });
  const free = branchPaths([low], o).branches;
  assert.ok(free.some((b) => b.points[1][1] < 0));
  const clamped = branchPaths([low], { ...o, groundEndClamp: true, groundY: 0 }).branches;
  clamped.forEach((b, i) => {
    assert.deepEqual(b.points[0], free[i].points[0]);
    assert.equal(b.points[1][1], Math.max(0, free[i].points[1][1]));
    assert.equal(b.points[1][0], free[i].points[1][0]);
  });
});

test('identities are deterministic across replays and survive unrelated parents', () => {
  const o = opts({ count: 6 });
  assert.deepEqual(branchPaths(parents(), o), branchPaths(parents(), o));
  const before = branchPaths(parents(), o).branches;
  const after = branchPaths([...parents(), linePath('z', [5, 5, 5], [6, 6, 6], 2)], o).branches;
  const byIdAfter = new Map(after.map((b) => [b.id, b]));
  let persisted = 0;
  for (const b of before) {
    const same = byIdAfter.get(b.id);
    if (same) { assert.deepEqual(same, b); persisted += 1; }
  }
  assert.ok(persisted > 0);
  const per = branchPaths(parents(), opts({ count: 2, countMode: 'perParent' })).branches.map((b) => b.id);
  assert.deepEqual(per, ['a', 'a', 'b', 'b', 'c', 'c'].map((p, i) => branchId(p, i % 2)));
});

test('exact slot persistence: total 12 over 3->4 parents keeps slots 0..2; perParent keeps all', () => {
  // 12/3 = 4 slots each before, 12/4 = 3 each after: slots b0..b2 of a,b,c persist exactly (hash-independent).
  const o = opts({ count: 12 });
  const before = branchPaths(parents(), o).branches;
  const after = new Map(branchPaths([...parents(), linePath('z', [5, 5, 5], [6, 6, 6], 2)], o).branches.map((b) => [b.id, b]));
  assert.deepEqual(before.map((b) => b.id).sort(), ['a', 'b', 'c'].flatMap((p) => [0, 1, 2, 3].map((k) => branchId(p, k))).sort());
  const kept = before.filter((b) => after.has(b.id));
  assert.equal(kept.length, 9);
  assert.deepEqual(kept.map((b) => b.id).sort(), ['a', 'b', 'c'].flatMap((p) => [0, 1, 2].map((k) => branchId(p, k))).sort());
  for (const b of kept) assert.deepEqual(after.get(b.id), b);
  const perO = opts({ count: 3, countMode: 'perParent' });
  const perBefore = branchPaths(parents(), perO).branches;
  const perAfter = branchPaths([...parents(), linePath('z', [5, 5, 5], [6, 6, 6], 2)], perO).branches;
  assert.equal(perAfter.length, 12);
  assert.deepEqual(perAfter.slice(0, 9), perBefore);
});

test('same semantic path id and stream across different editor object ids gives same geometry', () => {
  // Two editor nodes (original and Preserve-pattern copy) have distinct object ids but share the
  // stream and generate the same pattern-local semantic path ids (generation index -> "p<i>").
  const generate = (_objectId: string): PathData[] => [0, 1].map((i) => linePath(`p${i}`, [i, 0, 0], [i, 3, 1], 4));
  const nodeA = { objectId: 'node_A1', randomStreamId: 'bolt' };
  const nodeB = { objectId: 'node_copy_9', randomStreamId: 'bolt' };
  const ra = branchPaths(generate(nodeA.objectId), opts({ randomStreamId: nodeA.randomStreamId, count: 5 }));
  const rb = branchPaths(generate(nodeB.objectId), opts({ randomStreamId: nodeB.randomStreamId, count: 5 }));
  assert.deepEqual(rb, ra);
  const other = branchPaths(generate(nodeB.objectId), opts({ randomStreamId: 'bolt2', count: 5 }));
  assert.notDeepEqual(other.branches.map((b) => b.points), ra.branches.map((b) => b.points));
});

test('overflowing branch endpoints are rejected instead of emitting Infinity', () => {
  const huge = linePath('h', [1e308, 0, 0], [1.5e308, 0, 0], 2);
  const o = opts({ count: 1, spread: 0, lengthMin: Number.MAX_VALUE, lengthMax: Number.MAX_VALUE });
  assert.throws(() => branchPaths([huge], o), RangeError);
});

test('total mode deals round-robin over rank order', () => {
  const o = opts({ count: 4 });
  // Golden order for seed 7 / stream bolt: rank(a)=0.3002940269652754,
  // rank(c)=0.5879938518628478, rank(b)=0.6107966869603842.
  const ids = branchPaths(parents(), o).branches.map((b) => b.id);
  assert.deepEqual(ids, [branchId('a', 0), branchId('a', 1), branchId('c', 0), branchId('b', 0)]);
});

test('degenerate parents pass through without branches or NaNs', () => {
  const zero: PathData = { id: 'z', points: [[1, 1, 1], [1, 1, 1]], widthScale: 1, opacityScale: 1 };
  const single: PathData = { id: 's', points: [[0, 0, 0]], widthScale: 1, opacityScale: 1 };
  const r = branchPaths([zero, single], opts({ countMode: 'perParent' }));
  assert.equal(r.trunks.length, 2);
  assert.equal(r.branches.length, 0);
  const withRepeat: PathData = { id: 'r', points: [[0, 0, 0], [0, 0, 0], [1, 0, 0], [1, 0, 0]], widthScale: 1, opacityScale: 1 };
  for (const b of branchPaths([withRepeat], opts({ count: 16, attachmentMin: 0, attachmentMax: 1 })).branches) {
    b.points.flat().forEach((x) => assert.ok(Number.isFinite(x)));
  }
});

test('invalid options and parents are rejected', () => {
  const p = parents();
  assert.throws(() => branchPaths(p, opts({ count: 65 })), RangeError);
  assert.throws(() => branchPaths(p, opts({ count: 1.5 })), RangeError);
  assert.throws(() => branchPaths(p, opts({ attachmentMin: 0.9, attachmentMax: 0.1 })), RangeError);
  assert.throws(() => branchPaths(p, opts({ attachmentMax: 1.2 })), RangeError);
  assert.throws(() => branchPaths(p, opts({ lengthMin: -1 })), RangeError);
  assert.throws(() => branchPaths(p, opts({ spread: 4 })), RangeError);
  assert.throws(() => branchPaths(p, opts({ widthMax: Number.NaN })), RangeError);
  assert.throws(() => branchPaths(p, opts({ countMode: 'each' as never })), TypeError);
  assert.throws(() => branchPaths(p, opts({ randomStreamId: 'bad id' })), TypeError);
  assert.throws(() => branchPaths([p[0], p[0]], opts()), RangeError);
  assert.throws(() => branchPaths([{ ...p[0], points: [[0, Number.NaN, 0]] }], opts()), TypeError);
});
