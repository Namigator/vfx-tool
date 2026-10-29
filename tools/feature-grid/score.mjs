#!/usr/bin/env node
// Feature grid stage 3: scores every engine render against the editor render, feature by feature, and writes the grid
// (work/feature-grid/grid.json, grid.md, grid.html and grid.png). Engines = the folders next to tool/ that hold
// <id>.png renders (unity/ today; godot/, unreal/, roblox/ when their render stage exists).
//   node tools/feature-grid/score.mjs
// Each picture minus its own empty-stage plate (case "empty") = the light the effect adds. Compared at 96x54:
//   shape  = overlap (IoU) of the lit areas, each grown by 2 px so small offsets and different random spawns count
//   bright = engine added light / tool added light (tool rendered without glow, as engines may have no bloom)
//   colour = distance between the mean added chroma (r,g,b / sum) of the lit pixels
//   tilt   = (vertical / horizontal spread of the lit pixels) engine vs tool, as a factor >= 1: catches flat vs upright
//            (world-axis sprites drawn facing the camera scored OK on shape alone)
// Fine texture differences (a ring vs a dot of the same size) slip through at this resolution: tools/feature-grid/eye.json
// holds what someone saw for a row (engine -> id -> { eye: 'OK' | 'WRONG', note, date }) and the grid shows it beside the score.
// Verdicts: OK, CHECK (some metric off; look at it), MISSING (engine adds < 15% of the tool's lit area), UNSUPPORTED
// (the exporter reports the feature dropped), NO REF (the editor shows nothing either). The score is a filter that
// says where to look; a row is only trusted after someone looked at it.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { CASES, DEFAULT_TICK } from './cases.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const G = join(ROOT, 'work/feature-grid');
const W = 96, H = 54, LIT = 0.04, GROW = 2;
export const LIMITS = { shape: 0.45, brightLo: 0.4, brightHi: 2.5, colour: 0.12, missing: 0.15, tilt: 1.3 };

const raw = file => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${W}:${H}:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 1 << 24 });
  if (r.status !== 0 || r.stdout.length !== W * H * 3) throw new Error(`cannot read ${file}`);
  return r.stdout;
};
/** Added light of `img` over `plate`: per pixel rgb (0..1) and luma. */
function added(img, plate) {
  const rgb = new Float32Array(W * H * 3), luma = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    for (let k = 0; k < 3; k++) rgb[i * 3 + k] = Math.max(0, (img[i * 3 + k] - plate[i * 3 + k]) / 255);
    luma[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
  }
  return { rgb, luma };
}
const grow = m => { const o = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) for (let dy = -GROW; dy <= GROW; dy++) for (let dx = -GROW; dx <= GROW; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H) o[Y * W + X] = 1; } return o; };
function stats(a) {
  const mask = new Uint8Array(W * H); let area = 0, sum = 0, mx = 0, my = 0, mxx = 0, myy = 0; const c = [0, 0, 0];
  for (let i = 0; i < W * H; i++) {
    sum += a.luma[i];
    if (a.luma[i] > LIT) { mask[i] = 1; area++; const x = i % W, y = (i / W) | 0; mx += x; my += y; mxx += x * x; myy += y * y; for (let k = 0; k < 3; k++) c[k] += a.rgb[i * 3 + k]; }
  }
  const cs = c[0] + c[1] + c[2], n = Math.max(1, area);
  const sx = Math.sqrt(Math.max(0, mxx / n - (mx / n) ** 2)) + 0.5, sy = Math.sqrt(Math.max(0, myy / n - (my / n) ** 2)) + 0.5;
  return { mask, area: area / (W * H), sum, aspect: sy / sx, chroma: cs > 0 ? c.map(v => v / cs) : [1 / 3, 1 / 3, 1 / 3] };
}
export function compare(tool, eng) {
  const gt = grow(tool.mask), ge = grow(eng.mask);
  let inter = 0, union = 0;
  for (let i = 0; i < W * H; i++) { if (gt[i] && ge[i]) inter++; if (gt[i] || ge[i]) union++; }
  const t = eng.aspect / tool.aspect;
  return { tilt: Math.max(t, 1 / t), shape: union ? inter / union : 1, bright: tool.sum > 0 ? eng.sum / tool.sum : 0, colour: Math.hypot(...tool.chroma.map((v, k) => v - eng.chroma[k])), area: tool.area > 0 ? eng.area / tool.area : 0 };
}
export function verdict(m, toolArea, dropped, approximated = []) {
  if (dropped.length) return { v: 'UNSUPPORTED', why: dropped.join('; ') };
  if (toolArea < 0.001) return { v: 'NO REF', why: 'the editor render adds no light at this tick' };
  if (m.area < LIMITS.missing) return { v: 'MISSING', why: [`engine lights ${(m.area * 100).toFixed(0)}% of the tool's area`, ...approximated].join('; ') };
  const why = [];
  if (m.shape < LIMITS.shape) why.push(`shape ${m.shape.toFixed(2)}`);
  if (m.bright < LIMITS.brightLo) why.push(`dimmer x${m.bright.toFixed(2)}`);
  if (m.bright > LIMITS.brightHi) why.push(`brighter x${m.bright.toFixed(2)}`);
  if (m.colour > LIMITS.colour) why.push(`colour off ${m.colour.toFixed(2)}`);
  if (m.tilt > LIMITS.tilt) why.push(`tilt x${m.tilt.toFixed(1)}`);
  if (why.length && approximated.length) why.push(...approximated);
  return why.length ? { v: 'CHECK', why: why.join(', ') } : { v: 'OK', why: '' };
}

if (import.meta.main) {
  const engines = readdirSync(G, { withFileTypes: true }).filter(d => d.isDirectory() && existsSync(join(G, d.name, 'empty.png')) && d.name !== 'tool').map(d => d.name);
  const toolPlate = raw(join(G, 'tool', 'empty-noglow.png'));
  const eyeFile = join(ROOT, 'tools/feature-grid/eye.json'), eye = existsSync(eyeFile) ? JSON.parse(readFileSync(eyeFile, 'utf8')) : {};
  const rows = [];
  for (const c of CASES) {
    if (c.id === 'empty') continue;
    const tp = join(G, 'tool', `${c.id}-noglow.png`);
    const row = { id: c.id, feature: c.feature, tick: c.tick ?? DEFAULT_TICK, covers: c.covers, engines: {} };
    const tool = existsSync(tp) ? stats(added(raw(tp), toolPlate)) : null;
    for (const e of engines) {
      const ep = join(G, e, `${c.id}.png`);
      const rep = join(G, `${e}-pkg`, c.id, 'report.json');
      const report = existsSync(rep) ? JSON.parse(readFileSync(rep, 'utf8')) : {};
      const dropped = (report.report ?? []).filter(x => x.level === 'dropped').map(x => `${x.item}: ${x.message}`);
      const approximated = (report.report ?? []).filter(x => x.level === 'approximated').map(x => `exporter: ${x.message}`);
      // Roblox: textures never uploaded have no asset id, so Studio draws its default sprite (not an exporter fault).
      if (report.missingAssetIds?.length) approximated.unshift(`no Roblox asset id for ${report.missingAssetIds.join(', ')} (upload: tools/roblox-upload-textures.mjs)`);
      if (report.exportError) { row.engines[e] = { v: 'EXPORT FAIL', why: report.exportError }; continue; }
      if (!tool || !existsSync(ep)) { row.engines[e] = { v: 'NOT RUN', why: !tool ? 'no tool render' : 'no engine render' }; continue; }
      const m = compare(tool, stats(added(raw(ep), raw(join(G, e, 'empty.png')))));
      row.engines[e] = { ...verdict(m, tool.area, dropped, approximated), ...(eye[e]?.[c.id] ?? {}), m: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +v.toFixed(2)])) };
    }
    rows.push(row);
  }
  writeFileSync(join(G, 'grid.json'), JSON.stringify({ engines, limits: LIMITS, rows }, null, 1));
  const md = [`# Feature grid (${new Date().toISOString().slice(0, 10)})`, '', `| feature | ${engines.join(' | ')} |`, `|---|${engines.map(() => '---').join('|')}|`,
    ...rows.map(r => `| ${r.id}: ${r.feature} | ${engines.map(e => { const x = r.engines[e]; return `${x.v}${x.why ? ' (' + x.why.replace(/\|/g, '/') + ')' : ''}${x.eye ? ' · eye ' + x.eye + (x.note ? ': ' + x.note : '') + ' ' + x.date : ' · eye: not looked'}`; }).join(' | ')} |`)];
  writeFileSync(join(G, 'grid.md'), md.join('\n') + '\n');
  const colour = { OK: '#2e7d32', CHECK: '#b26a00', MISSING: '#c62828', UNSUPPORTED: '#6a1b9a', 'NO REF': '#555', 'NOT RUN': '#555', 'EXPORT FAIL': '#c62828' };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<!doctype html><meta charset="utf-8"><title>Feature grid</title><style>body{background:#111;color:#ddd;font:13px system-ui;margin:12px}td{vertical-align:top;padding:4px}img{width:320px;height:180px;display:block}.v{color:#fff;padding:2px 6px;border-radius:3px;font-weight:600}h3{margin:0 0 4px}</style>
<table><tr><th>feature</th><th>tool (no glow)</th>${engines.map(e => `<th>${e}</th>`).join('')}</tr>
${rows.map(r => `<tr><td style="width:230px"><h3>${esc(r.id)}</h3>${esc(r.feature)}<br><small>t${r.tick} · ${esc(r.covers.join(', '))}</small></td><td><img src="tool/${r.id}-noglow.png"></td>${engines.map(e => { const x = r.engines[e]; return `<td><img src="${e}/${r.id}.png"><span class="v" style="background:${colour[x.v]}">${x.v}</span> <small>${esc(x.why)}${x.m ? ` · shape ${x.m.shape} bright ${x.m.bright} colour ${x.m.colour} tilt ${x.m.tilt}` : ''}<br><b>${esc(x.eye ? 'eye ' + x.eye + (x.note ? ' - ' + x.note : '') + ' ' + x.date : 'eye: not looked')}</b></small></td>`; }).join('')}</tr>`).join('\n')}
</table>`;
  writeFileSync(join(G, 'grid.html'), html);
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
  if (chrome) spawnSync(chrome, ['--headless=new', '--hide-scrollbars', '--allow-file-access-from-files', `--window-size=${560 + 330 * engines.length},${rows.length * 196 + 40}`, `--screenshot=${join(G, 'grid.png')}`, 'file:///' + join(G, 'grid.html').replace(/\\/g, '/')], { timeout: 60_000 });
  const count = {};
  for (const r of rows) for (const e of engines) { const k = `${e} ${r.engines[e].v}`; count[k] = (count[k] ?? 0) + 1; }
  console.log(Object.entries(count).map(([k, v]) => `${k}: ${v}`).join('\n'));
  console.log(`grid: ${join(G, 'grid.png')} / grid.md`);
}
