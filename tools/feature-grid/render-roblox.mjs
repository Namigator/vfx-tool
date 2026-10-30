#!/usr/bin/env node
// Feature grid stage 2 (Roblox): exports every case to a Roblox model (work/feature-grid/roblox-pkg/<id>/, report.json)
// and records it in Studio through tools/roblox-fidelity.mjs with the grid camera -> work/feature-grid/roblox/<id>.png.
// ~2 min per case and the capture is the primary monitor: nobody may use the PC meanwhile.
//   node --experimental-strip-types tools/feature-grid/render-roblox.mjs [id-filter]    FG_RESUME=1 skips cases already rendered
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { robloxEffectFrom } from '../../src/export/roblox/fromPlan.ts';
import { writeRbxmx } from '../../src/export/roblox/rbxmx.ts';
import { ROBLOX_TEXTURE_IDS } from '../../src/export/roblox/assets.ts';
import { effectPlayerSource } from '../../src/export/roblox/playerSource.node.ts';
import { CAMERA, CASES, DEFAULT_TICK } from './cases.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const G = join(ROOT, 'work/feature-grid');
const only = process.argv[2];
const idsFile = join(ROOT, 'work/roblox/asset-ids.json');
const assetIds = existsSync(idsFile) ? JSON.parse(readFileSync(idsFile, 'utf8')) : {};
mkdirSync(join(G, 'roblox'), { recursive: true });
let bad = 0;
for (const c of CASES) {
  if (only && !c.id.includes(only)) continue;
  const docPath = join(G, 'docs', `${c.id}.json`), dst = join(G, 'roblox', `${c.id}.png`);
  if (!existsSync(docPath)) { console.log(`skip ${c.id} (no doc)`); continue; }
  if (process.env.FG_RESUME && existsSync(dst)) { console.log(`have ${c.id}`); continue; }
  const pkg = join(G, 'roblox-pkg', c.id); mkdirSync(pkg, { recursive: true });
  const r = robloxEffectFrom(JSON.parse(readFileSync(docPath, 'utf8')));
  if (!r.ok) { writeFileSync(join(pkg, 'report.json'), JSON.stringify({ exportError: r.message })); console.log(`EXPORT FAIL ${c.id}`); continue; }
  const missingIds = r.value.textures?.filter?.(t => !assetIds[t] && !ROBLOX_TEXTURE_IDS[t]) ?? [];
  writeFileSync(join(pkg, 'report.json'), JSON.stringify({ report: r.value.report ?? [], missingAssetIds: missingIds }));
  const model = join(pkg, 'Effect.rbxmx');
  writeFileSync(model, writeRbxmx(r.value, { assetIds, playerSource: effectPlayerSource() }));
  const tick = c.tick ?? DEFAULT_TICK, out = join(pkg, 'fidelity');
  rmSync(out, { recursive: true, force: true });
  const t0 = Date.now();
  const run = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'tools/roblox-fidelity.mjs', '--doc', docPath, '--model', model,
    '--ticks', String(tick), '--cam', CAMERA.position.join(','), '--look', CAMERA.target.join(','), '--fov', String(CAMERA.fov), '--out', out, '--name', `fg_${c.id}`],
  { cwd: ROOT, encoding: 'utf8', timeout: 10 * 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
  writeFileSync(join(pkg, 'capture.log'), `${run.stdout ?? ''}\n${run.stderr ?? ''}`);
  const shot = join(out, `roblox-${tick}.png`);
  rmSync(dst, { force: true });
  if (existsSync(shot)) { copyFileSync(shot, dst); console.log(`ok   ${c.id} t${tick} (${Math.round((Date.now() - t0) / 1000)} s)`); }
  else { bad++; console.log(`FAIL ${c.id}: exit ${run.status}; ${join(pkg, 'capture.log')}`); }
}
process.exit(bad ? 1 : 0);
