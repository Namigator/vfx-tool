// Reusable camera-facing ribbon geometry (plan08 rendering). Geometry only: material,
// color, alpha blending and textures are caller responsibility. Inputs are never mutated.
import * as THREE from 'three';
import type { Vec3 } from '../model/types.ts';
import type { PathData } from '../runtime/paths.ts';

export interface RibbonUpdateOptions {
  /** World-space camera position used for billboarding. */
  cameraPosition: Vec3;
  /** Base full ribbon width in world units; multiplied by each path's widthScale. */
  width: number;
}

export interface RibbonUpdateStats {
  vertexCount: number;
  indexCount: number;
  /** Paths that emitted vertices (paths with <2 points or zero length are skipped). */
  drawnPaths: number;
  /** Zero-length segments inside drawn paths that emitted no triangles. */
  skippedSegments: number;
}

export interface RibbonGeometryOptions {
  /** Hard budget on total path points per update (vertices = 2 * points). */
  maxPoints?: number;
  /** Initial allocated point capacity; grows (up to maxPoints) when exceeded. */
  initialPoints?: number;
}

export const DEFAULT_RIBBON_MAX_POINTS = 65536;
const DEFAULT_INITIAL_POINTS = 256;
const EPSILON = 1e-9;

type V = [number, number, number];

function assertVec3(value: unknown, name: string): asserts value is Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((c) => typeof c === 'number' && Number.isFinite(c))) {
    throw new TypeError(`${name} must be a finite Vec3.`);
  }
}
function assertFiniteNonNegative(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite nonnegative number.`);
  }
}
function assertCount(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}
function normalize(x: number, y: number, z: number): V | null {
  const l = Math.hypot(x, y, z);
  return l > EPSILON && Number.isFinite(l) ? [x / l, y / l, z / l] : null;
}
function cross(a: V, b: V): V {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function markLive(attribute: THREE.BufferAttribute, count: number): void {
  attribute.clearUpdateRanges();
  if (count === 0) return;
  attribute.addUpdateRange(0, count);
  attribute.needsUpdate = true;
}
function same(a: Vec3, b: Vec3): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= EPSILON;
}

/**
 * Owns one BufferGeometry with attributes `position` (vec3), `opacity` (float, the
 * path's opacityScale per vertex) and `side` (float, +1 left / -1 right; interpolates
 * to 0 on the centreline for transverse falloff), plus a Uint32 index. Each path point yields
 * two vertices (left then right); each non-degenerate segment yields two triangles.
 * Paths are disjoint: no triangles connect consecutive paths. Storage is reused while
 * the point count fits capacity; update() throws RangeError above `maxPoints`.
 */
export class RibbonGeometry {
  readonly geometry: THREE.BufferGeometry;
  readonly maxPoints: number;
  private capacity = 0;
  private positions = new Float32Array(0);
  private opacities = new Float32Array(0);
  private sides = new Float32Array(0);
  private indices = new Uint32Array(0);
  private disposed = false;
  private readonly bounds = new THREE.Box3();
  private readonly sphere = new THREE.Sphere();
  private readonly scratch = new THREE.Vector3();

  constructor(options: RibbonGeometryOptions = {}) {
    const maxPoints = options.maxPoints ?? DEFAULT_RIBBON_MAX_POINTS;
    assertCount(maxPoints, 'maxPoints');
    const initial = options.initialPoints ?? Math.min(DEFAULT_INITIAL_POINTS, maxPoints);
    assertCount(initial, 'initialPoints');
    if (initial > maxPoints) throw new RangeError('initialPoints must not exceed maxPoints.');
    this.maxPoints = maxPoints;
    this.geometry = new THREE.BufferGeometry();
    this.allocate(initial);
  }

  /** Current allocated point capacity (vertices = 2 * capacity). */
  get pointCapacity(): number {
    return this.capacity;
  }

  update(paths: readonly PathData[], options: RibbonUpdateOptions): RibbonUpdateStats {
    if (this.disposed) throw new Error('RibbonGeometry has been disposed.');
    if (!Array.isArray(paths)) throw new TypeError('paths must be an array of PathData.');
    if (typeof options !== 'object' || options === null) throw new TypeError('options must be an object.');
    assertVec3(options.cameraPosition, 'cameraPosition');
    assertFiniteNonNegative(options.width, 'width');

    let totalPoints = 0;
    paths.forEach((path, p) => {
      if (typeof path !== 'object' || path === null || !Array.isArray(path.points)) {
        throw new TypeError(`paths[${p}] must be PathData.`);
      }
      // Indexed loop (not forEach) so holes in sparse arrays are validated too.
      const pts: readonly unknown[] = path.points;
      for (let i = 0; i < pts.length; i += 1) assertVec3(pts[i], `paths[${p}].points[${i}]`);
      assertFiniteNonNegative(path.widthScale, `paths[${p}].widthScale`);
      assertFiniteNonNegative(path.opacityScale, `paths[${p}].opacityScale`);
      totalPoints += path.points.length;
    });
    if (totalPoints > this.maxPoints) {
      throw new RangeError(`Ribbon budget exceeded: ${totalPoints} points > maxPoints ${this.maxPoints}.`);
    }
    if (totalPoints > this.capacity) {
      this.allocate(Math.min(this.maxPoints, Math.max(totalPoints, this.capacity * 2)));
    }

    const cam = options.cameraPosition;
    const pos = this.positions;
    const op = this.opacities;
    const sd = this.sides;
    const idx = this.indices;
    let v = 0;
    let n = 0;
    let drawnPaths = 0;
    let skippedSegments = 0;

    for (const path of paths) {
      const pts = path.points;
      const count = pts.length;
      if (count < 2) continue;
      let hasLength = false;
      for (let i = 1; i < count && !hasLength; i += 1) hasLength = !same(pts[i - 1], pts[i]);
      if (!hasLength) continue;

      drawnPaths += 1;
      const half = (options.width * path.widthScale) / 2;
      const base = v;
      let prevTangent: V | null = null;
      let prevSide: V | null = null;
      let runStart = 0;
      let runEnd = -1;
      for (let i = 0; i < count; i += 1) {
        const p = pts[i];
        // Tangent from nearest distinct neighbours so duplicate points stay oriented.
        // Each run of consecutive duplicates is scanned once, keeping this linear.
        if (i > runEnd) {
          runStart = i;
          runEnd = i;
          while (runEnd < count - 1 && same(pts[runEnd + 1], pts[runStart])) runEnd += 1;
        }
        const a = runStart > 0 ? runStart - 1 : 0;
        const b = runEnd < count - 1 ? runEnd + 1 : count - 1;
        const tangent: V = normalize(pts[b][0] - pts[a][0], pts[b][1] - pts[a][1], pts[b][2] - pts[a][2])
          ?? prevTangent ?? [1, 0, 0];
        prevTangent = tangent;

        let side: V | null = null;
        const view = normalize(cam[0] - p[0], cam[1] - p[1], cam[2] - p[2]);
        if (view) {
          const c = cross(tangent, view);
          side = normalize(c[0], c[1], c[2]);
          if (side && Math.hypot(c[0], c[1], c[2]) < 1e-6) side = null;
        }
        if (!side) {
          // View parallel to tangent (or camera on the point): keep previous side if still
          // perpendicular, else use the WP03 stable-frame reference (+Y unless |t.y|>0.99).
          if (prevSide) {
            const d = prevSide[0] * tangent[0] + prevSide[1] * tangent[1] + prevSide[2] * tangent[2];
            side = normalize(prevSide[0] - tangent[0] * d, prevSide[1] - tangent[1] * d, prevSide[2] - tangent[2] * d);
          }
          if (!side) {
            const ref: V = Math.abs(tangent[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
            const c = cross(tangent, ref);
            side = normalize(c[0], c[1], c[2]) ?? [0, 0, 1];
          }
        }
        // Keep the left/right sense continuous: a sign flip between neighbours would cross the
        // strip over itself (a bow-tie shard). Only the sign changes; the side stays perpendicular.
        if (prevSide && side[0] * prevSide[0] + side[1] * prevSide[1] + side[2] * prevSide[2] < 0) {
          side = [-side[0], -side[1], -side[2]];
        }
        prevSide = side;

        const o = v * 3;
        pos[o] = p[0] + side[0] * half;
        pos[o + 1] = p[1] + side[1] * half;
        pos[o + 2] = p[2] + side[2] * half;
        pos[o + 3] = p[0] - side[0] * half;
        pos[o + 4] = p[1] - side[1] * half;
        pos[o + 5] = p[2] - side[2] * half;
        op[v] = path.opacityScale;
        op[v + 1] = path.opacityScale;
        sd[v] = 1;
        sd[v + 1] = -1;
        v += 2;
      }
      for (let i = 0; i < count - 1; i += 1) {
        if (same(pts[i], pts[i + 1])) { skippedSegments += 1; continue; }
        const l0 = base + i * 2;
        const r0 = l0 + 1;
        const l1 = l0 + 2;
        const r1 = l0 + 3;
        idx[n] = l0; idx[n + 1] = r0; idx[n + 2] = l1;
        idx[n + 3] = r0; idx[n + 4] = r1; idx[n + 5] = l1;
        n += 6;
      }
    }

    // Upload only the live prefix; stale capacity past it is never drawn.
    markLive(this.geometry.getAttribute('position') as THREE.BufferAttribute, v * 3);
    markLive(this.geometry.getAttribute('opacity') as THREE.BufferAttribute, v);
    markLive(this.geometry.getAttribute('side') as THREE.BufferAttribute, v);
    markLive(this.geometry.getIndex() as THREE.BufferAttribute, n);
    this.geometry.setDrawRange(0, n);
    // Bounds cover only the live vertex prefix, not stale capacity. Objects are reused.
    const box = this.bounds.makeEmpty();
    const tmp = this.scratch;
    for (let i = 0; i < v; i += 1) box.expandByPoint(tmp.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
    this.geometry.boundingBox = box;
    this.geometry.boundingSphere = v > 0 ? box.getBoundingSphere(this.sphere) : this.sphere.makeEmpty();
    return { vertexCount: v, indexCount: n, drawnPaths, skippedSegments };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.geometry.dispose();
  }

  private allocate(points: number): void {
    // Three cannot resize uploaded buffers; release GPU copies before swapping storage.
    if (this.capacity > 0) this.geometry.dispose();
    this.capacity = points;
    this.positions = new Float32Array(points * 2 * 3);
    this.opacities = new Float32Array(points * 2);
    this.sides = new Float32Array(points * 2);
    this.indices = new Uint32Array(Math.max(0, points - 1) * 6);
    const position = new THREE.BufferAttribute(this.positions, 3);
    const opacity = new THREE.BufferAttribute(this.opacities, 1);
    const side = new THREE.BufferAttribute(this.sides, 1);
    const index = new THREE.BufferAttribute(this.indices, 1);
    position.setUsage(THREE.DynamicDrawUsage);
    opacity.setUsage(THREE.DynamicDrawUsage);
    side.setUsage(THREE.DynamicDrawUsage);
    index.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', position);
    this.geometry.setAttribute('opacity', opacity);
    this.geometry.setAttribute('side', side);
    this.geometry.setIndex(index);
  }
}

/**
 * Shader edge-softness per blend mode: additive glow fades across the whole half-width (no hard
 * polygon edges), normal keeps a mostly solid core with an antialiased rim, cutout stays hard so
 * alphaCutoff keeps its authored meaning.
 */
export function ribbonSoftness(blend: 'normal' | 'additive' | 'cutout'): number {
  return blend === 'additive' ? 1 : blend === 'normal' ? 0.25 : 0;
}

export interface PathBounds { min: Vec3; max: Vec3 }

/**
 * Axis-aligned bounds of all points of `paths`, padded by each path's half ribbon width
 * (`width * widthScale / 2`). Merges into `into` when given. Returns null when no point exists.
 */
export function pathBounds(paths: readonly PathData[], width: number, into: PathBounds | null = null): PathBounds | null {
  let out = into;
  for (const path of paths) {
    const pad = (width * path.widthScale) / 2;
    for (const p of path.points) {
      if (!out) out = { min: [p[0] - pad, p[1] - pad, p[2] - pad], max: [p[0] + pad, p[1] + pad, p[2] + pad] };
      for (let k = 0; k < 3; k += 1) {
        out.min[k] = Math.min(out.min[k], p[k] - pad);
        out.max[k] = Math.max(out.max[k], p[k] + pad);
      }
    }
  }
  return out;
}

export interface FrameOptions {
  /** Unit-or-not direction from target toward the camera (current orbit direction is preserved). */
  viewDirection: Vec3;
  /** Vertical field of view in degrees. */
  fovDeg: number;
  /** Viewport width / height. */
  aspect: number;
  /** Fraction of each half-extent of the view to fill (0..1]. */
  fill: number;
  /** Minimum half-size per axis so points/lines still get a finite frame. */
  minHalfExtent?: number;
}

/**
 * Perspective camera placement that fits every corner of `bounds` inside `fill` of the view
 * (checked per axis against the horizontal and vertical half-FOV), looking along -viewDirection.
 */
export function frameBounds(bounds: PathBounds, o: FrameOptions): { target: Vec3; position: Vec3; distance: number } {
  const minHalf = o.minHalfExtent ?? 0.05;
  const target: Vec3 = [0, 0, 0];
  const half: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k += 1) {
    target[k] = (bounds.min[k] + bounds.max[k]) / 2;
    half[k] = Math.max(minHalf, (bounds.max[k] - bounds.min[k]) / 2);
  }
  const z = normalize(o.viewDirection[0], o.viewDirection[1], o.viewDirection[2]) ?? [0, 0, 1];
  const worldUp: V = Math.abs(z[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0];
  const x = normalize(...cross(worldUp, z)) ?? [1, 0, 0];
  const y = cross(z, x);
  const tanV = Math.tan((o.fovDeg * Math.PI) / 360) * o.fill;
  const tanH = tanV * o.aspect;
  let distance = 0;
  for (let c = 0; c < 8; c += 1) {
    const d: V = [c & 1 ? half[0] : -half[0], c & 2 ? half[1] : -half[1], c & 4 ? half[2] : -half[2]];
    const cx = Math.abs(d[0] * x[0] + d[1] * x[1] + d[2] * x[2]);
    const cy = Math.abs(d[0] * y[0] + d[1] * y[1] + d[2] * y[2]);
    const cz = d[0] * z[0] + d[1] * z[1] + d[2] * z[2];
    distance = Math.max(distance, cz + cx / tanH, cz + cy / tanV);
  }
  return { target, position: [target[0] + z[0] * distance, target[1] + z[1] * distance, target[2] + z[2] * distance], distance };
}

/** A set of path points with the path's ribbon half-width (`width * widthScale / 2`). */
export interface FramePointSet { points: readonly Vec3[]; pad: number }

/**
 * Tight perspective fit of the actual points (each grown by its pad) rather than their AABB corners:
 * the camera is shifted within the view plane so the projected extent is centred, then placed at the
 * smallest depth where every padded point lies within `fill` of both half-FOVs. Exact per axis: a point
 * p constrains `|p·x - t| + pad <= tan * (u - p·z)` for camera plane offset t and camera depth u.
 * The target is the point on the view axis at the depth of the points' mean. Null when no point exists.
 */
export function framePoints(sets: readonly FramePointSet[], o: FrameOptions): { target: Vec3; position: Vec3; distance: number } | null {
  const minHalf = o.minHalfExtent ?? 0.05;
  const z = normalize(o.viewDirection[0], o.viewDirection[1], o.viewDirection[2]) ?? [0, 0, 1];
  const worldUp: V = Math.abs(z[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0];
  const x = normalize(...cross(worldUp, z)) ?? [1, 0, 0];
  const y = cross(z, x);
  const tanV = Math.tan((o.fovDeg * Math.PI) / 360) * o.fill;
  const tanH = tanV * o.aspect;
  let n = 0, meanZ = 0;
  let px = -Infinity, qx = Infinity, py = -Infinity, qy = Infinity;
  for (const s of sets) for (const p of s.points) {
    const a = p[0] * x[0] + p[1] * x[1] + p[2] * x[2];
    const b = p[0] * y[0] + p[1] * y[1] + p[2] * y[2];
    const c = p[0] * z[0] + p[1] * z[1] + p[2] * z[2];
    n += 1; meanZ += c;
    px = Math.max(px, a + s.pad + tanH * c); qx = Math.min(qx, a - s.pad - tanH * c);
    py = Math.max(py, b + s.pad + tanV * c); qy = Math.min(qy, b - s.pad - tanV * c);
  }
  if (n === 0) return null;
  meanZ /= n;
  const tx = (px + qx) / 2, ty = (py + qy) / 2;
  // Camera depth along z; minHalf keeps a finite frame for single points / degenerate spans.
  let u = Math.max((px - qx) / (2 * tanH), (py - qy) / (2 * tanV));
  u = Math.max(u, meanZ + minHalf / Math.min(tanH, tanV));
  const distance = u - meanZ;
  const position: Vec3 = [tx * x[0] + ty * y[0] + u * z[0], tx * x[1] + ty * y[1] + u * z[1], tx * x[2] + ty * y[2] + u * z[2]];
  const target: Vec3 = [position[0] - z[0] * distance, position[1] - z[1] * distance, position[2] - z[2] * distance];
  return { target, position, distance };
}
