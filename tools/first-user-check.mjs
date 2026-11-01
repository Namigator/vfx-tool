// Runs tools/first-user-probe.js on the deployed site and writes the exported files to work/p04/out/.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
mkdirSync('work/p04/out', { recursive: true });
const url = process.argv[2] ?? 'https://demo.xpo.dev/avi/vfx-tool/';
const r = spawnSync(process.execPath, [join(homedir(), '.claude/tools/cdp-eval.mjs'), url, 'tools/first-user-probe.js', '--wait', '3000', '--width', '1600', '--height', '1000', '--shot', 'work/p04/after.png'], { encoding: 'utf8', maxBuffer: 512 << 20 });
let v; try { v = JSON.parse(r.stdout); } catch { console.log((r.stderr || r.stdout).slice(0, 2000)); process.exit(1); }
mkdirSync('work/p04/out', { recursive: true });
for (const f of v.files) writeFileSync(join('work/p04/out', f.name), Buffer.from(f.data, 'base64'));
for (const s of v.steps) console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.name}  ${s.detail}`);
console.log('files:', v.files.map(f => `${f.name} (${f.size} B)`).join(', '));
