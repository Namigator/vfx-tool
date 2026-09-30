// Typed view of the bundled sprite library (assets/sprites/manifest.json, produced by
// tools/bake-sprites.mjs). Pure: no DOM or Three dependencies. See WP05-TEXTURED-MATERIALS-FLIPBOOK.md.

export type SpriteKind = 'flipbook' | 'variants' | 'texture';

export interface SpriteSheet {
  id: string;
  file: string;
  kind: SpriteKind;
  cell: [number, number];
  columns: number;
  rows: number;
  blend: string;
}

export interface SpriteLibrary {
  sprites: ReadonlyMap<string, SpriteSheet>;
}

export interface SpriteCellUv {
  u0: number; v0: number; u1: number; v1: number;
}

const KINDS: readonly SpriteKind[] = ['flipbook', 'variants', 'texture'];
const isPositiveInt = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;

export function parseSpriteManifest(json: unknown): SpriteLibrary {
  const list = (json as { sprites?: unknown })?.sprites;
  if (!Array.isArray(list)) throw new Error('sprite manifest: missing "sprites" array');
  const sprites = new Map<string, SpriteSheet>();
  for (const [i, raw] of list.entries()) {
    const s = raw as Partial<SpriteSheet>;
    const where = `sprite manifest entry ${i}${typeof s?.id === 'string' ? ` (${s.id})` : ''}`;
    if (typeof s?.id !== 'string' || s.id === '') throw new Error(`${where}: id must be a non-empty string`);
    if (sprites.has(s.id)) throw new Error(`${where}: duplicate id`);
    if (typeof s.file !== 'string' || !s.file.endsWith('.png')) throw new Error(`${where}: file must be a .png`);
    if (!KINDS.includes(s.kind as SpriteKind)) throw new Error(`${where}: unknown kind ${String(s.kind)}`);
    if (!Array.isArray(s.cell) || s.cell.length !== 2 || !s.cell.every(isPositiveInt)) throw new Error(`${where}: cell must be two positive integers`);
    if (!isPositiveInt(s.columns) || !isPositiveInt(s.rows)) throw new Error(`${where}: columns/rows must be positive integers`);
    sprites.set(s.id, { id: s.id, file: s.file, kind: s.kind as SpriteKind, cell: [s.cell[0], s.cell[1]], columns: s.columns, rows: s.rows, blend: typeof s.blend === 'string' ? s.blend : 'normal' });
  }
  return { sprites };
}

export function getSprite(lib: SpriteLibrary, id: string): SpriteSheet {
  const s = lib.sprites.get(id);
  if (!s) throw new Error(`unknown sprite id "${id}"; known: ${[...lib.sprites.keys()].join(', ')}`);
  return s;
}

/** Frame index (row-major across the whole atlas) for a flipbook played once over particle life; normalizedAge 1 lands on the last frame. */
export function frameOverLife(sheet: SpriteSheet, normalizedAge: number): number {
  const a = Math.min(1, Math.max(0, normalizedAge));
  const n = sheet.columns * sheet.rows;
  return Math.min(n - 1, Math.floor(a * n));
}

/** UV rectangle (v0 at the top row) inset by half a texel so bilinear filtering never bleeds across cells. */
export function cellUv(sheet: SpriteSheet, column: number, row: number): SpriteCellUv {
  if (!Number.isInteger(column) || column < 0 || column >= sheet.columns) throw new RangeError(`column ${column} outside 0..${sheet.columns - 1}`);
  if (!Number.isInteger(row) || row < 0 || row >= sheet.rows) throw new RangeError(`row ${row} outside 0..${sheet.rows - 1}`);
  const w = sheet.cell[0] * sheet.columns, h = sheet.cell[1] * sheet.rows;
  return {
    u0: (column * sheet.cell[0] + 0.5) / w, u1: ((column + 1) * sheet.cell[0] - 0.5) / w,
    v0: (row * sheet.cell[1] + 0.5) / h, v1: ((row + 1) * sheet.cell[1] - 0.5) / h,
  };
}

export type FlipbookMode = 'overLife' | 'fps' | 'first';

/**
 * Atlas cell for one particle. flipbook sheets: overLife plays once over the particle's life (last frame at
 * age 1), fps loops at a fixed rate from frame 0 or a per-particle random start, first holds frame 0.
 * variants/texture sheets: a per-particle random cell, fixed for its whole life. randomUnit in [0,1).
 */
/**
 * 09 flipbook with optional crossfade: the current cell, the next one and the blend (0..1) between them. Over life the
 * sequence plays once (normalized age 1 = last frame, never wrapping); fps loops unless `loop` is false (then it holds
 * the last frame). Variant sheets never blend.
 */
export function spriteCellBlend(sheet: SpriteSheet, mode: FlipbookMode, fps: number, lifeFraction: number, ageSeconds: number, randomUnit: number, randomStart: boolean, fixedVariant = -1, loop = true): { cell: number; next: number; t: number } {
  const n = sheet.columns * sheet.rows;
  if (sheet.kind !== 'flipbook' || mode === 'first') { const c = spriteCell(sheet, mode, fps, lifeFraction, ageSeconds, randomUnit, randomStart, fixedVariant, loop); return { cell: c, next: c, t: 0 }; }
  if (mode === 'overLife') {
    const pos = Math.min(n - 1, Math.max(0, lifeFraction) * n), cell = Math.min(n - 1, Math.floor(pos));
    return { cell, next: Math.min(n - 1, cell + 1), t: cell === n - 1 ? 0 : pos - cell };
  }
  const start = randomStart ? Math.min(n - 1, Math.floor(randomUnit * n)) : 0, pos = start + Math.max(0, ageSeconds) * fps;
  if (!loop) { const cell = Math.min(n - 1, Math.floor(pos)); return { cell, next: Math.min(n - 1, cell + 1), t: cell === n - 1 ? 0 : pos - Math.floor(pos) }; }
  const cell = Math.floor(pos) % n;
  return { cell, next: (cell + 1) % n, t: pos - Math.floor(pos) };
}

export function spriteCell(sheet: SpriteSheet, mode: FlipbookMode, fps: number, lifeFraction: number, ageSeconds: number, randomUnit: number, randomStart: boolean, fixedVariant = -1, loop = true): number {
  const n = sheet.columns * sheet.rows;
  const pick = Math.min(n - 1, Math.floor(randomUnit * n));
  if (sheet.kind !== 'flipbook') return fixedVariant >= 0 ? Math.min(n - 1, fixedVariant) : pick;
  if (mode === 'first') return 0;
  if (mode === 'overLife') return frameOverLife(sheet, lifeFraction);
  const frame = (randomStart ? pick : 0) + Math.floor(Math.max(0, ageSeconds) * fps);
  return loop ? frame % n : Math.min(n - 1, frame);
}
