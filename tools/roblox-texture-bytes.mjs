// PNG bytes for a Roblox texture key (src/export/roblox/fromPlan.ts beamTexture):
//   "sheet.png"            the library sheet as is (assets/sprites)
//   "sheet.png#2"          one cell of a multi-cell sheet
//   "sheet.png#line"       the sheet's line straightened: per column the line's centre (alpha-weighted), every texel
//                          binned by its offset from it, averaged over all cells -> a cross-section strip
//   "@beam-soft-100.png"   a beam cross-section: white, alpha falling to 0 over the outer 100 % of the half-width
//                          (RibbonGeometry ribbonSoftness: additive 1, normal 0.25)
// A Roblox Beam runs the image's Y axis ALONG the beam and X ACROSS it (Studio 2026-10-17: cross-sections drawn down y
// showed as bars across the beam, and the electric-arc atlas as a comb of vertical squiggles), so the generated
// cross-sections vary along x and are uniform along y.
// Library sheets are RGBA8 PNGs written by tools/bake-sprites.mjs; the decoder handles all five row filters anyway.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }

export function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export function decodePng(buf) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (buf[24] !== 8 || buf[25] !== 6) throw new Error('only RGBA8 PNGs');
  const idat = [];
  for (let o = 8; o < buf.length;) { const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8); if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat)), px = new Uint8Array(w * h * 4), stride = w * 4;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[o + x - 4] : 0, b = y ? px[o - stride + x] : 0, c = x >= 4 && y ? px[o - stride + x - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      px[o + x] = (row[x] + pred) & 255;
    }
  }
  return { w, h, px };
}

function softBeam(pct) {
  const s = Math.min(1, Math.max(0.01, pct / 100)), W = 128, H = 8, px = new Uint8Array(W * H * 4);
  for (let x = 0; x < W; x++) {
    const d = Math.abs(((x + 0.5) / W) * 2 - 1), t = Math.min(1, Math.max(0, (d - (1 - s)) / s)), a = 1 - t * t * (3 - 2 * t);
    for (let y = 0; y < H; y++) px.set([255, 255, 255, Math.round(a * 255)], (y * W + x) * 4);
  }
  return encodePng(W, H, px);
}

function straightLine({ w, px }, sheet) {
  const [cw, ch] = sheet.cell, acc = new Float64Array(ch * 4);
  let cols = 0;
  for (let cell = 0; cell < sheet.columns * sheet.rows; cell++) {
    const cx = (cell % sheet.columns) * cw, cy = Math.floor(cell / sheet.columns) * ch;
    for (let x = 0; x < cw; x++) {
      let sw = 0, sy = 0;
      for (let y = 0; y < ch; y++) { const a = px[((cy + y) * w + cx + x) * 4 + 3]; sw += a; sy += a * y; }
      if (sw < 255 * 2) continue; // empty padding column
      const centre = sy / sw;
      cols++;
      for (let y = 0; y < ch; y++) {
        const o = ((cy + y) * w + cx + x) * 4, a = px[o + 3] / 255, bin = Math.round(y - centre + ch / 2);
        if (bin < 0 || bin >= ch) continue;
        acc[bin * 4] += px[o] * a; acc[bin * 4 + 1] += px[o + 1] * a; acc[bin * 4 + 2] += px[o + 2] * a; acc[bin * 4 + 3] += a;
      }
    }
  }
  const H = 8, out = new Uint8Array(ch * H * 4);
  for (let x = 0; x < ch; x++) {
    const a = acc[x * 4 + 3], rgb = [0, 1, 2].map(k => (a > 0 ? Math.round(acc[x * 4 + k] / a) : 0));
    for (let y = 0; y < H; y++) out.set([...rgb, Math.round(Math.min(1, a / Math.max(1, cols)) * 255)], (y * ch + x) * 4);
  }
  return encodePng(ch, H, out);
}

/** PNG bytes for `key`, or undefined when its sheet is missing. `root` = the repository. */
export function textureBytes(root, key) {
  const soft = /^@beam-soft-(\d+)\.png$/.exec(key);
  if (soft) return softBeam(Number(soft[1]));
  const [file, cellText] = key.split('#');
  const path = join(root, 'assets', 'sprites', file);
  if (!existsSync(path)) return undefined;
  const bytes = readFileSync(path);
  if (cellText === undefined) return bytes;
  const manifest = JSON.parse(readFileSync(join(root, 'assets', 'sprites', 'manifest.json'), 'utf8'));
  const sheet = manifest.sprites.find(s => s.file === file || s.greyFile === file);
  if (!sheet) throw new Error(`${file}: not in assets/sprites/manifest.json`);
  if (cellText === 'line') return straightLine(decodePng(bytes), sheet);
  const { w, px } = decodePng(bytes), [cw, ch] = sheet.cell, cell = Number(cellText);
  const cx = (cell % sheet.columns) * cw, cy = Math.floor(cell / sheet.columns) * ch, out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) out.set(px.subarray(((cy + y) * w + cx) * 4, ((cy + y) * w + cx + cw) * 4), y * cw * 4);
  return encodePng(cw, ch, out);
}
