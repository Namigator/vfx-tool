// Deterministic RadialPath core (plan24 "Path features required by the presets", 05 catalog).
// Pure: no DOM, React or Three. Each path is a straight 2-point segment center → center + dir*length.
//
// Decisions (plan leaves the frame implicit):
// - Local frame: cone axis and sphere pole are +Y; disc lies in the XZ plane. `orientation` (xyzw,
//   normalized here) rotates the local direction before it is added to the center.
// - sphere: y uniform in [-1,1], azimuth uniform → uniform on S². cone: y uniform in [cos(angle),1] →
//   uniform over the spherical cap (angle π equals sphere). disc: azimuth uniform in [0,2π).
// - Length is uniform in [lengthMin, lengthMax]; lengthMin > lengthMax is rejected, not swapped.
// - Random key: entityOrdinal = path index, sampleOrdinal 0, eventRandomKey ''. Path IDs are "p<index>",
//   so changing count keeps earlier paths identical.
import type { Quaternion, Vec3 } from '../model/types.ts';
import { assertStoredId, assertUint32, sampleUnit } from './random.ts';
import type { PathData } from './paths.ts';

export type RadialMode = 'sphere' | 'disc' | 'cone';

export interface RadialOptions {
  documentSeed: number;
  randomStreamId: string;
  mode: RadialMode;
  count: number;
  lengthMin: number;
  lengthMax: number;
  /** Radians, [0, π]. Cone mode only. */
  coneAngle: number;
  orientation: Quaternion;
}

export const MIN_RADIAL_COUNT = 1;
export const MAX_RADIAL_COUNT = 128;
export const MIN_RADIAL_LENGTH = 0.001;
export const MAX_RADIAL_LENGTH = 50;
export const RADIAL_DEFAULTS = {
  mode: 'sphere' as RadialMode, count: 32, lengthMin: 0.6, lengthMax: 2.4, coneAngle: Math.PI / 6,
  orientation: [0, 0, 0, 1] as Quaternion,
};

function assertLength(v: unknown, name: string): asserts v is number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < MIN_RADIAL_LENGTH || v > MAX_RADIAL_LENGTH) {
    throw new RangeError(`${name} must be a finite number in [${MIN_RADIAL_LENGTH},${MAX_RADIAL_LENGTH}].`);
  }
}

function rotate(q: Quaternion, v: Vec3): Vec3 {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  const qx = q[0] / n, qy = q[1] / n, qz = q[2] / n, qw = q[3] / n;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Unit direction in the local frame for path `index`. */
export function radialDirection(mode: RadialMode, coneAngle: number, u: number, v: number): Vec3 {
  const phi = 2 * Math.PI * v;
  if (mode === 'disc') return [Math.cos(phi), 0, Math.sin(phi)];
  const minY = mode === 'sphere' ? -1 : Math.cos(coneAngle);
  const y = 1 - u * (1 - minY);
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  return [r * Math.cos(phi), y, r * Math.sin(phi)];
}

export function radialPaths(center: Vec3, options: RadialOptions): PathData[] {
  if (!Array.isArray(center) || center.length !== 3 || !center.every(c => typeof c === 'number' && Number.isFinite(c))) {
    throw new TypeError('center must be a finite Vec3.');
  }
  if (typeof options !== 'object' || options === null) throw new TypeError('options must be an object.');
  const o = options;
  assertUint32(o.documentSeed, 'documentSeed');
  assertStoredId(o.randomStreamId, 'randomStreamId');
  if (o.mode !== 'sphere' && o.mode !== 'disc' && o.mode !== 'cone') throw new RangeError('mode must be sphere, disc or cone.');
  if (!Number.isInteger(o.count) || o.count < MIN_RADIAL_COUNT || o.count > MAX_RADIAL_COUNT) {
    throw new RangeError(`count must be an integer in [${MIN_RADIAL_COUNT},${MAX_RADIAL_COUNT}].`);
  }
  assertLength(o.lengthMin, 'lengthMin');
  assertLength(o.lengthMax, 'lengthMax');
  if (o.lengthMin > o.lengthMax) throw new RangeError('lengthMin must not exceed lengthMax.');
  if (typeof o.coneAngle !== 'number' || !Number.isFinite(o.coneAngle) || o.coneAngle < 0 || o.coneAngle > Math.PI) {
    throw new RangeError('coneAngle must be a finite number in [0,π] radians.');
  }
  const q = o.orientation;
  if (!Array.isArray(q) || q.length !== 4 || !q.every(c => typeof c === 'number' && Number.isFinite(c)) || Math.hypot(q[0], q[1], q[2], q[3]) === 0) {
    throw new TypeError('orientation must be a finite nonzero quaternion (xyzw).');
  }
  const out: PathData[] = [];
  for (let i = 0; i < o.count; i += 1) {
    const key = { documentSeed: o.documentSeed, randomStreamId: o.randomStreamId, eventRandomKey: '', entityOrdinal: i, sampleOrdinal: 0 };
    const u = sampleUnit({ ...key, propertyKey: 'radialU' });
    const v = sampleUnit({ ...key, propertyKey: 'radialV' });
    const w = sampleUnit({ ...key, propertyKey: 'radialLength' });
    const d = rotate(q, radialDirection(o.mode, o.coneAngle, u, v));
    const len = o.lengthMin + (o.lengthMax - o.lengthMin) * w;
    out.push({
      id: `p${i}`,
      points: [[center[0], center[1], center[2]], [center[0] + d[0] * len, center[1] + d[1] * len, center[2] + d[2] * len]],
      widthScale: 1,
      opacityScale: 1,
    });
  }
  return out;
}
