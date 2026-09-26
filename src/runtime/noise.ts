// Deterministic procedural noise for particle motion (07-SIMULATION "Noise and random streams").
// Value noise on a seeded integer lattice, trilinear interpolation with smoothstep weights; time is a
// fourth input interpolated (smoothstep) between adjacent seeded 3D fields. Curl mode takes the curl of
// three independent scalar fields by central differences (epsilon .01 in noise coordinates) and
// normalizes with zero-vector protection. Pure: no DOM, wall clock or global RNG.
import type { Vec3 } from '../model/types.ts';

export const CURL_EPSILON = 0.01;

/** Uniform [-1,1) value for lattice point (i,j,k) of time slice w under a uint32 seed. */
export function latticeValue(seed: number, i: number, j: number, k: number, w: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (i | 0), 0x27d4eb2d); h ^= h >>> 15;
  h = Math.imul(h ^ (j | 0), 0x165667b1); h ^= h >>> 13;
  h = Math.imul(h ^ (k | 0), 0x9e3779b1); h ^= h >>> 16;
  h = Math.imul(h ^ (w | 0), 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 2147483648 - 1;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function slice(seed: number, x: number, y: number, z: number, w: number): number {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const u = smooth(x - i), v = smooth(y - j), s = smooth(z - k);
  const L = (a: number, b: number, c: number) => latticeValue(seed, i + a, j + b, k + c, w);
  return mix(
    mix(mix(L(0, 0, 0), L(1, 0, 0), u), mix(L(0, 1, 0), L(1, 1, 0), u), v),
    mix(mix(L(0, 0, 1), L(1, 0, 1), u), mix(L(0, 1, 1), L(1, 1, 1), u), v),
    s,
  );
}

/** Scalar value noise in [-1,1] at noise-space point (x,y,z) and time coordinate t. */
export function valueNoise4(seed: number, x: number, y: number, z: number, t: number): number {
  const w = Math.floor(t);
  return mix(slice(seed, x, y, z, w), slice(seed, x, y, z, w + 1), smooth(t - w));
}

export type NoiseFieldSeeds = [number, number, number];

/**
 * Acceleration from three scalar fields at world point p. vector: (n0,n1,n2)·amplitude.
 * curl: normalized curl of (n0,n1,n2)·amplitude (divergence-free swirl), zero when the curl vanishes.
 */
export function noiseAcceleration(seeds: NoiseFieldSeeds, mode: 'vector' | 'curl', amplitude: number, frequency: number, time: number, p: Vec3, out: Vec3): Vec3 {
  const x = p[0] * frequency, y = p[1] * frequency, z = p[2] * frequency;
  const [a, b, c] = seeds;
  if (mode === 'vector') {
    out[0] = valueNoise4(a, x, y, z, time) * amplitude;
    out[1] = valueNoise4(b, x, y, z, time) * amplitude;
    out[2] = valueNoise4(c, x, y, z, time) * amplitude;
    return out;
  }
  const e = CURL_EPSILON, d = 2 * e;
  const dzdy = (valueNoise4(c, x, y + e, z, time) - valueNoise4(c, x, y - e, z, time)) / d;
  const dydz = (valueNoise4(b, x, y, z + e, time) - valueNoise4(b, x, y, z - e, time)) / d;
  const dxdz = (valueNoise4(a, x, y, z + e, time) - valueNoise4(a, x, y, z - e, time)) / d;
  const dzdx = (valueNoise4(c, x + e, y, z, time) - valueNoise4(c, x - e, y, z, time)) / d;
  const dydx = (valueNoise4(b, x + e, y, z, time) - valueNoise4(b, x - e, y, z, time)) / d;
  const dxdy = (valueNoise4(a, x, y + e, z, time) - valueNoise4(a, x, y - e, z, time)) / d;
  const cx = dzdy - dydz, cy = dxdz - dzdx, cz = dydx - dxdy, l = Math.hypot(cx, cy, cz);
  if (!(l > 1e-12)) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
  out[0] = cx / l * amplitude; out[1] = cy / l * amplitude; out[2] = cz / l * amplitude;
  return out;
}
