// Deterministic PathSplitter core: decides which paths of a set go on (`chosen`) and which are left behind (`rest`).
// Pure: no DOM, React or Three. Both outputs keep the input's original order and the paths untouched.
//
// Modes (all indices are positions in the input set):
// - range:    `count` paths starting at index `from` (clamped to the set).
// - everyNth: indices offset, offset+step, offset+2*step, ...
// - random:   `count` paths picked by a seeded score per index (documentSeed + randomStreamId); stable for a given
//             set size, and growing `count` only ever adds paths (the picks are the `count` lowest scores).
// - longest / shortest: the `count` paths with the greatest / smallest arc length (ties: lower index first).
import { assertStoredId, assertUint32, sampleUnit } from './random.ts';
import type { PathData } from './paths.ts';

export type SplitMode = 'range' | 'everyNth' | 'random' | 'longest' | 'shortest';
export const SPLIT_MODES: readonly SplitMode[] = ['range', 'everyNth', 'random', 'longest', 'shortest'];

export interface SplitOptions {
  documentSeed: number;
  randomStreamId: string;
  mode: SplitMode;
  /** range: first index. */
  from: number;
  /** range, random, longest, shortest: how many paths. */
  count: number;
  /** everyNth: step between chosen indices. */
  step: number;
  /** everyNth: first chosen index. */
  offset: number;
}

export const MAX_SPLIT_INDEX = 255;
export const MAX_SPLIT_COUNT = 256;
export const SPLIT_DEFAULTS = { mode: 'range' as SplitMode, from: 0, count: 1, step: 2, offset: 0 };

function assertInt(v: unknown, name: string, lo: number, hi: number): asserts v is number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new RangeError(`${name} must be an integer in [${lo},${hi}].`);
}

export function pathLength(p: PathData): number {
  let len = 0;
  for (let i = 1; i < p.points.length; i++) len += Math.hypot(p.points[i][0] - p.points[i - 1][0], p.points[i][1] - p.points[i - 1][1], p.points[i][2] - p.points[i - 1][2]);
  return len;
}

/** Indices (ascending) of the paths that go on. */
export function chooseIndices(paths: readonly PathData[], o: SplitOptions): number[] {
  const n = paths.length;
  switch (o.mode) {
    case 'range': return Array.from({ length: Math.max(0, Math.min(n, o.from + o.count) - o.from) }, (_, i) => o.from + i);
    case 'everyNth': { const out: number[] = []; for (let i = o.offset; i < n; i += o.step) out.push(i); return out; }
    case 'random':
    case 'longest':
    case 'shortest': {
      const score = (i: number): number => o.mode === 'random'
        ? sampleUnit({ documentSeed: o.documentSeed, randomStreamId: o.randomStreamId, eventRandomKey: '', entityOrdinal: i, propertyKey: 'pathSplit', sampleOrdinal: 0 })
        : o.mode === 'longest' ? -pathLength(paths[i]) : pathLength(paths[i]);
      return paths.map((_, i) => ({ i, s: score(i) })).sort((a, b) => a.s - b.s || a.i - b.i).slice(0, o.count).map(x => x.i).sort((a, b) => a - b);
    }
  }
}

export function splitPaths(paths: readonly PathData[], o: SplitOptions): { chosen: PathData[]; rest: PathData[] } {
  if (typeof o !== 'object' || o === null) throw new TypeError('options must be an object.');
  assertUint32(o.documentSeed, 'documentSeed');
  assertStoredId(o.randomStreamId, 'randomStreamId');
  if (!SPLIT_MODES.includes(o.mode)) throw new RangeError(`mode must be one of ${SPLIT_MODES.join(', ')}.`);
  assertInt(o.from, 'from', 0, MAX_SPLIT_INDEX);
  assertInt(o.count, 'count', 1, MAX_SPLIT_COUNT);
  assertInt(o.step, 'step', 1, MAX_SPLIT_COUNT);
  assertInt(o.offset, 'offset', 0, MAX_SPLIT_INDEX);
  const take = new Set(chooseIndices(paths, o));
  return { chosen: paths.filter((_, i) => take.has(i)), rest: paths.filter((_, i) => !take.has(i)) };
}
