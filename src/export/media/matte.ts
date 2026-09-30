// Transparent export by difference matting (pure pixel math, no DOM).
//
// The preview blends in scene-linear HDR: additive layers add light, normal layers mix toward their colour, and only
// then does the output pass apply ACES + sRGB. A transparent frame is therefore recovered from THREE renders of the same
// tick:
//   display : the editor's own output on the dark arena colour (glow on), values 0..1     -> D
//   linBlack: scene-linear HDR on black, glow off                                         -> Lk = F
//   linWhite: scene-linear HDR on white (1.0), glow off                                   -> Lw = F + (1 - coverage) * 1
// so coverage = 1 - (Lw - Lk), per channel (averaged). Additive light leaves coverage 0, normal-blend smoke gives its
// opacity. Doing this subtraction in scene-linear space is the point: after ACES + sRGB the two renders would differ
// non-linearly and the alpha would be wrong. Bloom is left out of the two linear renders (a uniform background above the
// glow threshold would glow and corrupt the difference); the glow halo instead comes through the display render.
//
// The result is straight alpha, defined so that compositing it over the dark arena colour reproduces the display render:
//   bg    = display colour of the empty dark arena
//   alpha = max(coverage, max((D - bg) / (1 - bg)))   (additive glow becomes alpha = its brightness above the arena)
//   premultiplied = D - (1 - alpha) * bg,  colour = premultiplied / alpha
// Over other backgrounds glow and smoke are approximate (the tone curve is not linear), exact over the dark arena.

/** Pixels whose coverage is below this (and that emit no light) are fully transparent (half-float noise floor). */
export const COVERAGE_FLOOR = 0.002;

/**
 * @param display   RGBA floats 0..1: the editor output on black (with glow)
 * @param linBlack  RGBA floats, scene-linear, black background, no glow
 * @param linWhite  RGBA floats, scene-linear, white (1,1,1) background, no glow
 * @returns straight (non-premultiplied) RGBA8
 */
export function matteFrame(display: Float32Array, linBlack: Float32Array, linWhite: Float32Array, out?: Uint8ClampedArray, bg: readonly [number, number, number] = [0, 0, 0]): Uint8ClampedArray {
  const n = display.length;
  if (linBlack.length !== n || linWhite.length !== n) throw new Error('matteFrame: the three renders must have the same size.');
  const res = out ?? new Uint8ClampedArray(n);
  const br = bg[0], bgc = bg[1], bb = bg[2];
  for (let i = 0; i < n; i += 4) {
    const dr = clamp01(display[i]), dg = clamp01(display[i + 1]), db = clamp01(display[i + 2]);
    const cov = clamp01(1 - ((linWhite[i] - linBlack[i]) + (linWhite[i + 1] - linBlack[i + 1]) + (linWhite[i + 2] - linBlack[i + 2])) / 3);
    const light = Math.max((dr - br) / (1 - br), (dg - bgc) / (1 - bgc), (db - bb) / (1 - bb), 0);
    const a = Math.max(cov, light);
    if (a < COVERAGE_FLOOR) { res[i] = res[i + 1] = res[i + 2] = res[i + 3] = 0; continue; }
    const k = 1 - a;
    res[i] = Math.round(clamp01(Math.max(0, dr - k * br) / a) * 255);
    res[i + 1] = Math.round(clamp01(Math.max(0, dg - k * bgc) / a) * 255);
    res[i + 2] = Math.round(clamp01(Math.max(0, db - k * bb) / a) * 255);
    res[i + 3] = Math.round(a * 255);
  }
  return res;
}

/** The preview's output transform for one scene-linear colour: ACES filmic (exposure 1) then sRGB encode, 0..1. Mirrors three.js. */
export function acesSrgb(c: readonly [number, number, number]): [number, number, number] {
  const e = 1 / 0.6, r = c[0] * e, g = c[1] * e, b = c[2] * e;
  const v = [0.59719 * r + 0.35458 * g + 0.04823 * b, 0.07600 * r + 0.90834 * g + 0.01566 * b, 0.02840 * r + 0.13383 * g + 0.83777 * b].map(x => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
  const o = [1.60475 * v[0] - 0.53108 * v[1] - 0.07367 * v[2], -0.10208 * v[0] + 1.10813 * v[1] - 0.00605 * v[2], -0.00327 * v[0] - 0.07276 * v[1] + 1.07602 * v[2]];
  return o.map(x => { const y = clamp01(x); return y <= 0.0031308 ? y * 12.92 : 1.055 * y ** (1 / 2.4) - 0.055; }) as [number, number, number];
}

/** Opaque RGBA8 from display-referred floats (solid backgrounds: the editor's output as is). */
export function opaqueFrame(display: Float32Array, out?: Uint8ClampedArray): Uint8ClampedArray {
  const res = out ?? new Uint8ClampedArray(display.length);
  for (let i = 0; i < display.length; i += 4) {
    res[i] = Math.round(clamp01(display[i]) * 255); res[i + 1] = Math.round(clamp01(display[i + 1]) * 255);
    res[i + 2] = Math.round(clamp01(display[i + 2]) * 255); res[i + 3] = 255;
  }
  return res;
}

/** Blends a screen flash (colour at `alpha`) over an opaque frame in display space, like the editor's overlay. */
export function applyFlash(rgba: Uint8ClampedArray, colour: readonly [number, number, number], alpha: number): void {
  if (alpha <= 0) return;
  const a = Math.min(1, alpha);
  for (let i = 0; i < rgba.length; i += 4) for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(rgba[i + c] * (1 - a) + colour[c] * a);
}

/** Straight-alpha RGBA8 composited over a solid colour (sRGB bytes), as any viewer or engine does. Returns opaque RGBA8. */
export function compositeOver(rgba: Uint8ClampedArray | Uint8Array, bg: readonly [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    for (let c = 0; c < 3; c++) out[i + c] = Math.round(rgba[i + c] * a + bg[c] * (1 - a));
    out[i + 3] = 255;
  }
  return out;
}

/** Composites over a light/dark checkerboard so transparency is visible in a preview picture (opaque RGBA8). */
export function compositeChecker(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, cell = 8): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, bg = ((x / cell | 0) + (y / cell | 0)) % 2 === 0 ? 70 : 110, a = rgba[i + 3] / 255;
    for (let c = 0; c < 3; c++) out[i + c] = Math.round(rgba[i + c] * a + bg * (1 - a));
    out[i + 3] = 255;
  }
  return out;
}

/** Mean absolute difference of the RGB channels (0..255) between two equally sized RGBA8 images. */
export function meanAbsDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error('meanAbsDifference: sizes differ.');
  let sum = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) { sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3; }
  return n ? sum / n : 0;
}

/** sRGB hex colour (#rrggbb) to bytes. */
export function hexToBytes(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Copies a frame into a sheet buffer (straight RGBA8) at grid cell `index`. */
export function blitFrame(sheet: Uint8ClampedArray | Uint8Array, sheetWidth: number, frame: Uint8ClampedArray | Uint8Array, frameWidth: number, frameHeight: number, columns: number, index: number): void {
  const ox = (index % columns) * frameWidth, oy = Math.floor(index / columns) * frameHeight;
  for (let y = 0; y < frameHeight; y++) sheet.set(frame.subarray(y * frameWidth * 4, (y + 1) * frameWidth * 4), ((oy + y) * sheetWidth + ox) * 4);
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
