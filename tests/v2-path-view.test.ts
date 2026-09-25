import test from 'node:test';
import assert from 'node:assert/strict';
import type { Vec3 } from '../src/model/types.ts';
import { framePoints } from '../src/render/RibbonGeometry.ts';
import { PATH_VIEW_YAW_DEG, pathViewDirection } from '../src/render/pathView.ts';

// Expanded preview: ~75vh of a 720px-high window over an 845px-wide stage.
const FOV = 45, FILL = 0.85, EXPANDED_ASPECT = 845 / 540, DEFAULT_ASPECT = 845 / 288;
const OLD_ORBIT: Vec3 = [2.2, 1.1, 3.2]; // F01 orbit direction path mode used to preserve.

/** Generic jagged arc from `a` to `b` with a small perpendicular wobble and a vertical bulge. */
function arc(a: Vec3, b: Vec3, n = 24): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n, w = (i % 2 ? 1 : -1) * 0.08;
    pts.push([a[0] + (b[0] - a[0]) * t + w * 0.3, a[1] + (b[1] - a[1]) * t + Math.sin(t * Math.PI) * 0.3, a[2] + (b[2] - a[2]) * t + w]);
  }
  return pts;
}

function project(p: Vec3, cam: Vec3, target: Vec3, aspect: number): [number, number] {
  const z = [cam[0] - target[0], cam[1] - target[1], cam[2] - target[2]];
  const zl = Math.hypot(z[0], z[1], z[2]);
  const zn = z.map((c) => c / zl);
  let x = [zn[2], 0, -zn[0]];
  const xl = Math.hypot(x[0], x[1], x[2]);
  x = x.map((c) => c / xl);
  const y = [zn[1] * x[2] - zn[2] * x[1], zn[2] * x[0] - zn[0] * x[2], zn[0] * x[1] - zn[1] * x[0]];
  const d = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
  const depth = -(d[0] * zn[0] + d[1] * zn[1] + d[2] * zn[2]);
  const t = Math.tan((FOV * Math.PI) / 360);
  return [(d[0] * x[0] + d[1] * x[1] + d[2] * x[2]) / depth / (t * aspect),(d[0] * y[0] + d[1] * y[1] + d[2] * y[2]) / depth / t];
}

/** Largest NDC extent (0..2) of the projected path points on either screen axis; asserts nothing clips. */
function screenExtent(pts: Vec3[], viewDirection: Vec3, aspect = EXPANDED_ASPECT): number {
  const f = framePoints([{ points: pts, pad: 0.025 }], { viewDirection, fovDeg: FOV, aspect, fill: FILL })!;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    const [nx, ny] = project(p, f.position, f.target, aspect);
    assert.ok(Math.abs(nx) <= 1 && Math.abs(ny) <= 1, `clipped: ${nx}, ${ny}`);
    x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
  }
  return Math.max(x1 - x0, y1 - y0);
}

/** |cos| between the horizontal view and the arc's horizontal chord: 0 = exact broadside. */
function alongChord(d: Vec3, a: Vec3, b: Vec3): number {
  const cx = b[0] - a[0], cz = b[2] - a[2];
  return Math.abs(d[0] * cx + d[2] * cz) / Math.hypot(cx, cz) / Math.hypot(d[0], d[2]);
}

/**
 * Largest orthographic span of the points across the view plane (world units): measures how much of
 * the path's length the view direction shows rather than foreshortens (independent of framing).
 */
function viewSpan(pts: Vec3[], viewDirection: Vec3): number {
  const [zx, zy, zz] = viewDirection, zl = Math.hypot(zx, zy, zz);
  let x = [zz, 0, -zx];
  const xl = Math.hypot(x[0], x[2]);
  x = x.map((c) => c / xl);
  const z = [zx / zl, zy / zl, zz / zl];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const span = (v: number[]) => {
    const s = pts.map((p) => p[0] * v[0] + p[1] * v[1] + p[2] * v[2]);
    return Math.max(...s) - Math.min(...s);
  };
  return Math.max(span(x), span(y));
}

// Broadside tolerance: the configured yaw plus ~1° for the wobble's effect on the principal axis.
const BROADSIDE_TOL = Math.sin(((PATH_VIEW_YAW_DEG + 1) * Math.PI) / 180);
// framePoints fits the actual points at 0.85 fill (1.7 NDC); required: >= 70% of the expanded view.
const MIN_EXTENT = 1.4;

test('X-dominant arc is viewed broadside (mainly along Z) and fills most of the expanded preview', () => {
  const a: Vec3 = [-3, 1, 0.2], b: Vec3 = [1, 1.4, -0.2];
  const pts = arc(a, b);
  const d = pathViewDirection([pts]);
  assert.ok(Math.abs(d[2]) > 0.9 && d[1] > 0.1 && d[1] < 0.4, `dir ${d}`);
  assert.ok(alongChord(d, a, b) <= BROADSIDE_TOL, `along chord ${alongChord(d, a, b)} dir ${d}`);
  const now = screenExtent(pts, d);
  assert.ok(now >= MIN_EXTENT, `projected extent ${now} of 2`);
  assert.ok(screenExtent(pts, d, DEFAULT_ASPECT) >= MIN_EXTENT, 'default-height preview also fills 70%');
  const nowSpan = viewSpan(pts, d), oldSpan = viewSpan(pts, OLD_ORBIT);
  assert.ok(nowSpan > oldSpan * 1.1, `broadside span ${nowSpan} vs old orbit ${oldSpan}`);
});

test('tall branchy paths: fits actual points (no clipping) and still fills >= 70% on one axis', () => {
  const main = arc([-2, 1, 0], [2, 1.2, 0]);
  const branch: Vec3[] = [[0, 1.1, 0], [0.3, 2.4, 0.1], [0.1, 3.2, -0.1]];
  const low: Vec3[] = [[1, 1.15, 0], [1.2, 0.1, 0.2]];
  const d = pathViewDirection([main, branch, low]);
  for (const aspect of [EXPANDED_ASPECT, DEFAULT_ASPECT]) {
    const f = framePoints([{ points: main, pad: 0.025 }, { points: branch, pad: 0.025 }, { points: low, pad: 0.025 }], { viewDirection: d, fovDeg: FOV, aspect, fill: FILL })!;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of [...main, ...branch, ...low]) {
      const [nx, ny] = project(p, f.position, f.target, aspect);
      assert.ok(Math.abs(nx) <= 1 && Math.abs(ny) <= 1, `clipped: ${nx}, ${ny}`);
      x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
    }
    assert.ok(Math.max(x1 - x0, y1 - y0) >= MIN_EXTENT, `extent ${x1 - x0} x ${y1 - y0} at aspect ${aspect}`);
  }
});

test('framePoints: null when empty; finite frame for a single point', () => {
  const o = { viewDirection: [0, 1, 0] as Vec3, fovDeg: FOV, aspect: 1, fill: FILL };
  assert.equal(framePoints([], o), null);
  const f = framePoints([{ points: [[1, 1, 1]], pad: 0 }], o)!;
  assert.ok(f.distance > 0 && f.position.every(Number.isFinite) && f.target.every(Number.isFinite));
});

test('Z-dominant arc is viewed broadside (mainly along X)', () => {
  const a: Vec3 = [0.1, 1, -3], b: Vec3 = [-0.1, 1.3, 1];
  const pts = arc(a, b);
  const d = pathViewDirection([pts]);
  assert.ok(Math.abs(d[0]) > 0.9, `dir ${d}`);
  assert.ok(alongChord(d, a, b) <= BROADSIDE_TOL, `along chord ${alongChord(d, a, b)} dir ${d}`);
  const now = screenExtent(pts, d);
  assert.ok(now >= MIN_EXTENT, `projected extent ${now} of 2`);
  const nowSpan = viewSpan(pts, d), oldSpan = viewSpan(pts, OLD_ORBIT);
  assert.ok(nowSpan > oldSpan * 1.15, `broadside span ${nowSpan} vs old orbit ${oldSpan}`);
});

test('diagonal arc: horizontal view is perpendicular to the dominant axis (within the yaw)', () => {
  const pts = arc([-2, 0.5, -2], [2, 0.8, 2]);
  const d = pathViewDirection([pts]);
  const h = Math.hypot(d[0], d[2]);
  const along = Math.abs(d[0] + d[2]) / Math.SQRT2 / h;
  assert.ok(along <= Math.sin((PATH_VIEW_YAW_DEG * Math.PI) / 180) + 1e-9, `cos to axis ${along}`);
});

test('degenerate input falls back to a finite unit direction; deterministic', () => {
  for (const sets of [[], [[[1, 1, 1]] as Vec3[]], [[[0, 0, 0], [0, 2, 0]] as Vec3[]]]) {
    const d = pathViewDirection(sets);
    assert.ok(d.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-9);
  }
  const pts = arc([-3, 1, 0], [1, 1, 0]);
  assert.deepEqual(pathViewDirection([pts]), pathViewDirection([pts]));
});
