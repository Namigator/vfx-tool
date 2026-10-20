// Imports third-party flipbook sheets into the included sprite library (10-ASSETS: 4×4 flipbooks, 256 px cells,
// 1024² RGBA). Picks 16 evenly spaced frames from each source grid, fits each frame into a square cell, derives
// alpha from brightness for sheets without one (fire on black), and records license + provenance.
// Writes assets/sprites/<id>.png and assets/sprites/third-party.json; tools/bake-sprites.mjs merges that list into
// manifest.json and the generated TS table.
// Needs ffmpeg on PATH (decode TGA/PNG, encode PNG). Dev-time only.
// Usage: node tools/import-flipbooks.mjs <sourceDir>   (sourceDir holds the files named in SOURCES)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const UNITY = {
  license: 'CC0 1.0 (public domain), Unity Labs Paris "Free VFX image sequences and flipbooks" (2016)',
  url: 'https://unity.com/blog/engine-platform/free-vfx-image-sequences-flipbooks',
};
/** id → source sheet, its grid, how to read it. `alpha: "luma"` = no alpha channel, fire on black. */
const SOURCES = [
  { id: 'sim-fireball', file: 'FireBall01_8x8.tga', cols: 8, rows: 8, alpha: 'luma', blend: 'additive', src: UNITY,
    usage: 'simulated rolling fireball (Houdini), loops; ball core or dense trail puffs; play at fps or over life' },
  { id: 'sim-fireball-b', file: 'FireBall03_8x8.tga', cols: 8, rows: 8, alpha: 'luma', blend: 'additive', src: UNITY,
    usage: 'second simulated fireball loop, different silhouette; mix with sim-fireball to avoid repeats' },
  { id: 'sim-flame', file: 'Flame02_16x4.tga', cols: 16, rows: 4, alpha: 'sheet', blend: 'additive', src: UNITY,
    usage: 'simulated tall flame, base at the bottom, wispy top; torches, jets, flame tongues in a trail' },
  { id: 'sim-flame-small', file: 'Flame03_16x4.tga', cols: 16, rows: 4, alpha: 'sheet', blend: 'additive', src: UNITY,
    usage: 'simulated small flame; embers of fire, candle-sized tongues, trail licks' },
  { id: 'sim-smoke-wispy', file: 'WispySmoke01_8x8.tga', cols: 8, rows: 8, alpha: 'sheet', blend: 'normal', src: UNITY,
    usage: 'simulated wispy smoke, white; tint dark for fire smoke trails, light for steam; over life' },
  { id: 'sim-explosion', file: 'Explosion01_5x5.tga', cols: 5, rows: 5, alpha: 'sheet', blend: 'additive', src: UNITY,
    usage: 'simulated fiery explosion burst over life; impacts, fireball hits' },
];
const CELL = 256, GRID = 4, FRAMES = GRID * GRID, ATLAS = CELL * GRID;

const sourceDir = process.argv[2];
if (!sourceDir) throw new Error('usage: node tools/import-flipbooks.mjs <sourceDir>');
const outDir = 'assets/sprites';

function decode(path) {
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path]).toString().trim();
  const [w, h] = probe.split(',').map(Number);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 });
  return { w, h, px: raw };
}
const encodePng = (rgba, path) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${ATLAS}x${ATLAS}`,
  '-i', '-', '-frames:v', '1', '-pix_fmt', 'rgba', '-pred', 'none', path], { input: rgba });

/** Bilinear sample of channel c at (x, y) in source pixels. */
function sample(img, x, y, c) {
  const x0 = Math.max(0, Math.min(img.w - 1, Math.floor(x))), y0 = Math.max(0, Math.min(img.h - 1, Math.floor(y)));
  const x1 = Math.min(img.w - 1, x0 + 1), y1 = Math.min(img.h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const at = (xx, yy) => img.px[(yy * img.w + xx) * 4 + c];
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
}

const entries = [];
for (const s of SOURCES) {
  const img = decode(join(sourceDir, s.file));
  const cw = img.w / s.cols, ch = img.h / s.rows, total = s.cols * s.rows;
  const fit = CELL / Math.max(cw, ch);                       // keep aspect, fill the longer side
  const ox = (CELL - cw * fit) / 2, oy = (CELL - ch * fit) / 2;
  const out = Buffer.alloc(ATLAS * ATLAS * 4);
  let sr = 0, sg = 0, sb = 0, sa = 0;
  for (let f = 0; f < FRAMES; f++) {
    const src = Math.round(f * (total - 1) / (FRAMES - 1));
    const sx = (src % s.cols) * cw, sy = Math.floor(src / s.cols) * ch;
    const dx = (f % GRID) * CELL, dy = Math.floor(f / GRID) * CELL;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const u = (x + 0.5 - ox) / fit - 0.5, v = (y + 0.5 - oy) / fit - 0.5;
      if (u < 0 || v < 0 || u > cw - 1 || v > ch - 1) continue;   // padding stays transparent
      let r = sample(img, sx + u, sy + v, 0), g = sample(img, sx + u, sy + v, 1), b = sample(img, sx + u, sy + v, 2);
      let a = s.alpha === 'luma' ? Math.max(r, g, b) : sample(img, sx + u, sy + v, 3);
      if (s.alpha === 'luma' && a > 0) { r = r * 255 / a; g = g * 255 / a; b = b * 255 / a; }   // un-premultiply
      const o = ((dy + y) * ATLAS + dx + x) * 4;
      out[o] = Math.round(Math.min(255, r)); out[o + 1] = Math.round(Math.min(255, g)); out[o + 2] = Math.round(Math.min(255, b)); out[o + 3] = Math.round(a);
      sr += out[o] * a; sg += out[o + 1] * a; sb += out[o + 2] * a; sa += a;
    }
  }
  encodePng(out, join(outDir, `${s.id}.png`));
  const mean = [sr, sg, sb].map(v => Math.round(v / Math.max(sa, 1)));
  const hex = v => v.toString(16).padStart(2, '0').toUpperCase();
  // Coloured sheets also ship a grey variant (max channel per texel, alpha kept): exporters recolour it (recolor.ts).
  const sat = (Math.max(...mean) - Math.min(...mean)) / Math.max(Math.max(...mean), 1);
  const greyFile = sat >= 0.12 ? `${s.id}.grey.png` : undefined;
  if (greyFile) {
    const grey = Buffer.from(out);
    for (let o = 0; o < grey.length; o += 4) { const m = Math.max(grey[o], grey[o + 1], grey[o + 2]); grey[o] = grey[o + 1] = grey[o + 2] = m; }
    encodePng(grey, join(outDir, greyFile));
  }
  entries.push({ id: s.id, file: `${s.id}.png`, kind: 'flipbook', cell: [CELL, CELL], columns: GRID, rows: GRID,
    meanColor: `#${mean.map(hex).join('')}`, ...(greyFile ? { greyFile } : {}), blend: s.blend, usage: s.usage,
    provenance: { origin: 'third-party', source: s.src.url, sourceFile: s.file, sourceGrid: `${s.cols}x${s.rows}`,
      importer: 'tools/import-flipbooks.mjs', frames: `${FRAMES} evenly spaced of ${total}` },
    license: s.src.license, thumbnail: 'assets/sprites/preview.html' });
  console.log(`${s.id}: ${s.file} ${img.w}x${img.h} → ${ATLAS}² (${FRAMES}/${total} frames)`);
}
writeFileSync(join(outDir, 'third-party.json'), JSON.stringify({ importer: 'tools/import-flipbooks.mjs', sprites: entries }, null, 2) + '\n');
console.log(`wrote ${entries.length} sheets + ${outDir}/third-party.json — now run: node tools/bake-sprites.mjs`);
