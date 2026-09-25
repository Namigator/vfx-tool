import test from 'node:test';
import { BufferAttribute } from 'three';
import assert from 'node:assert/strict';
import type { Vec3 } from '../src/model/types.ts';
import type { PathData } from '../src/runtime/paths.ts';
import { RIBBON_MITER_LIMIT, RibbonGeometry } from '../src/render/RibbonGeometry.ts';

const path = (points: Vec3[], widthScale = 1, opacityScale = 1): PathData => ({ id: 'p', points, widthScale, opacityScale });
const cam: Vec3 = [0, 0, 10];

function positions(r: RibbonGeometry, count: number): number[] {
  return Array.from((r.geometry.getAttribute('position').array as Float32Array).subarray(0, count * 3));
}
function vertex(r: RibbonGeometry, i: number): Vec3 {
  const a = r.geometry.getAttribute('position').array as Float32Array;
  return [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
}
function indices(r: RibbonGeometry, count: number): number[] {
  return Array.from((r.geometry.getIndex()!.array as Uint32Array).subarray(0, count));
}

test('vertex/index counts: one quad per segment, no bevel on straight joins', () => {
  const r = new RibbonGeometry();
  const stats = r.update([path([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]])], { cameraPosition: cam, width: 1, endFade: 0 });
  assert.equal(stats.vertexCount, 12);
  assert.equal(stats.indexCount, 18);
  assert.equal(stats.drawnPaths, 1);
  assert.equal(r.geometry.drawRange.count, 18);
  assert.ok(positions(r, 12).every(Number.isFinite));
  for (const i of indices(r, 18)) assert.ok(i < 12);
  // A 90° turn adds a round join: centre + 3 arc vertices, one fan triangle per π/8 (4).
  const bent = r.update([path([[0, 0, 0], [1, 0, 0], [1, 1, 0]])], { cameraPosition: cam, width: 1, endFade: 0 });
  assert.equal(bent.vertexCount, 12);
  assert.equal(bent.indexCount, 24);
  r.dispose();
});

test('width is perpendicular to tangent and view under a simple camera', () => {
  const r = new RibbonGeometry();
  r.update([path([[0, 0, 0], [2, 0, 0]], 0.5)], { cameraPosition: cam, width: 4, endFade: 0 });
  const [l0, r0] = [vertex(r, 0), vertex(r, 1)];
  // Tangent +X, view +Z → offset along Y; full width = 4 * 0.5.
  assert.ok(Math.abs(l0[0]) < 1e-6 && Math.abs(r0[0]) < 1e-6);
  assert.ok(Math.abs(l0[2]) < 1e-6 && Math.abs(r0[2]) < 1e-6);
  assert.ok(Math.abs(Math.abs(l0[1] - r0[1]) - 2) < 1e-6);
  assert.ok(Math.abs(l0[1] + r0[1]) < 1e-6);
  const op = r.geometry.getAttribute('opacity').array as Float32Array;
  assert.equal(op[0], 1);
  r.dispose();
});

test('camera parallel to tangent uses a stable finite fallback', () => {
  const r = new RibbonGeometry();
  const stats = r.update([path([[0, 0, 0], [0, 0, 1]])], { cameraPosition: [0, 0, 5], width: 1, endFade: 0 });
  assert.equal(stats.vertexCount, 4);
  const p = positions(r, 4);
  assert.ok(p.every(Number.isFinite));
  const [a, b] = [vertex(r, 0), vertex(r, 1)];
  assert.ok(Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) - 1) < 1e-6);
  assert.ok(Math.abs(a[2] - b[2]) < 1e-6, 'side stays perpendicular to tangent');
  // Camera sitting exactly on a point is also finite.
  r.update([path([[0, 0, 10], [1, 0, 10]])], { cameraPosition: cam, width: 1 });
  assert.ok(positions(r, 4).every(Number.isFinite));
  r.dispose();
});

test('multiple paths are discontinuous and carry per-path opacity', () => {
  const r = new RibbonGeometry();
  const stats = r.update([
    path([[0, 0, 0], [1, 0, 0]], 1, 0.25),
    path([[5, 0, 0], [6, 0, 0], [7, 0, 0]], 1, 0.75),
  ], { cameraPosition: cam, width: 1, endFade: 0 });
  assert.equal(stats.vertexCount, 12);
  assert.equal(stats.indexCount, 18);
  const idx = indices(r, 18);
  const first = idx.slice(0, 6);
  const rest = idx.slice(6);
  assert.ok(first.every((i) => i < 4));
  assert.ok(rest.every((i) => i >= 4 && i < 12));
  const op = Array.from((r.geometry.getAttribute('opacity').array as Float32Array).subarray(0, 12));
  assert.deepEqual(op, [0.25, 0.25, 0.25, 0.25, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75]);
  r.dispose();
});

test('update reuses storage within capacity and grows within budget', () => {
  const r = new RibbonGeometry({ initialPoints: 4, maxPoints: 10 });
  r.update([path([[0, 0, 0], [1, 0, 0], [2, 0, 0]])], { cameraPosition: cam, width: 1 });
  const pos = r.geometry.getAttribute('position');
  assert.ok(pos instanceof BufferAttribute);
  const posArray = pos.array;
  const v0 = pos.version;
  r.update([path([[0, 1, 0], [1, 1, 0], [2, 1, 0], [3, 1, 0]])], { cameraPosition: cam, width: 1 });
  assert.equal(r.geometry.getAttribute('position'), pos);
  assert.equal(r.geometry.getAttribute('position').array, posArray);
  assert.ok(pos.version > v0);
  const pts: Vec3[] = Array.from({ length: 9 }, (_, i): Vec3 => [i, 0, 0]);
  const stats = r.update([path(pts)], { cameraPosition: cam, width: 1 });
  // 8 quads + 2 collinear fade-transition splits (arc 0.96 and 7.04) = 10 quads.
  assert.equal(stats.vertexCount, 36);
  assert.ok(r.pointCapacity >= 9 && r.pointCapacity <= 10);
  assert.throws(() => r.update([path(Array.from({ length: 11 }, (_, i): Vec3 => [i, 0, 0]))], { cameraPosition: cam, width: 1 }), RangeError);
  r.dispose();
});

test('degenerate input: short/zero-length paths skipped, duplicate points emit no triangles', () => {
  const r = new RibbonGeometry();
  const stats = r.update([
    path([]),
    path([[1, 1, 1]]),
    path([[2, 2, 2], [2, 2, 2]]),
    path([[0, 0, 0], [1, 0, 0], [1, 0, 0], [2, 0, 0]]),
  ], { cameraPosition: cam, width: 1 });
  assert.equal(stats.drawnPaths, 1);
  // 2 segment quads, each split once; each split shares its two boundary vertices.
  assert.equal(stats.vertexCount, 12);
  assert.equal(stats.skippedSegments, 1);
  assert.equal(stats.indexCount, 24);
  assert.ok(positions(r, 12).every(Number.isFinite));
  const empty = r.update([], { cameraPosition: cam, width: 1 });
  assert.equal(empty.indexCount, 0);
  assert.equal(r.geometry.drawRange.count, 0);
  assert.throws(() => r.update([path([[0, 0, 0], [Number.NaN, 0, 0]])], { cameraPosition: cam, width: 1 }), TypeError);
  assert.throws(() => r.update([path([[0, 0, 0], [1, 0, 0]])], { cameraPosition: cam, width: -1 }), RangeError);
  r.dispose();
});

test('sparse point arrays fail validation with an indexed message', () => {
  const r = new RibbonGeometry();
  const sparse: Vec3[] = [[0, 0, 0]];
  sparse[2] = [2, 0, 0];
  assert.throws(() => r.update([path(sparse)], { cameraPosition: cam, width: 1 }),
    (e: unknown) => e instanceof TypeError && /paths\[0\]\.points\[1\] must be a finite Vec3/.test(e.message));
  r.dispose();
});

test('large→small update: live-only bounds and upload ranges', () => {
  const r = new RibbonGeometry({ initialPoints: 16, maxPoints: 16 });
  r.update([path(Array.from({ length: 16 }, (_, i): Vec3 => [i * 100, 0, 0]))], { cameraPosition: cam, width: 1 });
  const box = r.geometry.boundingBox!;
  const sphere = r.geometry.boundingSphere!;
  r.update([path([[0, 0, 0], [1, 0, 0]])], { cameraPosition: cam, width: 2, endFade: 0 });
  assert.equal(r.geometry.boundingBox, box, 'Box3 reused');
  assert.equal(r.geometry.boundingSphere, sphere, 'Sphere reused');
  assert.ok(Math.abs(box.min.x) < 1e-6 && Math.abs(box.max.x - 1) < 1e-6, 'stale far vertices excluded');
  assert.ok(Math.abs(box.min.y + 1) < 1e-6 && Math.abs(box.max.y - 1) < 1e-6);
  assert.ok(sphere.radius > 0 && sphere.radius < 2);
  const pos = r.geometry.getAttribute('position') as BufferAttribute;
  const op = r.geometry.getAttribute('opacity') as BufferAttribute;
  const idx = r.geometry.getIndex()!;
  assert.deepEqual(pos.updateRanges, [{ start: 0, count: 12 }]);
  assert.deepEqual(op.updateRanges, [{ start: 0, count: 4 }]);
  assert.deepEqual(idx.updateRanges, [{ start: 0, count: 6 }]);
  r.update([], { cameraPosition: cam, width: 1 });
  assert.ok(box.isEmpty());
  assert.ok(sphere.isEmpty());
  assert.deepEqual(pos.updateRanges, []);
  r.dispose();
});

test('long duplicate runs keep neighbour tangents and stay finite', () => {
  const r = new RibbonGeometry({ maxPoints: 5002, initialPoints: 5002 });
  const pts: Vec3[] = [[0, 0, 0], ...Array.from({ length: 5000 }, (): Vec3 => [1, 0, 0]), [2, 0, 0]];
  const stats = r.update([path(pts)], { cameraPosition: cam, width: 2, endFade: 0 });
  assert.equal(stats.skippedSegments, 4999);
  assert.equal(stats.indexCount, 12);
  // Second segment starts at the run end (x=1) with tangent +X, so its offset is purely Y.
  const start = vertex(r, 4);
  assert.ok(Math.abs(start[0] - 1) < 1e-6 && Math.abs(Math.abs(start[1]) - 1) < 1e-6);
  r.dispose();
});

/** Half-widths and opacities of consecutive L/R vertex pairs (side +1 then -1), in emission order. */
function pairs(r: RibbonGeometry, vertexCount: number): { w: number; op: number }[] {
  const sd = r.geometry.getAttribute('side').array as Float32Array;
  const op = r.geometry.getAttribute('opacity').array as Float32Array;
  const out: { w: number; op: number }[] = [];
  for (let i = 0; i + 1 < vertexCount; i += 1) {
    if (sd[i] !== 1 || sd[i + 1] !== -1) continue;
    const [a, b] = [vertex(r, i), vertex(r, i + 1)];
    out.push({ w: Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 2, op: op[i] });
    i += 1;
  }
  return out;
}

function distToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const ll = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = ll > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / ll)) : 0;
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}

/** Every triangle must lie inside one segment's capsule of radius `half` (capsules are convex). */
function assertNoOffPathTriangles(r: RibbonGeometry, pts: Vec3[], half: number, indexCount: number): void {
  const idx = indices(r, indexCount);
  for (let k = 0; k < idx.length; k += 3) {
    const tri = [vertex(r, idx[k]), vertex(r, idx[k + 1]), vertex(r, idx[k + 2])];
    let inside = false;
    for (let s = 0; s + 1 < pts.length && !inside; s += 1) {
      inside = tri.every((q) => distToSegment(q, pts[s], pts[s + 1]) <= half + 1e-5);
    }
    assert.ok(inside, `triangle ${k / 3} protrudes beyond the local half-width`);
  }
}

test('sharp turns bevel: no vertex beyond the half-width, outer corner filled', () => {
  const r = new RibbonGeometry();
  const turn: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0]];
  const s = r.update([path(turn)], { cameraPosition: [1, 0, 10], width: 2, endFade: 0 });
  assertNoOffPathTriangles(r, turn, 1, s.indexCount);
  // Bevel wedge joins the outer corners (1,-1) of the first quad and (2,0) of the second.
  const wedge = indices(r, s.indexCount).slice(12).map((i) => vertex(r, i));
  assert.ok(wedge.some((q) => Math.abs(q[0] - 1) < 1e-5 && Math.abs(q[1] + 1) < 1e-5));
  assert.ok(wedge.some((q) => Math.abs(q[0] - 2) < 1e-5 && Math.abs(q[1]) < 1e-5));
  // Very acute zig-zag (lightning): bounded by RIBBON_MITER_LIMIT * half, stays finite.
  for (const tipY of [0.05, 0.001, 0]) {
    const zig: Vec3[] = [[0, 0, 0], [5, tipY, 0], [0, 2 * tipY, 0]];
    const st = r.update([path(zig)], { cameraPosition: cam, width: 2, endFade: 0 });
    assert.ok(positions(r, st.vertexCount).every(Number.isFinite));
    assertNoOffPathTriangles(r, zig, RIBBON_MITER_LIMIT, st.indexCount);
    // Turns past 90° (continuity flip swaps L/R): the join fan must cover the OUTER corner,
    // reaching the tip ahead of the join point, never the inner overlap.
    const join = zig[1];
    const tl = Math.hypot(join[0], join[1]);
    const ahead = (q: Vec3) => ((q[0] - join[0]) * join[0] + (q[1] - join[1]) * join[1]) / tl;
    const fan = indices(r, st.indexCount).slice(12).map((i) => vertex(r, i));
    assert.ok(fan.length >= 3 * 7, `tipY ${tipY}: near-reversal gets a full round cap`);
    assert.ok(fan.every((q) => ahead(q) >= -1e-5), `tipY ${tipY}: fan stays on the outer side`);
    assert.ok(Math.max(...fan.map(ahead)) > 0.95, `tipY ${tipY}: fan reaches the outer tip`);
  }
  r.dispose();
});

test('short zigzag segments much shorter than the width produce no off-path shards', () => {
  const r = new RibbonGeometry();
  // Lightning-like: 0.05-long steps with alternating sharp turns and near-reversals, width 0.6.
  const pts: Vec3[] = [[0, 0, 0]];
  for (let i = 1; i < 60; i += 1) {
    const p = pts[i - 1];
    const a = i % 3 === 0 ? Math.PI * 0.97 : (i % 2 ? 1.2 : -1.3) + i * 0.01;
    pts.push([p[0] + 0.05 * Math.cos(a), p[1] + 0.05 * Math.sin(a), p[2] + (i % 5 === 0 ? 0.02 : 0)]);
  }
  for (const camera of [cam, [3, 2, 4] as Vec3, [0.5, -6, 1] as Vec3]) {
    for (const endFade of [0, 0.12]) {
      const st = r.update([path(pts, 1)], { cameraPosition: camera, width: 0.6, endFade });
      assert.ok(positions(r, st.vertexCount).every(Number.isFinite));
      assertNoOffPathTriangles(r, pts, 0.3, st.indexCount);
    }
  }
  r.dispose();
});

test('ends taper and fade by arc length; interior stays full; endFade 0 disables', () => {
  const r = new RibbonGeometry();
  const pts: Vec3[] = Array.from({ length: 11 }, (_, i): Vec3 => [i, 0, 0]);
  // Collinear: pairs are [seg0 start, seg0 end, seg1 start, ...]; point i = pair 2i (last: pair 19).
  const at = (i: number) => { const p = pairs(r, 40); return i < 10 ? p[2 * i] : p[19]; };
  r.update([path(pts, 1, 0.8)], { cameraPosition: cam, width: 2, endFade: 0.2, endWidth: 0.25 });
  assert.equal(at(0).op, 0);
  assert.equal(at(10).op, 0);
  assert.ok(Math.abs(at(0).w - 0.25) < 1e-6 && Math.abs(at(10).w - 0.25) < 1e-6);
  assert.ok(at(1).op > 0 && at(1).op < at(2).op, 'monotonic fade-in');
  for (const i of [2, 5, 8]) {
    assert.ok(Math.abs(at(i).op - 0.8) < 1e-6 && Math.abs(at(i).w - 1) < 1e-6);
  }
  // Adjacent quads share width/opacity at their common point (continuous taper).
  const all = pairs(r, 40);
  for (let s = 0; s < 9; s += 1) assert.ok(Math.abs(all[2 * s + 1].w - all[2 * s + 2].w) < 1e-6);
  // Symmetric and deterministic.
  const first = positions(r, 40);
  r.update([path(pts, 1, 0.8)], { cameraPosition: cam, width: 2, endFade: 0.2, endWidth: 0.25 });
  assert.deepEqual(positions(r, 40), first);
  assert.ok(Math.abs(at(1).w - at(9).w) < 1e-6);
  r.update([path(pts, 1, 0.8)], { cameraPosition: cam, width: 2, endFade: 0 });
  assert.ok(Math.abs(at(0).w - 1) < 1e-6 && Math.abs(at(0).op - 0.8) < 1e-6);
  assert.throws(() => r.update([path(pts)], { cameraPosition: cam, width: 1, endFade: 0.6 }), RangeError);
  assert.throws(() => r.update([path(pts)], { cameraPosition: cam, width: 1, endWidth: 2 }), RangeError);
  r.dispose();
});

test('core and glow widths stay distinct under the default taper', () => {
  const r = new RibbonGeometry();
  const pts: Vec3[] = [[0, 0, 0], [1, 0.4, 0], [2, -0.3, 0], [3, 0.2, 0]];
  const sc = r.update([path(pts, 0.3)], { cameraPosition: cam, width: 1 });
  const core = pairs(r, sc.vertexCount).map((p) => p.w);
  const sg = r.update([path(pts, 1)], { cameraPosition: cam, width: 1 });
  const glow = pairs(r, sg.vertexCount).map((p) => p.w);
  // 3 segments (6 pairs) + fade-transition splits in the first and last segment.
  assert.equal(core.length, 8);
  assert.equal(glow.length, core.length);
  core.forEach((c, i) => assert.ok(Math.abs(glow[i] / c - 1 / 0.3) < 1e-4));
  r.dispose();
});

test('sparse two-point path with default fade reaches full interior opacity on-path', () => {
  const r = new RibbonGeometry();
  const pts: Vec3[] = [[0, 0, 0], [2, 0, 0]];
  const snapshot = JSON.stringify(pts);
  const s = r.update([path(pts, 1, 0.9)], { cameraPosition: cam, width: 1 });
  assert.equal(JSON.stringify(pts), snapshot, 'input not mutated');
  // Split at arc 0.24 and 1.76: 3 collinear sub-quads sharing boundary pairs, no join fans.
  assert.equal(s.vertexCount, 8);
  assert.equal(s.indexCount, 18);
  const sd = Array.from((r.geometry.getAttribute('side').array as Float32Array).subarray(0, 8));
  assert.ok(sd.every((x) => x !== 0), 'no join centre vertices on collinear splits');
  const p = pairs(r, s.vertexCount);
  assert.equal(p[0].op, 0);
  assert.equal(p[p.length - 1].op, 0);
  assert.ok(Math.max(...p.map((q) => q.op)) > 0.89, 'interior reaches full opacity');
  // Exact start/end preserved; taper deterministic.
  const first = vertex(r, 0), last = vertex(r, 6);
  assert.ok(Math.abs(first[0]) < 1e-6 && Math.abs(last[0] - 2) < 1e-6);
  const before = positions(r, 8);
  r.update([path(pts, 1, 0.9)], { cameraPosition: cam, width: 1 });
  assert.deepEqual(positions(r, 8), before);
  assertNoOffPathTriangles(r, pts, 0.5, s.indexCount);
  // endFade 0: a single full-opacity quad.
  const z = r.update([path(pts, 1, 0.9)], { cameraPosition: cam, width: 1, endFade: 0 });
  assert.equal(z.vertexCount, 4);
  const op = Array.from((r.geometry.getAttribute('opacity').array as Float32Array).subarray(0, 4));
  assert.ok(op.every((o) => Math.abs(o - 0.9) < 1e-6));
  // endFade 0.5: both transitions coincide at the midpoint, one split.
  const h = r.update([path(pts)], { cameraPosition: cam, width: 1, endFade: 0.5 });
  assert.equal(h.vertexCount, 6);
  assert.ok(Math.max(...pairs(r, 6).map((q) => q.op)) === 1);
  r.dispose();
});

test('input is preserved and dispose blocks further updates', () => {
  const r = new RibbonGeometry();
  const input = [path([[0, 0, 0], [1, 2, 3]], 2, 0.5)];
  const snapshot = JSON.stringify(input);
  r.update(input, { cameraPosition: cam, width: 1 });
  assert.equal(JSON.stringify(input), snapshot);
  r.dispose();
  r.dispose();
  assert.throws(() => r.update(input, { cameraPosition: cam, width: 1 }));
});
