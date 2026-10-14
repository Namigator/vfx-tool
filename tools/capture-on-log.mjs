// Watches the newest Roblox Studio log for "COMPARE_FROZEN <n> <effect> <tick>" lines and captures the Studio window
// (shot.ps1) right away, saving <outDir>/rbx-<n>.png. Stops at COMPARE_DONE or after --timeout seconds.
//   node tools/capture-on-log.mjs <outDir> <windowTitle> [--timeout 400]
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const [outDir, title] = process.argv.slice(2);
const ti = process.argv.indexOf('--timeout'), timeout = ti > 0 ? Number(process.argv[ti + 1]) : 400;
mkdirSync(outDir, { recursive: true });
const logs = join(homedir(), 'AppData', 'Local', 'Roblox', 'logs');
const start = Date.now(), seen = new Set();
const newest = () => readdirSync(logs).filter(f => f.endsWith('.log')).map(f => ({ f, t: statSync(join(logs, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 4).map(x => join(logs, x.f));
while ((Date.now() - start) / 1000 < timeout) {
  let text = '';
  for (const f of newest()) { try { if (statSync(f).mtimeMs > start - 5000) text += readFileSync(f, 'utf8'); } catch {} }
  for (const m of text.matchAll(/COMPARE_FROZEN\s+(\d+)\s+(\S+)\s+(\d+)/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const out = execFileSync('powershell', ['-NoProfile', '-File', join(homedir(), '.claude', 'tools', 'shot.ps1'), 'window', title], { encoding: 'utf8' });
    const png = out.trim().split(/\r?\n/).pop().trim();
    copyFileSync(png, join(outDir, `rbx-${m[1]}.png`));
    console.log(`captured ${m[1]} ${m[2]} t${m[3]}`);
  }
  if (/COMPARE_DONE/.test(text)) { console.log('done'); break; }
  await new Promise(r => setTimeout(r, 250));
}
