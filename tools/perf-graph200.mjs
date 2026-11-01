#!/usr/bin/env node
// 15-PERFORMANCE "Graph interaction with 200 visible nodes remains <= 50 ms p95 input response" (T37): builds a document
// of built-in components inserted ungrouped until the top graph holds >= 200 nodes, opens it in headless Chrome on the
// real GPU and measures select / node-drag / pan response with trusted input (tools/perf-graph200-probe.js).
// Needs the dev server. Run: node tools/perf-graph200.mjs   (writes docs/v2-plan/evidence/perf-graph200-<date>.md)
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir, cpus, totalmem, release } from 'node:os';
import { join } from 'node:path';

mkdirSync('work/perf', { recursive: true });
const count = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', `
  const { insertComponent, COMPONENT_TEMPLATES } = await import('./src/graph/components.ts'); const { createBlankDocument } = await import('./src/graph/fixtures.ts');
  let d = createBlankDocument('graph200', '200-node graph');
  for (const c of COMPONENT_TEMPLATES) { if (d.graphs[0].nodes.length >= 200) break; d = insertComponent(d, c.id, undefined, { group: false }).doc; }
  (await import('node:fs')).writeFileSync('work/perf/graph200.json', JSON.stringify(d));
  console.log(d.graphs[0].nodes.length);`], { encoding: 'utf8' }).trim();
const runs = [];
for (let i = 0; i < 3; i++) {
  const r = spawnSync(process.execPath, [join(homedir(), '.claude/tools/cdp-eval.mjs'), `${process.env.VFX_BASE ?? 'http://127.0.0.1:5174'}/?doc=/work/perf/graph200.json`, 'tools/perf-graph200-probe.js', '--gpu', '--wait', '1500', '--width', '1920', '--height', '1080'], { encoding: 'utf8', timeout: 240000 });
  try { runs.push(JSON.parse(r.stdout)); } catch { console.error((r.stderr || r.stdout).slice(0, 400)); process.exit(1); }
  const v = runs.at(-1);
  console.log(`run ${i + 1}: ${v.drawnNodes} nodes drawn · select p95 ${v.select.p95} ms · drag p95 ${v.drag.p95} ms · pan p95 ${v.pan.p95} ms · missed ${v.select.missed + v.drag.missed + v.pan.missed}`);
}
const worst = k => Math.max(...runs.map(r => r[k].p95));
const pass = ['select', 'drag', 'pan'].every(k => worst(k) <= 50) && runs.every(r => r.drawnNodes >= 200 && !r.select.missed && !r.drag.missed && !r.pan.missed);
const date = new Date().toISOString().slice(0, 10);
const gpu = spawnSync('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join ", "'], { encoding: 'utf8' }).stdout.trim();
writeFileSync(`docs/v2-plan/evidence/perf-graph200-${date}.md`, `# Graph interaction with ${count} nodes — ${date} (15-PERFORMANCE, T37)

Target: input response p95 ≤ 50 ms with 200 visible nodes. Result: **${pass ? 'PASS' : 'FAIL'}** (worst p95 over 3 runs: select ${worst('select')} ms, drag ${worst('drag')} ms, pan ${worst('pan')} ms).

Response = time from sending a trusted mouse event (DevTools \`Input.dispatchMouseEvent\`) to the second animation frame after the DOM shows its
result (node selected / node moved / viewport moved), so each sample includes the DevTools round trip and a full paint. 30 samples each.
INP columns: the browser's Event Timing duration (input to next paint) for the same select clicks, and for clicks on plain text that do
nothing, i.e. the floor of this setup (headless Chrome, real GPU).
Document: built-in components inserted ungrouped (\`work/perf/graph200.json\`, ${count} nodes on one graph). Headless Chrome, real GPU, 1920×1080.
Hardware: ${cpus()[0].model.trim()} ×${cpus().length}, ${Math.round(totalmem() / 2 ** 30)} GB RAM, GPU ${gpu}, Windows ${release()}. Browser: ${runs[0].ua.match(/Chrome\/[\d.]+/)?.[0]}.
Reproduce: \`node tools/perf-graph200.mjs\` with the dev server running.

| run | nodes drawn | usable after load (ms) | select p50 / p95 / max | drag p50 / p95 / max | pan p50 / p95 / max | select INP p50 / p95 | no-op click INP p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- |
${runs.map((r, i) => `| ${i + 1} | ${r.drawnNodes} | ${r.usableMs} | ${r.select.p50} / ${r.select.p95} / ${r.select.max} | ${r.drag.p50} / ${r.drag.p95} / ${r.drag.max} | ${r.pan.p50} / ${r.pan.p95} / ${r.pan.max} | ${r.selectInp.p50} / ${r.selectInp.p95} | ${r.floorInp.p50} / ${r.floorInp.p95} |`).join('\n')}
`);
console.log(pass ? 'GRAPH200 PASS' : 'GRAPH200 FAIL');
process.exit(pass ? 0 : 1);
