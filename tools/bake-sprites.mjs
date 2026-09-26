// Bakes the procedural fire/smoke sprites (same algorithm as the standalone flamethrower
// reference) into PNG flipbook sheets + a manifest. Pure Node, no dependencies.
// Usage: node tools/bake-sprites.mjs [outDir=assets/sprites]
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'assets/sprites';
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function hash3(i, j, k) { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1440662683); h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296; }
function noise2(x, y, s) { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy); return mix(mix(hash3(i, j, s), hash3(i + 1, j, s), ux), mix(hash3(i, j + 1, s), hash3(i + 1, j + 1, s), ux), uy); }
function fbm(x, y, s) { let v = 0, a = .5, f = 1; for (let o = 0; o < 4; o++) { v += a * noise2(x * f, y * f, s + o * 17); f *= 2.03; a *= .5; } return v / .9375; }

// ---- PNG encoder (RGBA8, filter 0).
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- Flame tongues: 8 shapes (rows) x 12 frames (columns) per temperature sheet.
const SW = 40, SH = 96, FRAMES = 12, SHAPES = 8, TEMPS = [1, .72, .46, .22];
const HEAT = [[0, 40, 6, 2], [.2, 150, 25, 5], [.4, 230, 85, 12], [.6, 255, 150, 35], [.8, 255, 215, 110], [1, 255, 250, 225]];
function heatColor(h) { h = clamp(h); for (let i = 1; i < HEAT.length; i++) if (h <= HEAT[i][0]) { const a = HEAT[i - 1], b = HEAT[i], t = (h - a[0]) / (b[0] - a[0]); return [mix(a[1], b[1], t), mix(a[2], b[2], t), mix(a[3], b[3], t)]; } return HEAT.at(-1).slice(1); }
function bakeTongue(k, fi) {
  const dens = new Float32Array(SW * SH), heat = new Float32Array(SW * SH), ph = fi * .38, lean = (k % 2 ? 1 : -1) * .12;
  for (let py = 0; py < SH; py++) {
    const v = 1 - (py + .5) / SH, wp = Math.pow(Math.sin(Math.PI * Math.pow(v, .62)), 1.1) * .9 + .07 * (1 - v);
    const c = ((fbm(v * 2.2 + k * 7.1, ph * .6 + k * 3, 91 + k) - .5) * 1.2 + lean) * v;
    for (let px = 0; px < SW; px++) {
      const u = ((px + .5) / SW - .5) * 2, n = fbm(u * 1.6 + k * 3.3, v * 4.2 - ph * 1.7, 11 + k), n2 = fbm(u * 3.4 + k, v * 7.5 - ph * 2.6, 29 + k);
      const d = Math.abs(u - c) / Math.max(.03, wp);
      let de = 1 - smooth(.5, 1, d + (n - .5) * .95);
      const diss = fi / (FRAMES - 1) * .5 + Math.pow(v, 2.2) * .55;
      de *= smooth(diss - .08, diss + .22, n2 * .65 + n * .35 + .22); de *= smooth(0, .1, v);
      const i = py * SW + px; dens[i] = clamp(de); heat[i] = clamp(de * (1.25 - .75 * v - .5 * Math.min(1, d)) + (n2 - .5) * .15);
    }
  }
  return { dens, heat };
}
mkdirSync(outDir, { recursive: true });
const baked = [];
for (let k = 0; k < SHAPES; k++) for (let fi = 0; fi < FRAMES; fi++) baked.push(bakeTongue(k, fi));
const manifest = { generator: 'tools/bake-sprites.mjs', sprites: [] };
TEMPS.forEach((T, ti) => {
  const W = SW * FRAMES, H = SH * SHAPES, img = new Uint8Array(W * H * 4);
  for (let k = 0; k < SHAPES; k++) for (let fi = 0; fi < FRAMES; fi++) {
    const { dens, heat } = baked[k * FRAMES + fi];
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      const s = y * SW + x, o = ((k * SH + y) * W + fi * SW + x) * 4, [r, g, b] = heatColor(heat[s] * (.3 + .72 * T) + .1 * T - (1 - T) * .12);
      img[o] = r; img[o + 1] = g; img[o + 2] = b; img[o + 3] = 255 * clamp(dens[s] * (.55 + .45 * T));
    }
  }
  const file = `flame-tongue-t${ti}.png`;
  writeFileSync(join(outDir, file), png(W, H, img));
  manifest.sprites.push({ id: `flame-tongue-t${ti}`, file, kind: 'flipbook', cell: [SW, SH], columns: FRAMES, rows: SHAPES, temperature: T,
    layout: 'rows = shape variants, columns = frames over life (dissolve grows); tip points up (-Y), root at bottom', blend: 'normal (t0 also usable additive as emissive core)' });
});

// ---- Smoke puffs: 4 variants in one strip.
const S = 64, smoke = new Uint8Array(S * 4 * S * 4);
for (let k = 0; k < 4; k++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const u = (x + .5) / S - .5, v = (y + .5) / S - .5, r = Math.hypot(u, v) * 2;
  const de = (1 - smooth(.25, 1, r * 1.15 + (fbm(u * 3 + k * 5, v * 3, 51 + k) - .5) * .9)) * (.55 + .45 * fbm(u * 6, v * 6 + k, 71 + k));
  const o = (y * S * 4 + k * S + x) * 4, g = 46 + fbm(u * 4, v * 4, 81 + k) * 22;
  smoke[o] = g + 6; smoke[o + 1] = g; smoke[o + 2] = g - 4; smoke[o + 3] = 255 * clamp(de);
}
writeFileSync(join(outDir, 'smoke-puff.png'), png(S * 4, S, smoke));
manifest.sprites.push({ id: 'smoke-puff', file: 'smoke-puff.png', kind: 'variants', cell: [S, S], columns: 4, rows: 1, blend: 'normal' });
// ---- Generic sheet helper: fn(col,row,u,v) -> [r,g,b,a] in 0..1, u/v in 0..1 within the cell.
function sheet(id, cw, ch, cols, rows, fn, meta) {
  const W = cw * cols, H = ch * rows, img = new Uint8Array(W * H * 4);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const px = fn(c, r, (x + .5) / cw, (y + .5) / ch), o = ((r * ch + y) * W + c * cw + x) * 4;
    for (let i = 0; i < 4; i++) img[o + i] = Math.round(255 * clamp(px[i]));
  }
  writeFileSync(join(outDir, `${id}.png`), png(W, H, img));
  manifest.sprites.push({ id, file: `${id}.png`, cell: [cw, ch], columns: cols, rows, ...meta });
}
function rng(seed) { let s = seed | 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Soft glows: white, tinted by the material. Columns = tight core, medium, wide halo, hot-core ring.
const GLOW = [u => Math.exp(-u * u * 18), u => Math.exp(-u * u * 7), u => Math.pow(clamp(1 - u), 2.2), u => Math.exp(-u * u * 30) + .35 * Math.exp(-Math.pow((u - .55) / .12, 2))];
sheet('soft-glow', 64, 64, 4, 1, (c, _r, u, v) => { const d = Math.hypot(u - .5, v - .5) * 2, a = clamp(GLOW[c](d)) * (1 - smooth(.9, 1, d)); return [1, 1, 1, a]; },
  { kind: 'variants', blend: 'additive', note: 'white; tint via material. cols: tight, medium, wide, core+ring' });

// Spark streaks: vertical, head at top (-Y), tapering tail. Velocity-aligned billboards.
sheet('spark-streak', 16, 64, 4, 1, (c, _r, u, v) => {
  const head = .12 + c * .03, along = v < head ? 1 - smooth(0, head, head - v) * 1 : Math.pow(1 - (v - head) / (1 - head), 1.4 + c * .4);
  const w = .12 + .1 * along, d = Math.abs(u - .5) * 2, core = Math.exp(-Math.pow(d / w, 2)) * along, halo = Math.exp(-Math.pow(d / (w * 3), 2)) * along * .35;
  const a = clamp(core + halo); return [1, mix(.75, 1, core), mix(.45, 1, core), a];
}, { kind: 'variants', blend: 'additive', note: 'head at top; cols = increasing tail taper; warm white, retint freely' });

// Electric arcs: horizontal jagged bolts (midpoint displacement), blue-white. Each column is a new seed.
const arcs = [0, 1, 2, 3].map(k => { const r = rng(900 + k), n = 33, y = new Float32Array(n); const disp = (a, b, amp) => { if (b - a < 2) return; const m = (a + b) >> 1; y[m] = (y[a] + y[b]) / 2 + (r() - .5) * amp; disp(a, m, amp * .55); disp(m, b, amp * .55); }; y[0] = y[n - 1] = 0; disp(0, n - 1, 1.3); return y; });
sheet('electric-arc', 128, 32, 4, 1, (c, _r, u, v) => {
  const y = arcs[c], n = y.length; let d = 9;
  for (let i = 0; i < n - 1; i++) { const ax = i / (n - 1), bx = (i + 1) / (n - 1), ay = .5 + clamp(y[i] * .55, -.42, .42), by = .5 + clamp(y[i + 1] * .55, -.42, .42), dx = bx - ax, dy = (by - ay) * .25, t = clamp(((u - ax) * dx + (v - ay) * .25 * dy) / (dx * dx + dy * dy)); d = Math.min(d, Math.hypot(u - (ax + dx * t), (v - ay) * .25 - dy * t)); }
  const end = smooth(0, .06, u) * smooth(0, .06, 1 - u), core = Math.exp(-Math.pow(d / .006, 2)), glow = Math.exp(-Math.pow(d / .03, 2)) * .45;
  return [mix(.45, 1, core), mix(.75, 1, core), 1, clamp(core + glow) * end];
}, { kind: 'variants', blend: 'additive', note: 'endpoints at left/right edge centres; use as stretched quad or ribbon texture' });

// Tileable dissolve / erosion noise (grayscale in RGB, alpha 1). Periodic hash so it wraps seamlessly.
function pnoise(x, y, p, s) { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), m = q => ((q % p) + p) % p;
  return mix(mix(hash3(m(i), m(j), s), hash3(m(i + 1), m(j), s), ux), mix(hash3(m(i), m(j + 1), s), hash3(m(i + 1), m(j + 1), s), ux), uy); }
sheet('dissolve-noise', 128, 128, 1, 1, (_c, _r, u, v) => { let n = 0, a = .5, p = 4; for (let o = 0; o < 5; o++) { n += a * pnoise(u * p, v * p, p, 300 + o); p *= 2; a *= .5; } n /= .96875; return [n, n, n, 1]; },
  { kind: 'texture', blend: 'n/a', note: 'tileable; for dissolve/erosion thresholds and UV distortion' });

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${manifest.sprites.length} sheets to ${outDir}`);
