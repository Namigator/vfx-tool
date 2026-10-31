#!/usr/bin/env node
// T17 pixel assertion for the billboard dissolve (09): renders mcp/examples/dissolve.steps.json twice, as authored
// (dissolve 1, orange edge) and with dissolve 0, at ticks 10 / 50 / 75 of a 96-tick particle life, and asserts:
//   before dissolveStart (tick 10) both frames cover about the same area; late (tick 75) the dissolved one is mostly
//   gone; mid-burn (tick 50) the dissolved one has a band of edge-colour pixels the plain one lacks.
// Needs the dev server (renders through the MCP's headless preview). Run: node tools/dissolve-pixels.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const steps = JSON.parse(readFileSync('mcp/examples/dissolve.steps.json', 'utf8'));
const plain = JSON.parse(JSON.stringify(steps).replaceAll('"burn"', '"burn-plain"').replace('"dissolve":1,', '"dissolve":0,'));
if (!JSON.stringify(plain).includes('"dissolve":0,')) throw new Error('could not switch the dissolve off');
writeFileSync('work/dissolve-plain.steps.json', JSON.stringify(plain));
const run = file => {
  const out = spawnSync(process.execPath, ['mcp/run-steps.mjs', file], { encoding: 'utf8', timeout: 300_000 }).stdout ?? '';
  const lit = Object.fromEntries([...out.matchAll(/tick (\d+): lit ([\d.]+)% of frame/g)].map(m => [m[1], Number(m[2])]));
  const pngs = Object.fromEntries([...out.matchAll(/([A-Z]:[^,\n]*?-t(\d+)\.png)/g)].map(m => [m[2], m[1].trim()]));
  return { lit, pngs };
};
// Pixels near the edge colour #FF8A20 (warm orange): red high, green mid, blue low.
const orange = png => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
  const b = r.stdout; let n = 0;
  for (let i = 0; i < b.length; i += 3) if (b[i] > 180 && b[i + 1] > 70 && b[i + 1] < 190 && b[i + 2] < 110 && b[i] - b[i + 2] > 110) n++;
  return n;
};
const A = run('mcp/examples/dissolve.steps.json'), B = run('work/dissolve-plain.steps.json');
const checks = [
  ['before dissolveStart the frames match (tick 10, lit within 25%)', Math.abs(A.lit[10] - B.lit[10]) <= 0.25 * B.lit[10], `dissolve ${A.lit[10]}% vs plain ${B.lit[10]}%`],
  ['late in life the dissolved particles are mostly gone (tick 75, <= 30% of plain)', A.lit[75] <= 0.3 * B.lit[75], `dissolve ${A.lit[75]}% vs plain ${B.lit[75]}%`],
  ['mid-burn the edge colour band shows (tick 50, orange px > 3x plain and > 50)', (() => { const a = orange(A.pngs[50]), b = orange(B.pngs[50]); return [a > 3 * b && a > 50, `${a} vs ${b} orange px`]; })()],
].map(([name, ok, detail]) => Array.isArray(ok) ? [name, ...ok] : [name, ok, detail]);
let bad = 0;
for (const [name, ok, detail] of checks) { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  [${detail}]`); }
console.log(bad ? 'DISSOLVE PIXELS FAILED' : 'DISSOLVE PIXELS OK');
process.exit(bad ? 1 : 0);
