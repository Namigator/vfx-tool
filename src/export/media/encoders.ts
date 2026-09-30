// Container encoders that need no browser: GIF (gifenc), PNG sequence zip (fflate), sprite sheet PNG. Pure functions over
// straight-alpha RGBA8 frames so they run in the editor, the capture page and the tests.
import * as gifencNs from 'gifenc';
import { zipSync } from 'fflate';
import { encodePngRgba } from './png.ts';
import { blitFrame } from './matte.ts';
import { sequenceNames, sheetLayout } from './layout.ts';

// gifenc ships a CommonJS main (Node resolves that: named exports live on `default`) and an ES module build (browser
// bundlers: named exports). Accept either shape.
const gifenc = ((gifencNs as unknown as { GIFEncoder?: unknown }).GIFEncoder ? gifencNs : (gifencNs as unknown as { default: typeof gifencNs }).default) as typeof gifencNs;
const { GIFEncoder, applyPalette, quantize } = gifenc;

export type GifOptions = { fps: number; loop: boolean; transparent: boolean };

/** Centisecond delay of frame `i`: GIF delays are whole 1/100 s, so spread the rounding error (30 fps = 3,3,4,3,3,4...). */
export function gifDelaysMs(frameCount: number, fps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < frameCount; i++) out.push(10 * (Math.max(1, Math.round(((i + 1) * 100) / fps)) - Math.round((i * 100) / fps)));
  return out.map(d => Math.max(20, d)); // browsers clamp anything under 2 cs up to 10 cs; 2 cs is the practical floor
}

/** Animated GIF with ONE global palette built from all frames (no colour flicker between frames). Looping by default. */
export function encodeGif(frames: readonly (Uint8ClampedArray | Uint8Array)[], width: number, height: number, o: GifOptions): Uint8Array {
  if (!frames.length) throw new Error('encodeGif: no frames.');
  // Shared palette from an even sample of every frame (at most ~400k pixels in total).
  const perFrame = Math.max(1000, Math.floor(400_000 / frames.length)), pixels = width * height, stride = Math.max(1, Math.floor(pixels / perFrame));
  const sample = new Uint8Array(Math.ceil(pixels / stride) * frames.length * 4);
  let at = 0;
  for (const f of frames) for (let p = 0; p < pixels; p += stride) { const i = p * 4; sample[at++] = f[i]; sample[at++] = f[i + 1]; sample[at++] = f[i + 2]; sample[at++] = f[i + 3]; }
  const format = o.transparent ? 'rgba4444' : 'rgb565';
  const palette = quantize(sample.subarray(0, at), 256, o.transparent ? { format, oneBitAlpha: true, clearAlpha: true, clearAlphaThreshold: 127 } : { format });
  const transparentIndex = o.transparent ? palette.findIndex(c => c.length > 3 && c[3] === 0) : -1;
  const enc = GIFEncoder();
  const delays = gifDelaysMs(frames.length, o.fps);
  frames.forEach((f, i) => {
    const index = applyPalette(f, palette, format);
    enc.writeFrame(index, width, height, {
      delay: delays[i], repeat: o.loop ? 0 : -1,
      ...(i === 0 ? { palette } : {}),
      ...(transparentIndex >= 0 ? { transparent: true, transparentIndex } : {}),
    });
  });
  enc.finish();
  return enc.bytes();
}

/** Zip of PNG files (stored: PNG data is already compressed). */
export function encodePngSequenceZip(pngs: readonly Uint8Array[], base: string): Uint8Array {
  const names = sequenceNames(base, pngs.length), files: Record<string, Uint8Array> = {};
  pngs.forEach((p, i) => { files[names[i]] = p; });
  return zipSync(files, { level: 0 });
}

/** Packs frames into one grid image (straight RGBA8, row 0 = top); unused cells stay transparent. */
export function packSheet(frames: readonly (Uint8ClampedArray | Uint8Array)[], frameWidth: number, frameHeight: number, columns?: number): { rgba: Uint8ClampedArray; width: number; height: number; columns: number; rows: number } {
  const l = sheetLayout(frames.length, frameWidth, frameHeight, columns), rgba = new Uint8ClampedArray(l.width * l.height * 4);
  frames.forEach((f, i) => blitFrame(rgba, l.width, f, frameWidth, frameHeight, l.columns, i));
  return { rgba, width: l.width, height: l.height, columns: l.columns, rows: l.rows };
}
