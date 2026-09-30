// Image helpers for the MCP visual loop (WP-MCP2 "contact sheet over a timeline; compare two captures"):
// minimal 8-bit PNG decode/encode (node:zlib only), box-downscaling, grid composition and side-by-side compare.
import { deflateSync, inflateSync } from 'node:zlib';

export type Rgba = { w: number; h: number; px: Uint8Array };

export function decodePng(png: Uint8Array): Rgba {
  const b = Buffer.from(png);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) throw new Error('This file is a JPEG (whatever its extension); only PNG images can be compared. Render or screenshot the reference as PNG first.');
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG file.');
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
  if (!w || !h || depth !== 8 || !bpp || interlace) throw new Error('Only 8-bit RGB/RGBA non-interlaced PNGs are supported.');
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, px = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; px[o] = cur[x * bpp]; px[o + 1] = cur[x * bpp + 1]; px[o + 2] = cur[x * bpp + 2]; px[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255; }
    [prev, cur] = [cur, prev];
  }
  return { w, h, px };
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf: Uint8Array) => { let c = 0xffffffff; for (const x of buf) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(img: Rgba): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) Buffer.from(img.px.buffer, img.px.byteOffset + y * img.w * 4, img.w * 4).copy(raw, y * (img.w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Box-filter downscale by an integer factor (≥1). */
export function downscale(img: Rgba, k: number): Rgba {
  if (k <= 1) return img;
  const w = Math.floor(img.w / k), h = Math.floor(img.h / k), px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let ch = 0; ch < 4; ch++) {
    let s = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += img.px[((y * k + dy) * img.w + x * k + dx) * 4 + ch];
    px[(y * w + x) * 4 + ch] = Math.round(s / (k * k));
  }
  return { w, h, px };
}

/** Images laid out left-to-right, top-to-bottom in `columns`, separated by a 4 px dark gutter. */
export function grid(images: Rgba[], columns: number): Rgba {
  const cw = Math.max(...images.map(i => i.w)), chh = Math.max(...images.map(i => i.h)), gap = 4;
  const cols = Math.max(1, Math.min(columns, images.length)), rows = Math.ceil(images.length / cols);
  const w = cols * cw + (cols - 1) * gap, h = rows * chh + (rows - 1) * gap, px = new Uint8Array(w * h * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = 20; px[i + 1] = 22; px[i + 2] = 28; px[i + 3] = 255; }
  images.forEach((img, n) => {
    const ox = (n % cols) * (cw + gap), oy = Math.floor(n / cols) * (chh + gap);
    for (let y = 0; y < img.h; y++) px.set(img.px.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((oy + y) * w + ox) * 4);
  });
  return { w, h, px };
}

/** Mean absolute RGB difference (0..255) over the common area of two images. */
export function meanDifference(a: Rgba, b: Rgba): number {
  const w = Math.min(a.w, b.w), h = Math.min(a.h, b.h);
  let s = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let ch = 0; ch < 3; ch++) s += Math.abs(a.px[(y * a.w + x) * 4 + ch] - b.px[(y * b.w + x) * 4 + ch]);
  return s / (w * h * 3);
}
