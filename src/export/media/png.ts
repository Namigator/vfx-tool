// Minimal PNG writer for straight-alpha RGBA8 (8-bit, colour type 6). Pure (fflate only), so it runs in the browser,
// in Node and in the tests, and keeps exact colour where a canvas round trip would premultiply it.
import { zlibSync } from 'fflate';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** Encodes straight RGBA8 pixels (row 0 = top). `level` is the zlib level (default 6). */
export function encodePngRgba(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error(`encodePngRgba: expected ${width * height * 4} bytes, got ${rgba.length}.`);
  const stride = width * 4, raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1);
    raw[o] = 0; // filter: none
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), o + 1);
  }
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Box-filter downscale of RGBA8 (premultiplied-correct) to fit `maxSide`; returns the input when it already fits. */
export function downscaleRgba(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, maxSide: number): { data: Uint8ClampedArray; width: number; height: number } {
  const k = Math.max(1, Math.ceil(Math.max(width, height) / maxSide));
  if (k === 1) return { data: new Uint8ClampedArray(rgba), width, height };
  const w = Math.floor(width / k), h = Math.floor(height / k), out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
      const i = ((y * k + dy) * width + x * k + dx) * 4, al = rgba[i + 3];
      r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al; a += al;
    }
    const o = (y * w + x) * 4;
    if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
    out[o + 3] = a / (k * k);
  }
  return { data: out, width: w, height: h };
}
