import test from 'node:test';
import { BufferAttribute } from 'three';
import assert from 'node:assert/strict';
import type { Vec3 } from '../src/model/types.ts';
import type { PathData } from '../src/runtime/paths.ts';
import { RibbonGeometry } from '../src/render/RibbonGeometry.ts';

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

test('vertex/index counts: two vertices per point, six indices per segment', () => {
  const r = new RibbonGeometry();
  const stats = r.update([path([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]])], { cameraPosition: cam, width: 1 });
  assert.equal(stats.vertexCount, 8);
  assert.equal(stats.indexCount, 18);
  assert.equal(stats.drawnPaths, 1);
  assert.equal(r.geometry.drawRange.count, 18);
  assert.ok(positions(r, 8).every(Number.isFinite));
  for (const i of indices(r, 18)) assert.ok(i < 8);
  r.dispose();
});

test('width is perpendicular to tangent and view under a simple camera', () => {
  const r = new RibbonGeometry();
  r.update([path([[0, 0, 0], [2, 0, 0]], 0.5)], { cameraPosition: cam, width: 4 });
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
  const stats = r.update([path([[0, 0, 0], [0, 0, 1]])], { cameraPosition: [0, 0, 5], width: 1 });
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
  ], { cameraPosition: cam, width: 1 });
  assert.equal(stats.vertexCount, 10);
  assert.equal(stats.indexCount, 18);
  const idx = indices(r, 18);
  const first = idx.slice(0, 6);
  const rest = idx.slice(6);
  assert.ok(first.every((i) => i < 4));
  assert.ok(rest.every((i) => i >= 4 && i < 10));
  const op = Array.from((r.geometry.getAttribute('opacity').array as Float32Array).subarray(0, 10));
  assert.deepEqual(op, [0.25, 0.25, 0.25, 0.25, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75]);
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
  assert.equal(stats.vertexCount, 18);
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
  assert.equal(stats.vertexCount, 8);
  assert.equal(stats.skippedSegments, 1);
  assert.equal(stats.indexCount, 12);
  assert.ok(positions(r, 8).every(Number.isFinite));
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
  r.update([path([[0, 0, 0], [1, 0, 0]])], { cameraPosition: cam, width: 2 });
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
  const stats = r.update([path(pts)], { cameraPosition: cam, width: 2 });
  assert.equal(stats.skippedSegments, 4999);
  assert.equal(stats.indexCount, 12);
  // Mid-run vertex uses tangent +X (from distinct neighbours), so offset is purely Y.
  const mid = vertex(r, 2 * 2500);
  assert.ok(Math.abs(mid[0] - 1) < 1e-6 && Math.abs(Math.abs(mid[1]) - 1) < 1e-6);
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
