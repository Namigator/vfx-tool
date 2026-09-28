// Reusable camera-facing ribbon geometry (plan08 rendering). Geometry only: material,
// color, alpha blending and textures are caller responsibility. Inputs are never mutated.
import * as THREE from 'three';
import type { Vec3 } from '../model/types.ts';
import type { PathData } from '../runtime/paths.ts';
import { fnv1a32Utf8 } from '../runtime/random.ts';

export interface RibbonUpdateOptions {
  /** World-space camera position used for billboarding. */
  cameraPosition: Vec3;
  /** Base full ribbon width in world units; multiplied by each path's widthScale. */
  width: number;
  /**
   * Fraction (0..0.5) of each path's arc length over which both ends taper and fade out.
   * Defaults to DEFAULT_RIBBON_END_FADE; 0 keeps full width and opacity to the ends.
   */
  endFade?: number;
  /** When false only the start (tail) of each path fades; the last point (a trail's head) stays full. Default true. */
  fadeHead?: boolean;
  /** Width multiplier (0..1) reached at the very ends of a tapered path. Defaults to DEFAULT_RIBBON_END_WIDTH. */
  endWidth?: number;
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
  /** Hard budget on total path points per update (vertices <= 12 * points). */
  maxPoints?: number;
  /** Initial allocated point capacity; grows (up to maxPoints) when exceeded. */
  initialPoints?: number;
}

export const DEFAULT_RIBBON_MAX_POINTS = 65536;
const DEFAULT_INITIAL_POINTS = 256;
export const DEFAULT_RIBBON_END_FADE = 0.12;
export const DEFAULT_RIBBON_END_WIDTH = 0.2;
/** No vertex is ever offset further than this multiple of the local half-width (bevel joins, no miters). */
export const RIBBON_MITER_LIMIT = 1;
/** Round joins: one fan triangle per JOIN_STEP radians of turn, at most JOIN_MAX_STEPS (a full reversal). */
const JOIN_STEP = Math.PI / 8;
const JOIN_MAX_STEPS = 8;
/** Worst-case per path point: 4 quad vertices + join centre + (steps-1) arc vertices; 6 + 3*steps indices. */
const VERTS_PER_POINT = 4 + JOIN_MAX_STEPS;
const INDICES_PER_POINT = 6 + 3 * JOIN_MAX_STEPS;
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
function dot(a: V, b: V): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function dir(from: Vec3, to: Vec3): V | null {
  return normalize(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
}
function same(a: Vec3, b: Vec3): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= EPSILON;
}

/**
 * Owns one BufferGeometry with attributes `position` (vec3), `opacity` (float, the
 * path's opacityScale per vertex) and `side` (float, +1 left / -1 right; interpolates
 * to 0 on the centreline for transverse falloff), plus a Uint32 index. Each non-degenerate
 * segment yields its own quad (4 vertices: start L/R, end L/R; two triangles); each turn between
 * consecutive segments adds a round outer-corner fan (a centre vertex with side 0, arc vertices at
 * the half-width; one triangle per π/8 of turn, at most 8).
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
  /** Per vertex: arc length from the path start, total path length, stable per-path key in [0,1). */
  private strips = new Float32Array(0);
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

  /** Current allocated point capacity (vertices <= 12 * capacity). */
  get pointCapacity(): number {
    return this.capacity;
  }

  update(paths: readonly PathData[], options: RibbonUpdateOptions): RibbonUpdateStats {
    if (this.disposed) throw new Error('RibbonGeometry has been disposed.');
    if (!Array.isArray(paths)) throw new TypeError('paths must be an array of PathData.');
    if (typeof options !== 'object' || options === null) throw new TypeError('options must be an object.');
    assertVec3(options.cameraPosition, 'cameraPosition');
    assertFiniteNonNegative(options.width, 'width');
    const endFade = options.endFade ?? DEFAULT_RIBBON_END_FADE;
    const endWidth = options.endWidth ?? DEFAULT_RIBBON_END_WIDTH;
    const fadeHead = options.fadeHead ?? true;
    assertFiniteNonNegative(endFade, 'endFade');
    assertFiniteNonNegative(endWidth, 'endWidth');
    if (endFade > 0.5) throw new RangeError('endFade must be at most 0.5.');
    if (endWidth > 1) throw new RangeError('endWidth must be at most 1.');

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
    const st = this.strips;
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
      let totalLength = 0;
      for (let i = 1; i < count; i += 1) {
        totalLength += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
      }
      const fadeLength = endFade * totalLength;
      // Longitudinal end taper/fade: smoothstep over fadeLength from each end, so branch tips
      // and bolt ends dissolve instead of ending in a hard full-width edge.
      const fadeAt = (arc: number): number => {
        if (fadeLength <= EPSILON) return 1;
        const e = Math.min(1, (fadeHead ? Math.min(arc, totalLength - arc) : arc) / fadeLength);
        return e * e * (3 - 2 * e);
      };
      const key = fnv1a32Utf8(String(path.id)) / 4294967296;
      // strip.z = -1 marks round-join fan vertices (textured ribbons skip them; untextured ones use them).
      const put = (p: Vec3, side: V, w: number, sign: number, opacity: number, arcAt: number, join = false): number => {
        st[v * 3] = arcAt; st[v * 3 + 1] = totalLength; st[v * 3 + 2] = join ? -1 : key;
        const o = v * 3;
        pos[o] = p[0] + side[0] * w * sign;
        pos[o + 1] = p[1] + side[1] * w * sign;
        pos[o + 2] = p[2] + side[2] * w * sign;
        op[v] = opacity;
        sd[v] = sign;
        v += 1;
        return v - 1;
      };
      let arc = 0;
      let prevSide: V | null = null;
      let prevT: V | null = null;
      let prevEnd = -1;
      for (let i = 0; i < count - 1; i += 1) {
        const a = pts[i];
        const b = pts[i + 1];
        if (same(a, b)) { skippedSegments += 1; continue; }
        const t = dir(a, b) ?? [1, 0, 0];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const view = normalize(cam[0] - (a[0] + b[0]) / 2, cam[1] - (a[1] + b[1]) / 2, cam[2] - (a[2] + b[2]) / 2);
        let side: V | null = null;
        if (view) {
          const c = cross(t, view);
          if (Math.hypot(c[0], c[1], c[2]) >= 1e-6) side = normalize(c[0], c[1], c[2]);
        }
        if (!side) {
          // View parallel to the segment (or camera on it): keep previous side if still
          // perpendicular, else use the WP03 stable-frame reference (+Y unless |t.y|>0.99).
          if (prevSide) {
            const d = dot(prevSide, t);
            side = normalize(prevSide[0] - t[0] * d, prevSide[1] - t[1] * d, prevSide[2] - t[2] * d);
          }
          if (!side) {
            const ref: V = Math.abs(t[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
            side = normalize(...cross(t, ref)) ?? [0, 0, 1];
          }
        }
        // Keep the left/right sense continuous so the transverse `side` falloff never flips.
        if (prevSide && dot(side, prevSide) < 0) side = [-side[0], -side[1], -side[2]];

        // Each segment is its own quad offset by its own perpendicular side, so no vertex ever lies
        // farther than the local half-width from the path: short zigzags and reversals cannot fold
        // the strip into off-path shards (a shared-vertex miter strip can).
        // Sparse paths: split the segment at the fade transitions (arc = fadeLength and
        // totalLength - fadeLength) so the interior reaches full width/opacity. Without this a
        // two-point path has opacity 0 at both vertices and the whole quad interpolates to invisible.
        // Sub-quads share this segment's side and emit no joins (they are collinear). The extra
        // vertices (<= 8 per path) fit the per-point budget since every drawn path has >= 2 points.
        const arc0 = arc;
        arc += len;
        const cuts: number[] = [];
        if (fadeLength > EPSILON) {
          for (const c of [fadeLength, totalLength - fadeLength]) {
            if (c > arc0 + EPSILON && c < arc - EPSILON && (cuts.length === 0 || Math.abs(c - cuts[0]) > EPSILON)) cuts.push(c);
          }
        }
        cuts.push(arc);
        const f0 = fadeAt(arc0);
        const w0 = half * (endWidth + (1 - endWidth) * f0);
        const o0 = path.opacityScale;
        const l0 = put(a, side, w0, 1, o0, arc0);
        let lPrev = l0;
        let rPrev = put(a, side, w0, -1, o0, arc0);
        let l1 = l0;
        for (let k = 0; k < cuts.length; k += 1) {
          const last = k === cuts.length - 1;
          const s = (cuts[k] - arc0) / len;
          // Exact endpoint for the final sub-quad; interpolated arc-length samples otherwise.
          const q: Vec3 = last ? b : [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
          const f1 = fadeAt(last ? arc : cuts[k]);
          const w1 = half * (endWidth + (1 - endWidth) * f1);
          const o1 = path.opacityScale;
          const arcQ = last ? arc : cuts[k];
          l1 = put(q, side, w1, 1, o1, arcQ);
          const r1 = put(q, side, w1, -1, o1, arcQ);
          idx[n] = lPrev; idx[n + 1] = rPrev; idx[n + 2] = l1;
          idx[n + 3] = rPrev; idx[n + 4] = r1; idx[n + 5] = l1;
          n += 6;
          lPrev = l1;
          rPrev = r1;
        }

        // Round join: fan the outer-corner gap from the join point. The outer sense is resolved per
        // segment (the continuity flip above can swap L/R on turns past 90°, so one shared index
        // offset would put the wedge on the inner corner and leave the outer corner as a dark notch).
        // Arc vertices lie at exactly the local half-width with side ±1, so the transverse falloff
        // stays radial around the corner instead of collapsing across a thin bevel chord.
        if (prevSide && prevT && prevEnd >= 0 && dot(t, prevT) < 1 - 1e-9) {
          const reversal = dot(t, prevT) < -1 + 1e-9; // exact reversal: either side may be outer
          const sp = dot(t, prevSide) > 0 ? -1 : 1; // previous quad's outer sign
          // This quad's outer sign; on a reversal pick the opposite edge so the cap spans a half-circle.
          const sc = reversal ? (dot(side, prevSide) > 0 ? -sp : sp) : dot(prevT, side) < 0 ? -1 : 1;
          const u0: V = [prevSide[0] * sp, prevSide[1] * sp, prevSide[2] * sp];
          const u1: V = [side[0] * sc, side[1] * sc, side[2] * sc];
          // Sweep from u0 through the previous forward direction to u1 (π for a full reversal).
          const phi = Math.atan2(Math.max(0, dot(u1, prevT)), dot(u1, u0));
          const steps = Math.min(JOIN_MAX_STEPS, Math.max(1, Math.ceil(phi / JOIN_STEP)));
          const centre = put(a, side, 0, 0, o0, arc0, true);
          let last = prevEnd + (sp < 0 ? 1 : 0);
          for (let j = 1; j <= steps; j += 1) {
            let next = l0 + (sc < 0 ? 1 : 0);
            if (j < steps) {
              const ang = (phi * j) / steps;
              const c = Math.cos(ang), s = Math.sin(ang);
              const u = normalize(u0[0] * c + prevT[0] * s, u0[1] * c + prevT[1] * s, u0[2] * c + prevT[2] * s) ?? u1;
              next = put(a, u, w0, 1, o0, arc0, true);
            }
            idx[n] = centre; idx[n + 1] = last; idx[n + 2] = next;
            n += 3;
            last = next;
          }
        }
        prevSide = side;
        prevT = t;
        prevEnd = l1;
      }
    }

    // Upload only the live prefix; stale capacity past it is never drawn.
    markLive(this.geometry.getAttribute('position') as THREE.BufferAttribute, v * 3);
    markLive(this.geometry.getAttribute('opacity') as THREE.BufferAttribute, v);
    markLive(this.geometry.getAttribute('side') as THREE.BufferAttribute, v);
    markLive(this.geometry.getAttribute('strip') as THREE.BufferAttribute, v * 3);
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
    this.positions = new Float32Array(points * VERTS_PER_POINT * 3);
    this.opacities = new Float32Array(points * VERTS_PER_POINT);
    this.sides = new Float32Array(points * VERTS_PER_POINT);
    this.strips = new Float32Array(points * VERTS_PER_POINT * 3);
    this.indices = new Uint32Array(points * INDICES_PER_POINT);
    const position = new THREE.BufferAttribute(this.positions, 3);
    const opacity = new THREE.BufferAttribute(this.opacities, 1);
    const side = new THREE.BufferAttribute(this.sides, 1);
    const strip = new THREE.BufferAttribute(this.strips, 3);
    strip.setUsage(THREE.DynamicDrawUsage);
    const index = new THREE.BufferAttribute(this.indices, 1);
    position.setUsage(THREE.DynamicDrawUsage);
    opacity.setUsage(THREE.DynamicDrawUsage);
    side.setUsage(THREE.DynamicDrawUsage);
    index.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', position);
    this.geometry.setAttribute('opacity', opacity);
    this.geometry.setAttribute('side', side);
    this.geometry.setAttribute('strip', strip);
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
