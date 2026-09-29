// 15-PERFORMANCE "Restart-required edit/compile p95 ≤ 250 ms", measured in the real editor: for every built-in
// component, 15 knob edits in headless Chrome (real GPU); reports the time from the slider release to the rebuilt
// preview (tools/perf-knob-probe.js). Needs the dev server and ~/.claude/tools/cdp-eval.mjs.
// Run: node tools/perf-knob.mjs   (prints a table; no-op edits that round to the same value are excluded)
import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { COMPONENT_TEMPLATES, insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';

const rows = [], meds = [];
for (const c of COMPONENT_TEMPLATES) {
  writeFileSync(`work/perf/${c.id}.json`, JSON.stringify(insertComponent(createBlankDocument(), c.id, undefined, { group: true }).doc));
  const r = spawnSync(process.execPath, [join(homedir(), '.claude/tools/cdp-eval.mjs'), `http://127.0.0.1:5174/?view=1&doc=/work/perf/${c.id}.json`, 'tools/perf-knob-probe.js', '--gpu', '--wait', '2500'], { encoding: 'utf8', timeout: 120000 });
  let d; try { d = JSON.parse(r.stdout); } catch { rows.push(`| ${c.id} | no data | | | |`); continue; }
  const v = d.rebuildAt.split(' ').map(Number).filter(x => x >= 1).sort((a, b) => a - b);
  if (!v.length) { rows.push(`| ${c.id} | ${d.knob} | 0 | | |`); continue; }
  meds.push(v[v.length >> 1]);
  rows.push(`| ${c.id} | ${d.knob} | ${v.length} | ${v[v.length >> 1]} | ${v.at(-1)} |`);
  console.log(rows.at(-1));
}
meds.sort((a, b) => a - b);
console.log(`median of medians ${meds[meds.length >> 1]} ms, worst median ${meds.at(-1)} ms`);
