// Frame statistics for vfx_render_frames (A-05 gap: an agent could not tell from the tool that the glow had
// flooded the frame). Decodes an 8-bit RGB/RGBA PNG (non-interlaced) with node:zlib and measures how much
// of the frame is lit: `bright` = luminance > .55 (highlights), `lit` = luminance > .12 (anything visibly lit,
// halo included). A halo shows up as a large `lit` share with a much smaller `bright` core.
import { inflateSync } from 'node:zlib';

export type FrameStats = { lit: number; bright: number };

export function pngFrameStats(png: Uint8Array): FrameStats | undefined {
  const b = Buffer.from(png);
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47) return undefined;
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat: Buffer[] = [];
  for (let o = 8; o + 8 <= b.length;) {
    const len = b.readUInt32BE(o), kind = b.toString('latin1', o + 4, o + 8), data = b.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    o += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (!w || !h || depth !== 8 || !bpp || interlace) return undefined;
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp;
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride), lit = 0, bright = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[x] = v & 255;
    }
    // Skip the bottom-left label strip (capture.html prints the tick there).
    for (let x = 0; x < w; x++) {
      if (y > h * 0.92 && x < w * 0.3) continue;
      const i = x * bpp, l = (0.2126 * cur[i] + 0.7152 * cur[i + 1] + 0.0722 * cur[i + 2]) / 255;
      if (l > 0.12) lit++;
      if (l > 0.55) bright++;
    }
    [prev, cur] = [cur, prev];
  }
  const n = w * h;
  return { lit: lit / n, bright: bright / n };
}

/** One line for the tool result; flags a probable glow flood (large lit area around a small bright core). */
export function describeFrameStats(tick: number, s: FrameStats | undefined): string {
  if (!s) return `tick ${tick}: (no statistics)`;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const halo = s.lit > 0.25 && s.lit > s.bright * 6;
  return `tick ${tick}: lit ${pct(s.lit)} of frame, bright ${pct(s.bright)}${halo ? ' — WARNING: a large dim halo around a small bright core (glow flooding). Lower additive emission/overlap or EffectOutput glowLimit/glowRadius.' : ''}`;
}
