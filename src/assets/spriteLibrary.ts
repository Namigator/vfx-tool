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

/** Column for a flipbook played once over particle life; normalizedAge 1 lands on the last column. */
export function frameOverLife(sheet: SpriteSheet, normalizedAge: number): number {
  const a = Math.min(1, Math.max(0, normalizedAge));
  return Math.min(sheet.columns - 1, Math.floor(a * sheet.columns));
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
