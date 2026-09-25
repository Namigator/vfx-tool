// Deterministic BranchPath core (plan24 BranchPath, plan07 exact attachment, WP03-BRANCH-CORE).
// Pure functions only: inputs are never mutated and outputs never alias inputs.
// Unlike paths.ts, parent path ids DO key randomness here (via eventRandomKey) because WP03
// requires an unchanged parent id/slot to keep its samples when unrelated parents are added.
// Per plan24 Amendment A1 PathData.id here is a pattern-local semantic path ID derived from
// generation index/ordinals, NEVER a document/node/editor object ID; callers must not pass one.
import type { Vec3 } from '../model/types.ts';
import { pointAtArcFraction, stableFrame, type PathData } from './paths.ts';
import { assertStoredId, assertUint32, sampleUnit } from './random.ts';

export type BranchCountMode = 'total' | 'perParent';

export interface BranchOptions {
  documentSeed: number;
  randomStreamId: string;
  count: number;
  countMode: BranchCountMode;
  attachmentMin: number;
  attachmentMax: number;
  lengthMin: number;
  lengthMax: number;
  spread: number;
  widthMin: number;
  widthMax: number;
  opacityMin: number;
  opacityMax: number;
  groundEndClamp: boolean;
  groundY: number;
}

export type BranchOptionsInput = Pick<BranchOptions, 'documentSeed' | 'randomStreamId'> & Partial<BranchOptions>;

export interface BranchResult { trunks: PathData[]; branches: PathData[] }

export const MAX_BRANCH_COUNT = 64;
export const BRANCH_DEFAULTS: Omit<BranchOptions, 'documentSeed' | 'randomStreamId'> = {
  count: 14, countMode: 'total', attachmentMin: 0.12, attachmentMax: 0.88, lengthMin: 0.4, lengthMax: 1.8,
  spread: 1, widthMin: 0.2, widthMax: 0.4, opacityMin: 0.2, opacityMax: 0.48, groundEndClamp: false, groundY: 0,
};

const clone = (v: Vec3): Vec3 => [v[0], v[1], v[2]];
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const byId = (a: PathData, b: PathData): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function assertFinite(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${name} must be a finite number.`);
}
function assertRange(min: unknown, max: unknown, name: string, lo: number, hi: number): void {
  assertFinite(min, `${name}Min`);
  assertFinite(max, `${name}Max`);
  if (min < lo || max > hi || min > max) {
    throw new RangeError(`${name} range must satisfy ${lo} <= ${name}Min <= ${name}Max <= ${hi}.`);
  }
}
function assertParent(path: unknown, i: number): asserts path is PathData {
  if (typeof path !== 'object' || path === null) throw new TypeError(`parents[${i}] must be an object.`);
  const p = path as PathData;
  if (typeof p.id !== 'string') throw new TypeError(`parents[${i}].id must be a string.`);
  if (!Array.isArray(p.points)) throw new TypeError(`parents[${i}].points must be an array of Vec3.`);
  p.points.forEach((v, j) => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((c) => typeof c === 'number' && Number.isFinite(c))) {
      throw new TypeError(`parents[${i}].points[${j}] must be a finite Vec3.`);
    }
  });
  for (const k of ['widthScale', 'opacityScale'] as const) {
    const s = p[k];
    if (typeof s !== 'number' || !Number.isFinite(s) || s < 0) throw new RangeError(`parents[${i}].${k} must be a finite nonnegative number.`);
  }
}

export function resolveBranchOptions(input: BranchOptionsInput): BranchOptions {
  if (typeof input !== 'object' || input === null) throw new TypeError('options must be an object.');
  const o: BranchOptions = { ...BRANCH_DEFAULTS, ...input };
  assertUint32(o.documentSeed, 'documentSeed');
  assertStoredId(o.randomStreamId, 'randomStreamId');
  if (typeof o.count !== 'number' || !Number.isInteger(o.count) || o.count < 0 || o.count > MAX_BRANCH_COUNT) {
    throw new RangeError(`count must be an integer in [0,${MAX_BRANCH_COUNT}].`);
  }
  if (o.countMode !== 'total' && o.countMode !== 'perParent') throw new TypeError("countMode must be 'total' or 'perParent'.");
  assertRange(o.attachmentMin, o.attachmentMax, 'attachment', 0, 1);
  assertRange(o.lengthMin, o.lengthMax, 'length', 0, Number.MAX_VALUE);
  assertFinite(o.spread, 'spread');
  if (o.spread < 0 || o.spread > Math.PI) throw new RangeError('spread must be in [0,pi].');
  assertRange(o.widthMin, o.widthMax, 'width', 0, 1);
  assertRange(o.opacityMin, o.opacityMax, 'opacity', 0, 1);
  if (typeof o.groundEndClamp !== 'boolean') throw new TypeError('groundEndClamp must be a boolean.');
  assertFinite(o.groundY, 'groundY');
  return o;
}

/** Stable branch id from parent id and local branch ordinal. */
export function branchId(parentId: string, localOrdinal: number): string {
  return `${parentId}/b${localOrdinal}`;
}

/** eventRandomKey binding samples to one parent id: JSON.stringify(["branch",parentId]). */
export function branchParentRandomKey(parentId: string): string {
  return JSON.stringify(['branch', parentId]);
}

function isDegenerate(points: Vec3[]): boolean {
  for (let i = 1; i < points.length; i += 1) if (dist(points[i - 1], points[i]) > 0) return false;
  return true;
}

/** Unit tangent of the first nonzero segment containing arc distance `target`. */
function tangentAtDistance(points: Vec3[], target: number): Vec3 {
  let acc = 0;
  let lastNonZero = -1;
  for (let i = 1; i < points.length; i += 1) {
    const seg = dist(points[i - 1], points[i]);
    if (seg === 0) continue;
    lastNonZero = i;
    if (target <= acc + seg) break;
    acc += seg;
  }
  return stableFrame(points[lastNonZero - 1], points[lastNonZero]).t;
}

function makeBranch(parent: PathData, localOrdinal: number, o: BranchOptions): PathData {
  const key = {
    documentSeed: o.documentSeed, randomStreamId: o.randomStreamId,
    eventRandomKey: branchParentRandomKey(parent.id), entityOrdinal: localOrdinal, sampleOrdinal: 0,
  };
  const r = (propertyKey: string) => sampleUnit({ ...key, propertyKey });
  const fraction = o.attachmentMin + (o.attachmentMax - o.attachmentMin) * r('branchAttachment');
  const start = pointAtArcFraction(parent.points, fraction);
  let total = 0;
  for (let i = 1; i < parent.points.length; i += 1) total += dist(parent.points[i - 1], parent.points[i]);
  const t = tangentAtDistance(parent.points, fraction * total);
  const { n1, n2 } = stableFrame([0, 0, 0], t);
  // Cone: polar angle theta = spread*u in [0,spread] off the tangent, azimuth phi in the stable plane.
  // Equivalent to normalize(t + tan(theta)*radial) but defined for theta up to pi.
  const theta = o.spread * r('branchConeRadius');
  const phi = 2 * Math.PI * r('branchConeAzimuth');
  const ct = Math.cos(theta), st = Math.sin(theta), cp = Math.cos(phi), sp = Math.sin(phi);
  const dir: Vec3 = [
    ct * t[0] + st * (cp * n1[0] + sp * n2[0]),
    ct * t[1] + st * (cp * n1[1] + sp * n2[1]),
    ct * t[2] + st * (cp * n1[2] + sp * n2[2]),
  ];
  const length = o.lengthMin + (o.lengthMax - o.lengthMin) * r('branchLength');
  const end: Vec3 = [start[0] + dir[0] * length, start[1] + dir[1] * length, start[2] + dir[2] * length];
  if (!end.every(Number.isFinite)) {
    throw new RangeError(`branch ${branchId(parent.id, localOrdinal)} endpoint overflows; reduce lengthMax or parent coordinates.`);
  }
  if (o.groundEndClamp && end[1] < o.groundY) end[1] = o.groundY;
  const width = o.widthMin + (o.widthMax - o.widthMin) * r('branchWidth');
  const opacity = o.opacityMin + (o.opacityMax - o.opacityMin) * r('branchOpacity');
  return {
    id: branchId(parent.id, localOrdinal),
    points: [start, end],
    widthScale: clamp01(parent.widthScale * width),
    opacityScale: clamp01(parent.opacityScale * opacity),
  };
}

/** Seeded parent rank sample (independent of attachment/length/cone/width/opacity). */
export function parentRank(parentId: string, documentSeed: number, randomStreamId: string): number {
  return sampleUnit({
    documentSeed, randomStreamId, eventRandomKey: branchParentRandomKey(parentId),
    entityOrdinal: 0, propertyKey: 'branchParentRank', sampleOrdinal: 0,
  });
}

/**
 * Emit trunks (exact clones of parents, input order) and branches separately.
 * total: `count` slots dealt round-robin over non-degenerate parents ranked by seeded rank (id tiebreak).
 * perParent: `count` branches for each non-degenerate parent in id order.
 * Branch points are [attachment, end]; parent ids must be unique (duplicates are rejected).
 * Degenerate parents (<2 distinct points) pass through as trunks and emit no branches.
 */
export function branchPaths(parents: PathData[], options: BranchOptionsInput): BranchResult {
  if (!Array.isArray(parents)) throw new TypeError('parents must be an array of paths.');
  parents.forEach(assertParent);
  const o = resolveBranchOptions(options);
  const seen = new Set<string>();
  for (const p of parents) {
    if (seen.has(p.id)) throw new RangeError(`parent id "${p.id}" is duplicated; branch identity would be ambiguous.`);
    seen.add(p.id);
  }
  const trunks = parents.map((p): PathData => ({
    id: p.id, points: p.points.map(clone), widthScale: p.widthScale, opacityScale: p.opacityScale,
  }));
  const usable = parents.filter((p) => !isDegenerate(p.points));
  const branches: PathData[] = [];
  if (usable.length === 0 || o.count === 0) return { trunks, branches };
  if (o.countMode === 'perParent') {
    for (const p of [...usable].sort(byId)) for (let k = 0; k < o.count; k += 1) branches.push(makeBranch(p, k, o));
    return { trunks, branches };
  }
  const ranked = usable
    .map((p) => ({ p, rank: parentRank(p.id, o.documentSeed, o.randomStreamId) }))
    .sort((a, b) => a.rank - b.rank || byId(a.p, b.p))
    .map((e) => e.p);
  const n = ranked.length;
  for (let i = 0; i < n && i < o.count; i += 1) {
    const perThis = Math.floor(o.count / n) + (i < o.count % n ? 1 : 0);
    for (let k = 0; k < perThis; k += 1) branches.push(makeBranch(ranked[i], k, o));
  }
  return { trunks, branches };
}
