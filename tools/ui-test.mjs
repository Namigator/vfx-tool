#!/usr/bin/env node
// Automated UI tests in the real editor (T28 curve/gradient editing, T29 graph shortcuts/outline/focus): loads a
// fixture document into the dev server in headless Chrome and runs each probe in tools/ui-tests/ with trusted mouse and
// keyboard input (~/.claude/tools/cdp-eval.mjs `cdp(...)`). Each probe returns {checks:[{name, ok, detail}]}.
// Needs the dev server (npm run dev). Run: node tools/ui-test.mjs [probe-name ...]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const only = process.argv.slice(2);
mkdirSync('work/ui', { recursive: true });
// Fixture: a blank document with the spark burst inserted ungrouped (its nodes sit on the top graph).
execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', `
  const { insertComponent } = await import('./src/graph/components.ts'); const { createBlankDocument } = await import('./src/graph/fixtures.ts');
  const fs = await import('node:fs');
  fs.writeFileSync('work/ui/spark.json', JSON.stringify(insertComponent(createBlankDocument('ui-spark', 'UI test'), 'spark-burst', undefined, { group: false }).doc));
  fs.writeFileSync('work/ui/grouped.json', JSON.stringify(insertComponent(createBlankDocument('ui-grouped', 'UI test'), 'spark-burst', undefined, { group: true }).doc));`]);
const helpers = readFileSync('tools/ui-tests/helpers.js', 'utf8');
let failed = 0, total = 0;
for (const f of readdirSync('tools/ui-tests').filter(f => /^t\d+.*\.js$/.test(f) && (!only.length || only.some(o => f.includes(o))))) {
  const src = readFileSync(join('tools/ui-tests', f), 'utf8');
  const doc = /\/\/ fixture: (\S+)/.exec(src)?.[1] ?? 'spark.json';
  writeFileSync('work/ui/probe.js', `${helpers}\ntry {\nawait ready();\n${src}\n} catch (e) { checks.push({ name: 'probe ran to the end', ok: false, detail: String(e && e.stack || e) }); return { checks }; }`);
  const r = spawnSync(process.execPath, [join(homedir(), '.claude/tools/cdp-eval.mjs'), `http://127.0.0.1:5174/?doc=/work/ui/${doc}`, 'work/ui/probe.js', '--wait', '3000', '--width', '1600', '--height', '1000'], { encoding: 'utf8', timeout: 180000 });
  let v; try { v = JSON.parse(r.stdout); } catch { console.log(`FAIL ${f}: ${(r.stderr || r.stdout).trim().slice(0, 400)}`); failed++; continue; }
  console.log(`\n${f}`);
  for (const c of v.checks) { total++; if (!c.ok) failed++; console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.ok ? '' : `  [${c.detail}]`}`); }
}
console.log(`\n${total - failed}/${total} UI checks passed`);
process.exit(failed ? 1 : 0);
