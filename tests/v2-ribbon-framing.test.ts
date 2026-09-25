import test from 'node:test';
import assert from 'node:assert/strict';
import type { Vec3 } from '../src/model/types.ts';
import type { PathData } from '../src/runtime/paths.ts';
import { frameBounds, pathBounds, RibbonGeometry, ribbonSoftness } from '../src/render/RibbonGeometry.ts';

const path = (points: Vec3[], widthScale = 1): PathData => ({ id: 'p', points, widthScale, opacityScale: 1 });

test('side attribute: +1 left, -1 right per quad corner', () => {
  const r = new RibbonGeometry();
  const s = r.update([path([[0, 0, 0], [1, 0, 0], [2, 0, 0]])], { cameraPosition: [0, 0, 10], width: 1 });
  const side = Array.from((r.geometry.getAttribute('side').array as Float32Array).subarray(0, s.vertexCount));
  // Two segment quads (start L/R, end L/R each); a straight join adds no fan vertices.
  assert.deepEqual(side, [1, -1, 1, -1, 1, -1, 1, -1]);
});

test('side sense stays continuous through a hairpin (no crossed strip)', () => {
  const r = new RibbonGeometry();
  // Camera sits on the path axis near the turn so raw cross(tangent, view) flips sign.
  const pts: Vec3[] = [[-2, 0, 0], [-1, 0, 0], [0, 0, 0], [0, 0, -1], [0, 0, -2]];
  const s = r.update([path(pts)], { cameraPosition: [0.5, 3, 0.5], width: 0.2 });
  const a = r.geometry.getAttribute('position').array as Float32Array;
  const sd = r.geometry.getAttribute('side').array as Float32Array;
  const idx = r.geometry.getIndex()!.array as Uint32Array;
  // Each segment quad's first triangle is (startL, startR, endL); join fans contain a side-0 centre.
  const sides: number[][] = [];
  for (let k = 0; k < s.indexCount; k += 3) {
    const [l, rr] = [idx[k], idx[k + 1]];
    if (sd[l] !== 1 || sd[rr] !== -1 || sd[idx[k + 2]] !== 1) continue;
    sides.push([a[l * 3] - a[rr * 3], a[l * 3 + 1] - a[rr * 3 + 1], a[l * 3 + 2] - a[rr * 3 + 2]]);
  }
  assert.equal(sides.length, 4);
  for (let i = 1; i < sides.length; i += 1) {
    const [p, c] = [sides[i - 1], sides[i]];
    assert.ok(p[0] * c[0] + p[1] * c[1] + p[2] * c[2] >= 0, `side flipped at segment ${i}`);
  }
});

test('softness: additive fully soft, normal rimmed, cutout hard', () => {
  assert.equal(ribbonSoftness('additive'), 1);
  assert.ok(ribbonSoftness('normal') > 0 && ribbonSoftness('normal') < 1);
  assert.equal(ribbonSoftness('cutout'), 0);
});

test('pathBounds pads by half width and merges; null when empty', () => {
  assert.equal(pathBounds([], 1), null);
  const b = pathBounds([path([[0, 0, 0], [2, 1, 0]], 2)], 0.5);
  assert.deepEqual(b, { min: [-0.5, -0.5, -0.5], max: [2.5, 1.5, 0.5] });
  const m = pathBounds([path([[5, 0, 0]])], 0, b);
  assert.deepEqual(m?.max, [5, 1.5, 0.5]);
});

function project(p: Vec3, cam: Vec3, target: Vec3, fovDeg: number, aspect: number): [number, number] {
  const z = [cam[0] - target[0], cam[1] - target[1], cam[2] - target[2]];
  const zl = Math.hypot(z[0], z[1], z[2]);
  const zn = z.map((c) => c / zl);
  let x = [zn[2], 0, -zn[0]]; // cross([0,1,0], z)
  const xl = Math.hypot(x[0], x[1], x[2]);
  x = x.map((c) => c / xl);
  const y = [zn[1] * x[2] - zn[2] * x[1], zn[2] * x[0] - zn[0] * x[2], zn[0] * x[1] - zn[1] * x[0]];
  const d = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
  const depth = -(d[0] * zn[0] + d[1] * zn[1] + d[2] * zn[2]);
  const t = Math.tan((fovDeg * Math.PI) / 360);
  return [(d[0] * x[0] + d[1] * x[1] + d[2] * x[2]) / depth / (t * aspect), (d[0] * y[0] + d[1] * y[1] + d[2] * y[2]) / depth / t];
}

test('frameBounds fits a wide flat path into a short wide viewport without clipping, filling one axis', () => {
  const bounds = { min: [-3, 1, -0.1] as Vec3, max: [1, 1.6, 0.1] as Vec3 };
  const aspect = 845 / 260, fov = 45, fill = 0.85;
  const viewDirection: Vec3 = [2.2, 1.1, 3.2];
  const f = frameBounds(bounds, { viewDirection, fovDeg: fov, aspect, fill });
  assert.deepEqual(f.target, [-1, 1.3, 0]);
  let maxX = 0, maxY = 0;
  for (let c = 0; c < 8; c += 1) {
    const p: Vec3 = [c & 1 ? 1 : -3, c & 2 ? 1.6 : 1, c & 4 ? 0.1 : -0.1];
    const [nx, ny] = project(p, f.position, f.target, fov, aspect);
    assert.ok(Math.abs(nx) <= fill + 1e-9 && Math.abs(ny) <= fill + 1e-9, `corner ${c} clipped: ${nx}, ${ny}`);
    maxX = Math.max(maxX, Math.abs(nx)); maxY = Math.max(maxY, Math.abs(ny));
  }
  assert.ok(Math.abs(Math.max(maxX, maxY) - fill) < 1e-6, 'tight on the limiting axis');
  // Orbit direction preserved.
  const d = [f.position[0] - f.target[0], f.position[1] - f.target[1], f.position[2] - f.target[2]];
  const dl = Math.hypot(d[0], d[1], d[2]), vl = Math.hypot(...viewDirection);
  for (let k = 0; k < 3; k += 1) assert.ok(Math.abs(d[k] / dl - viewDirection[k] / vl) < 1e-9);
});

test('frameBounds handles a single point and a top-down view', () => {
  const f = frameBounds({ min: [1, 1, 1], max: [1, 1, 1] }, { viewDirection: [0, 1, 0], fovDeg: 45, aspect: 1, fill: 0.8 });
  assert.ok(f.distance > 0 && Number.isFinite(f.distance));
  assert.ok(f.position.every(Number.isFinite));
});
