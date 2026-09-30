// Export media (sprite sheet / PNG sequence / GIF / video): pure planning helpers shared by the editor, the capture
// page and the MCP server. No DOM, no Three.js. The effect runs at 60 ticks per second; a frame rate of F samples
// every 60/F ticks, so the exported animation plays at the effect's own speed.
export const TICKS_PER_SECOND = 60;

export type MediaFormat = 'spritesheet' | 'png-sequence' | 'gif' | 'mp4' | 'webm';
export type MediaBackground = 'transparent' | 'dark' | 'light';
export const MEDIA_FORMATS: readonly MediaFormat[] = ['spritesheet', 'png-sequence', 'gif', 'mp4', 'webm'];

/** Longest side of an exported sprite sheet in pixels (above this common engines cannot use it as a texture). */
export const MAX_SHEET_SIDE = 16384;
/** Most pixels (64 M) in one exported sprite sheet: keeps the PNG encode within browser memory. */
export const MAX_SHEET_PIXELS = 64 * 1024 * 1024;
/** Largest frame width or height in pixels for exported media. */
export const MAX_FRAME_SIDE = 4096;
/** Most frames one media export may contain (lower the fps or the tick range to fit). */
export const MAX_FRAMES = 1200;
/** RGBA bytes kept in memory at once (GIF keeps every frame for its shared palette). */
export const MAX_BUFFERED_BYTES = 1_200_000_000;

export type MediaOptions = {
  format: MediaFormat;
  /** Frame size in pixels (video: rounded up to even numbers). */
  width: number;
  height: number;
  fps: number;
  /** Effect ticks [startTick, endTick): default the whole effect. */
  startTick: number;
  endTick: number;
  /** Sprite sheet columns (default: about the square root of the frame count). */
  columns?: number;
  background: MediaBackground;
  glow: boolean;
  /** Whether the animation loops (GIF loop count, sidecar flag). */
  loop: boolean;
};

export type MediaDefaults = { width: number; height: number; fps: number; background: MediaBackground; glow: boolean; loop: boolean };

/** Default background per format: sheets and sequences are transparent, GIF/video need a solid colour (GIF has 1-bit alpha). */
export function defaultBackground(format: MediaFormat): MediaBackground {
  return format === 'spritesheet' || format === 'png-sequence' ? 'transparent' : 'dark';
}

/** Ticks sampled for an export: start + round(i * 60 / fps) for every frame i that lies inside [start, end). */
export function frameTicks(startTick: number, endTick: number, fps: number): number[] {
  const span = endTick - startTick;
  if (!(span > 0) || !(fps > 0)) return [];
  const step = TICKS_PER_SECOND / fps, out: number[] = [];
  for (let i = 0; ; i++) {
    const t = startTick + Math.round(i * step);
    if (t >= endTick) break;
    if (out.length && t === out[out.length - 1]) continue; // fps above 60 would repeat ticks
    out.push(t);
    if (out.length > MAX_FRAMES * 4) break;
  }
  return out.length ? out : [startTick];
}

export type SheetLayout = { columns: number; rows: number; frameCount: number; frameWidth: number; frameHeight: number; width: number; height: number };

/** Grid for `frameCount` frames: `columns` (default ceil(sqrt(n))) clamped to 1..n, rows just enough. */
export function sheetLayout(frameCount: number, frameWidth: number, frameHeight: number, columns?: number): SheetLayout {
  const n = Math.max(1, Math.floor(frameCount));
  const cols = Math.min(n, Math.max(1, Math.floor(columns && columns > 0 ? columns : Math.ceil(Math.sqrt(n)))));
  const rows = Math.ceil(n / cols);
  return { columns: cols, rows, frameCount: n, frameWidth, frameHeight, width: cols * frameWidth, height: rows * frameHeight };
}

export type SheetSidecar = {
  image: string;
  columns: number; rows: number; frameCount: number; fps: number;
  frameWidth: number; frameHeight: number;
  durationTicks: number; loop: boolean;
  ticksPerSecond: number; startTick: number; sheetWidth: number; sheetHeight: number; background: MediaBackground;
  name?: string;
};

export function sheetSidecar(layout: SheetLayout, o: Pick<MediaOptions, 'fps' | 'startTick' | 'endTick' | 'loop' | 'background'>, image: string, name?: string): SheetSidecar {
  return {
    image, columns: layout.columns, rows: layout.rows, frameCount: layout.frameCount, fps: o.fps,
    frameWidth: layout.frameWidth, frameHeight: layout.frameHeight, durationTicks: o.endTick - o.startTick, loop: o.loop,
    ticksPerSecond: TICKS_PER_SECOND, startTick: o.startTick, sheetWidth: layout.width, sheetHeight: layout.height, background: o.background,
    ...(name ? { name } : {}),
  };
}

/** File names of the PNG sequence inside its zip: <base>_0000.png ... (width grows with the frame count). */
export function sequenceNames(base: string, frameCount: number): string[] {
  const digits = Math.max(4, String(Math.max(0, frameCount - 1)).length);
  return Array.from({ length: frameCount }, (_, i) => `${base}_${String(i).padStart(digits, '0')}.png`);
}

export function mediaExtension(format: MediaFormat): string {
  return format === 'spritesheet' ? 'png' : format === 'png-sequence' ? 'zip' : format;
}

const even = (n: number) => (n % 2 === 0 ? n : n + 1);

/** Validates and completes options; returns a message instead of throwing so callers can show it. */
export function resolveMediaOptions(input: Partial<MediaOptions> & { format: MediaFormat }, durationTicks: number): { ok: true; options: MediaOptions; ticks: number[]; layout: SheetLayout | null } | { ok: false; message: string } {
  const format = input.format;
  if (!MEDIA_FORMATS.includes(format)) return { ok: false, message: `Unknown format "${format}". Use ${MEDIA_FORMATS.join(', ')}.` };
  const isVideo = format === 'mp4' || format === 'webm';
  let width = Math.round(input.width ?? 256), height = Math.round(input.height ?? input.width ?? 256);
  const fps = input.fps ?? (isVideo ? 30 : format === 'gif' ? 20 : 30);
  const startTick = Math.max(0, Math.floor(input.startTick ?? 0)), endTick = Math.min(Math.floor(input.endTick ?? durationTicks), Math.floor(durationTicks));
  const background = input.background ?? defaultBackground(format);
  if (![width, height].every(n => Number.isFinite(n) && n >= 16 && n <= MAX_FRAME_SIDE)) return { ok: false, message: `Frame size must be 16..${MAX_FRAME_SIDE} pixels per side (got ${width}x${height}).` };
  if (!(fps >= 1 && fps <= 120)) return { ok: false, message: `fps must be 1..120 (got ${fps}).` };
  if (!(endTick > startTick)) return { ok: false, message: `Tick range is empty: startTick ${startTick}, endTick ${endTick} (the effect lasts ${durationTicks} ticks).` };
  if (isVideo && background === 'transparent') return { ok: false, message: 'Video needs a solid background (dark or light); transparent video is not supported.' };
  if (isVideo) { width = even(width); height = even(height); }
  const ticks = frameTicks(startTick, endTick, fps);
  if (ticks.length > MAX_FRAMES) return { ok: false, message: `${ticks.length} frames is more than the ${MAX_FRAMES} limit; lower the fps or shorten the tick range.` };
  const options: MediaOptions = { format, width, height, fps, startTick, endTick, background, glow: input.glow ?? true, loop: input.loop ?? true, ...(input.columns ? { columns: Math.floor(input.columns) } : {}) };
  let layout: SheetLayout | null = null;
  if (format === 'spritesheet') {
    layout = sheetLayout(ticks.length, width, height, options.columns);
    if (layout.width > MAX_SHEET_SIDE || layout.height > MAX_SHEET_SIDE || layout.width * layout.height > MAX_SHEET_PIXELS)
      return { ok: false, message: `The sheet would be ${layout.width}x${layout.height} pixels (${layout.columns} columns x ${layout.rows} rows), above the ${MAX_SHEET_SIDE}-pixel / ${MAX_SHEET_PIXELS / 1e6}M-pixel limit. Use a smaller frame size, a lower fps or fewer ticks.` };
  }
  if (format === 'gif' && ticks.length * width * height * 4 > MAX_BUFFERED_BYTES) return { ok: false, message: 'A GIF this large does not fit in memory; lower the size, fps or tick range.' };
  return { ok: true, options, ticks, layout };
}
