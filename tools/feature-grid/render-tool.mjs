#!/usr/bin/env node
// Feature grid stage 2 (reference): renders every case document in the editor (capture.html, headless Chrome) with the
// shared grid camera at the case tick -> work/feature-grid/tool/<id>.png (glow on, what the user sees) and
// <id>-noglow.png (glow off, what the scorer compares against engines without bloom).
//   node --experimental-strip-types tools/feature-grid/render-tool.mjs [id-filter]     needs the dev server (npm run dev)
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { captureRun } from '../captureStatus.node.ts';
import { CAMERA, CASES, DEFAULT_TICK } from './cases.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const editor = process.env.VFX_EDITOR ?? 'http://127.0.0.1:5174';
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
const out = join(ROOT, 'work/feature-grid/tool');
mkdirSync(out, { recursive: true });
const only = process.argv[2];
let bad = 0;
for (const c of CASES) {
  if (only && !c.id.includes(only)) continue;
  const tick = c.tick ?? DEFAULT_TICK;
  if (!existsSync(join(ROOT, `work/feature-grid/docs/${c.id}.json`))) { console.log(`skip ${c.id} (no doc; run build-docs)`); continue; }
  for (const glow of [1, 0]) {
    const png = join(out, `${c.id}${glow ? '' : '-noglow'}.png`);
    rmSync(png, { force: true });
    const capture = captureRun(ROOT, tick, editor);
    const url = `${editor}/capture.html?doc=${encodeURIComponent(`/work/feature-grid/docs/${c.id}.json`)}&tick=${tick}&cam=${CAMERA.position.join(',')}&look=${CAMERA.target.join(',')}&fov=${CAMERA.fov}&glow=${glow}&run=${capture.run}`;
    spawnSync(chrome, ['--headless=new', '--hide-scrollbars', '--window-size=960,540', '--virtual-time-budget=20000', `--screenshot=${png}`, url], { timeout: 60_000, killSignal: 'SIGKILL' });
    try {
      if (!existsSync(png)) throw new Error('no screenshot');
      capture.check(png);
    } catch (e) { bad++; console.log(`FAIL ${c.id} glow=${glow}: ${String(e.message).split('\n')[0]}`); continue; }
  }
  console.log(`ok   ${c.id} t${tick}`);
}
process.exit(bad ? 1 : 0);
