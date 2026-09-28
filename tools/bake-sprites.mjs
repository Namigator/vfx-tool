// Bakes the included procedural sprite library (10-ASSETS "Included library"): 4×4 flipbooks with
// 256 px cells (1024² RGBA atlases, frames left-to-right, top-to-bottom) and 2×2 mask/variant sets
// (512²). Deterministic, no dependencies. Writes PNGs + manifest.json into outDir and, for the default
// outDir, src/assets/builtinSprites.generated.ts (the compiler's typed copy of the manifest).
// Usage: node tools/bake-sprites.mjs [outDir=assets/sprites]
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'assets/sprites';
const writeTs = process.argv[2] === undefined;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function hash3(i, j, k) { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1440662683); h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296; }
function noise2(x, y, s) { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy); return mix(mix(hash3(i, j, s), hash3(i + 1, j, s), ux), mix(hash3(i, j + 1, s), hash3(i + 1, j + 1, s), ux), uy); }
function fbm(x, y, s) { let v = 0, a = .5, f = 1; for (let o = 0; o < 4; o++) { v += a * noise2(x * f, y * f, s + o * 17); f *= 2.03; a *= .5; } return v / .9375; }
function rng(seed) { let s = seed | 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---- PNG encoder (RGBA8, filter 0).
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const CELL = 256, PAD = 6;
const manifest = { generator: 'tools/bake-sprites.mjs', sprites: [] };
/**
 * fn(index, u, v) -> [r,g,b,a] in 0..1 where u,v in [0,1] cover the cell minus padding (v=0 top).
 * Colour is written as 0 where alpha is 0 so filtering never bleeds stray colour into edges.
 */
function sheet(id, cols, rows, kind, fn, meta) {
  mkdirSync(outDir, { recursive: true });
  const W = CELL * cols, H = CELL * rows, img = new Uint8Array(W * H * 4), inner = CELL - 2 * PAD;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const index = r * cols + c;
    for (let y = PAD; y < CELL - PAD; y++) for (let x = PAD; x < CELL - PAD; x++) {
      const px = fn(index, (x - PAD + .5) / inner, (y - PAD + .5) / inner), o = ((r * CELL + y) * W + c * CELL + x) * 4, a = clamp(px[3]);
      if (a <= 0) continue;
      img[o] = Math.round(255 * clamp(px[0])); img[o + 1] = Math.round(255 * clamp(px[1])); img[o + 2] = Math.round(255 * clamp(px[2])); img[o + 3] = Math.round(255 * a);
    }
  }
  writeFileSync(join(outDir, `${id}.png`), png(W, H, img));
  manifest.sprites.push({ id, file: `${id}.png`, kind, cell: [CELL, CELL], columns: cols, rows, ...meta });
}

// ---- Flame tongue flipbooks: asymmetric tongue, narrow root, tapering tip, dissolve grows over 16 frames.
const HEAT = [[0, 40, 6, 2], [.2, 150, 25, 5], [.4, 230, 85, 12], [.6, 255, 150, 35], [.8, 255, 215, 110], [1, 255, 250, 225]];
function heatColor(h) { h = clamp(h); for (let i = 1; i < HEAT.length; i++) if (h <= HEAT[i][0]) { const a = HEAT[i - 1], b = HEAT[i], t = (h - a[0]) / (b[0] - a[0]); return [mix(a[1], b[1], t) / 255, mix(a[2], b[2], t) / 255, mix(a[3], b[3], t) / 255]; } return [1, .98, .88]; }
function flame(k) {
  const lean = k ? .12 : -.12;
  return (fi, x, y) => {
    const u = (x - .5) / .23, v = 1 - y;
    if (Math.abs(u) > 1.6) return [0, 0, 0, 0];
    const ph = fi * .29, wp = Math.pow(Math.sin(Math.PI * Math.pow(v, .62)), 1.1) * .9 + .07 * (1 - v);
    const c = ((fbm(v * 2.2 + k * 7.1, ph * .6 + k * 3, 91 + k) - .5) * 1.2 + lean) * v;
    const n = fbm(u * 1.6 + k * 3.3, v * 4.2 - ph * 1.7, 11 + k), n2 = fbm(u * 3.4 + k, v * 7.5 - ph * 2.6, 29 + k);
    const d = Math.abs(u - c) / Math.max(.03, wp);
    let de = 1 - smooth(.5, 1, d + (n - .5) * .95);
    const diss = fi / 15 * .5 + Math.pow(v, 2.2) * .55;
    de *= smooth(diss - .08, diss + .22, n2 * .65 + n * .35 + .22) * smooth(0, .08, v);
    const heat = clamp(de * (1.25 - .75 * v - .5 * Math.min(1, d)) + (n2 - .5) * .15);
    const [r, g, b] = heatColor(heat * .92 + .06);
    return [r, g, b, de * .95];
  };
}
sheet('flame-tongue-a', 4, 4, 'flipbook', flame(0), { blend: 'normal', usage: 'flame tongue, leans left; tip up (+V); play over life', tint: 'hot palette baked in; darken/redden with colour over life' });
sheet('flame-tongue-b', 4, 4, 'flipbook', flame(1), { blend: 'normal', usage: 'flame tongue, leans right, different silhouette', tint: 'hot palette baked in' });

// ---- Fire puff flipbook (A-05 gap: decaying flame read as leaf/petal shapes): a lumpy, billowing fire blob
// with a hot core and ragged cooler edges that expands, cools white-yellow → orange → deep red and tears into
// wisps over 16 frames. Premultiplied-friendly: colour fades with density.
sheet('fire-puff', 4, 4, 'flipbook', (fi, x, y) => {
  const f = fi / 15, u = x - .5, v = y - .5;
  const r = Math.hypot(u, v) * 2 / mix(.5, .92, Math.sqrt(f));
  const n = fbm(u * 3.2 + f * 1.1, v * 3.2 - f * 1.6, 131), n2 = fbm(u * 7.5 - f, v * 7.5 - f * 2.2, 151), n3 = fbm(u * 14, v * 14 - f * 3, 171);
  const body = 1 - smooth(.05, 1, r + (n - .5) * 1.1 + (n2 - .5) * .35);
  const tear = smooth(f * .8 - .25, f * .8 + .35, n2 * .7 + n3 * .3);
  const de = clamp(body * tear * (.55 + .45 * n3) * 1.25) * (1 - smooth(.7, 1, f) * .5);
  const heat = clamp((1 - r * .8) * (1.1 - f * .75) + (n2 - .5) * .45 + (n3 - .5) * .15);
  const [cr, cg, cb] = heatColor(heat * .95 + .05);
  return [cr, cg, cb, de];
}, { blend: 'normal', usage: 'billowing fire blob that cools and tears apart over life: flame body, fire decay, fireball puffs; play over life, additive or normal', tint: 'hot palette baked in' });

// ---- Smoke evolution flipbook: soft lumpy puff that expands, thins and breaks up.
sheet('smoke-puff', 4, 4, 'flipbook', (fi, x, y) => {
  const f = fi / 15, u = x - .5, v = y - .5, r = Math.hypot(u, v) * 2 / mix(.55, .95, Math.sqrt(f));
  const n = fbm(u * 3 + f * .8, v * 3 - f * .6, 51), n2 = fbm(u * 7, v * 7 + f, 71);
  const de = (1 - smooth(.3, 1, r + (n - .5) * .9)) * (.45 + .55 * n2) * (1 - smooth(.55, 1, f) * smooth(f * .9, f * .9 + .3, 1 - n2));
  const g = .72 + .28 * n;
  return [g, g, g * .98, clamp(de)];
}, { blend: 'normal', usage: 'smoke/dust puff evolving over 16 frames; tint grey/brown with colour over life' });

// ---- Foam/splash flipbook: Worley bubble borders in a noisy blob; holes open over time.
{
  const pts = []; const R = rng(70); for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) pts.push([(i + R()) / 9, (j + R()) / 9]);
  sheet('foam', 4, 4, 'flipbook', (fi, x, y) => {
    let f1 = 9, f2 = 9; for (const p of pts) { const d = Math.hypot(x - p[0], y - p[1]); if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d; }
    const edge = 1 - smooth(0, .025, f2 - f1), rr = Math.hypot(x - .5, y - .5) * 2, m = 1 - smooth(.35, .95, rr * 1.1 + (fbm(x * 3, y * 3, 31) - .5) * .9);
    const th = fi / 15 * .6, holes = smooth(th, th + .12, fbm(x * 5, y * 5, 41) + .12);
    return [.93, .97, .99, m * holes * (edge * .85 + .16)];
  }, { blend: 'normal', usage: 'foam/splash surface; ground-oriented cards or billboards' });
}

// ---- 2×2 mask/variant sets (white unless noted; tint with the material).
const GLOW = [u => Math.exp(-u * u * 18), u => Math.exp(-u * u * 7), u => Math.pow(clamp(1 - u), 2.2), u => Math.exp(-u * u * 30) + .35 * Math.exp(-Math.pow((u - .55) / .12, 2))];
sheet('soft-glow', 2, 2, 'variants', (i, x, y) => { const d = Math.hypot(x - .5, y - .5) * 2; return [1, 1, 1, clamp(GLOW[i](d)) * (1 - smooth(.9, 1, d))]; },
  { blend: 'additive', usage: 'radial core/halo masks: tight, medium, wide, core+ring' });
sheet('spark-streak', 2, 2, 'variants', (i, x, y) => {
  const u = (x - .5) / .06, head = .1 + i * .03, along = y < head ? smooth(0, head, y) : Math.pow(1 - (y - head) / (1 - head), 1.4 + i * .4);
  const w = .5 + .4 * along, core = Math.exp(-Math.pow(u / w, 2)) * along, halo = Math.exp(-Math.pow(u / (w * 3), 2)) * along * .35;
  return [1, mix(.8, 1, core), mix(.55, 1, core), clamp(core + halo)];
}, { blend: 'additive', usage: 'spark streak, head at top (-V); use velocity alignment + stretch' });
{
  const arcs = [0, 1, 2, 3].map(k => { const r = rng(900 + k), n = 33, y = new Float32Array(n); const disp = (a, b, amp) => { if (b - a < 2) return; const m = (a + b) >> 1; y[m] = (y[a] + y[b]) / 2 + (r() - .5) * amp; disp(a, m, amp * .55); disp(m, b, amp * .55); }; disp(0, n - 1, 1.3); return y; });
  sheet('electric-arc', 2, 2, 'variants', (i, x, y) => {
    const ys = arcs[i], n = ys.length; let d = 9;
    for (let s = 0; s < n - 1; s++) { const ax = s / (n - 1), bx = (s + 1) / (n - 1), ay = .5 + clamp(ys[s] * .35, -.4, .4), by = .5 + clamp(ys[s + 1] * .35, -.4, .4), dx = bx - ax, dy = by - ay, t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)); d = Math.min(d, Math.hypot(x - (ax + dx * t), y - (ay + dy * t))); }
    const core = Math.exp(-Math.pow(d / .006, 2)), glow = Math.exp(-Math.pow(d / .03, 2)) * .45, end = smooth(0, .05, x) * smooth(0, .05, 1 - x);
    return [mix(.45, 1, core), mix(.75, 1, core), 1, clamp(core + glow) * end];
  }, { blend: 'additive', usage: 'electric arc strip, endpoints at left/right edge centres' });
}
sheet('droplet', 2, 2, 'variants', (i, x, y) => {
  const u = (x - .5) * 2.2, v = (y - .5) * 2.2, r = Math.hypot(u, v), R = .86 + (fbm(u * 2 + i * 3, v * 2, 5 + i) - .5) * .14, inside = 1 - smooth(R - .06, R, r), fr = Math.pow(smooth(.15, 1, r / R), 1.5);
  const sp = Math.exp(-((u + .33) ** 2 + (v + .38) ** 2) / .018), ca = Math.exp(-((u - .28) ** 2 + (v - .42) ** 2) / .05) * .7, sh = clamp((v + 1) / 2 * .8 + fr * .3);
  return [mix(.75, .27, sh) + sp * .25 + ca * .2, mix(.9, .47, sh) + sp * .1 + ca * .1, mix(.95, .59, sh) + sp * .05 + ca * .05, inside * Math.max(mix(.18, .7, fr), sp, ca * .8)];
}, { blend: 'normal', usage: 'water droplet with fresnel rim, glint and caustic; stretch along velocity for motion blur' });
sheet('ripple-ring', 2, 2, 'variants', (i, x, y) => {
  const u = x * 2 - 1, v = y * 2 - 1, r = Math.hypot(u, v), a = Math.atan2(v, u), brk = smooth(.35, .6, noise2(Math.cos(a) * 3 + i * 7, Math.sin(a) * 3, 90 + i));
  return [.9, .96, 1, (Math.exp(-(((r - .85) / .03) ** 2)) + .4 * Math.exp(-(((r - .62) / .02) ** 2))) * brk];
}, { blend: 'normal', usage: 'thin broken ripple ring mask for ground/water rings' });
function pnoise(x, y, p, s) { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), m = q => ((q % p) + p) % p;
  return mix(mix(hash3(m(i), m(j), s), hash3(m(i + 1), m(j), s), ux), mix(hash3(m(i), m(j + 1), s), hash3(m(i + 1), m(j + 1), s), ux), uy); }
{
  // Tileable noise ignores the padding convention: it must wrap, so it fills the whole 256² cell.
  const S = CELL, img = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let n = 0, a = .5, p = 4; for (let o = 0; o < 5; o++) { n += a * pnoise((x + .5) / S * p, (y + .5) / S * p, p, 300 + o); p *= 2; a *= .5; } const g = Math.round(255 * n / .96875), q = (y * S + x) * 4; img[q] = img[q + 1] = img[q + 2] = g; img[q + 3] = 255; }
  writeFileSync(join(outDir, 'dissolve-noise.png'), png(S, S, img));
  manifest.sprites.push({ id: 'dissolve-noise', file: 'dissolve-noise.png', kind: 'texture', cell: [S, S], columns: 1, rows: 1, blend: 'n/a', usage: 'tileable noise for dissolve/erosion and UV distortion' });
}

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
if (writeTs) {
  const rows = manifest.sprites.map(s => `  { id: ${JSON.stringify(s.id)}, file: ${JSON.stringify(s.file)}, kind: ${JSON.stringify(s.kind)}, cell: [${s.cell}], columns: ${s.columns}, rows: ${s.rows}, blend: ${JSON.stringify(s.blend)} },`);
  writeFileSync('src/assets/builtinSprites.generated.ts', `// GENERATED by tools/bake-sprites.mjs — do not edit. Typed copy of assets/sprites/manifest.json.\nimport type { SpriteSheet } from './spriteLibrary.ts';\n\nexport const BUILTIN_SPRITES: readonly SpriteSheet[] = [\n${rows.join('\n')}\n];\n`);
}
console.log(`wrote ${manifest.sprites.length} sheets to ${outDir}`);
