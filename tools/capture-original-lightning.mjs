// 17 Gate B: captures the ORIGINAL lightning reference (docs/references/original-lightning/lightning-arc.html,
// a Canvas 2D page) at fixed moments using headless Chrome's virtual clock. The page casts at 0.7 s and strikes 0.39 s
// later, so budgets map to: charge 0.95 s, strike 1.12 s, flicker 1.35 s, impact/decay 1.75 s.
// Run with the dev server up: node tools/capture-original-lightning.mjs  → docs/v2-plan/evidence/gate-B/original-*.png
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const chrome = [process.env.VFX_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && existsSync(p));
if (!chrome) throw new Error('No Chrome/Edge found (set VFX_CHROME).');
const out = 'docs/v2-plan/evidence/gate-B'; mkdirSync(out, { recursive: true });
const url = 'http://127.0.0.1:5174/docs/references/original-lightning/lightning-arc.html';
for (const [name, ms] of [['charge', 760], ['strike', 1120], ['flicker', 1350], ['decay', 2300]]) {
  const profile = mkdtempSync(join(tmpdir(), 'vfx-orig-')), file = resolve(out, `original-${name}.png`);
  spawnSync(chrome, ['--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${profile}`, '--window-size=960,540', `--virtual-time-budget=${ms}`, `--screenshot=${file}`, url], { timeout: 60_000, stdio: 'ignore' });
  rmSync(profile, { recursive: true, force: true });
  console.log(existsSync(file) ? `wrote ${file}` : `FAILED ${name}`);
}
