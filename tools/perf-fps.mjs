// 15-PERFORMANCE "Default playback median frame interval ≤ 16.7 ms, p95 ≤ 20 ms": plays every built-in component
// (fresh from its template) in headless Chrome on the real GPU at 1920×1080 and records requestAnimationFrame
// intervals over one full cast. Needs the dev server and ~/.claude/tools/cdp-eval.mjs.
// Run: node tools/perf-fps.mjs   (writes docs/v2-plan/evidence/perf-fps-<date>.md)
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ids = JSON.parse(execFileSync(process.execPath, ['-e', `import('./src/graph/components.ts').then(m => { const { insertComponent, COMPONENT_TEMPLATES } = m; return import('./src/graph/fixtures.ts').then(f => { const fs = require('node:fs'); for (const c of COMPONENT_TEMPLATES) fs.writeFileSync('work/perf/' + c.id + '.json', JSON.stringify(insertComponent(f.createBlankDocument(), c.id, undefined, { group: true }).doc)); console.log(JSON.stringify(COMPONENT_TEMPLATES.map(c => c.id))); }); })`], { encoding: 'utf8' }));
const rows = [];
for (const id of ids) {
  const r = spawnSync(process.execPath, [join(homedir(), '.claude/tools/cdp-eval.mjs'), `http://127.0.0.1:5174/?view=1&doc=/work/perf/${id}.json`, 'tools/perf-fps-probe.js', '--gpu', '--wait', '2500', '--width', '1920', '--height', '1080'], { encoding: 'utf8', timeout: 60000 });
  let v; try { v = JSON.parse(r.stdout); } catch { rows.push(`| ${id} | error: ${(r.stderr || r.stdout).trim().slice(0, 80)} | | | | |`); continue; }
  rows.push(`| ${id} | ${v.frames} | ${v.median.toFixed(1)} | ${v.p95.toFixed(1)} | ${v.max.toFixed(1)} | ${v.canvas.join('×')} |`);
  console.log(rows.at(-1));
}
const date = new Date().toISOString().slice(0, 10);
writeFileSync(`docs/v2-plan/evidence/perf-fps-${date}.md`, `# Playback frame intervals — ${date} (15-PERFORMANCE, T37)

Headless Chrome with the real GPU (\`--headless=new\`, no SwiftShader), window 1920×1080, Balanced profile, glow on.
One full cast per component after a 2.5 s load wait; the first 5 intervals are dropped. Reproduce: \`node tools/perf-fps.mjs\`.
Target: median ≤ 16.7 ms, p95 ≤ 20 ms. The display refresh (60 Hz) caps the median at ~16.7 ms.

| Component | frames | median ms | p95 ms | max ms | canvas px |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`);
