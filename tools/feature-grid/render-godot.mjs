#!/usr/bin/env node
// Feature grid stage 2 (Godot): exports every case through the editor's Godot path into one compare project
// (tools/build-godot-compare.mjs, grid camera), renders each case with Godot's Movie Maker (frame N = tick N, glow off
// to match the editor's no-glow reference) -> work/feature-grid/godot/<id>.png, export report -> godot-pkg/<id>/report.json.
//   node --experimental-strip-types tools/feature-grid/render-godot.mjs [id-filter]       Godot: VFX_GODOT (opens a window)
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { unrealEffectFrom } from '../../src/export/unreal/fromPlan.ts';
import { godotSceneFrom } from '../../src/export/godot/scene.ts';
import { CAMERA, CASES, DEFAULT_TICK } from './cases.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const GODOT = process.env.VFX_GODOT ?? 'C:/Users/itonk/Downloads/Godot_v4.6.2-stable_win64.exe/Godot_v4.6.2-stable_win64_console.exe';
const G = join(ROOT, 'work/feature-grid'), proj = join(G, 'godot-project');
const only = process.argv[2];
if (!existsSync(GODOT)) { console.error(`Godot not found at ${GODOT} (set VFX_GODOT)`); process.exit(2); }

const spec = [], names = {};
for (const c of CASES) {
  if (only && !c.id.includes(only)) continue;
  const doc = join(G, 'docs', `${c.id}.json`);
  if (!existsSync(doc)) { console.log(`skip ${c.id} (no doc)`); continue; }
  const pkg = join(G, 'godot-pkg', c.id); mkdirSync(pkg, { recursive: true });
  const r = unrealEffectFrom(JSON.parse(readFileSync(doc, 'utf8')));
  if (!r.ok) { writeFileSync(join(pkg, 'report.json'), JSON.stringify({ exportError: r.message })); console.log(`EXPORT FAIL ${c.id}`); continue; }
  const g = godotSceneFrom(r.value);
  // The IR's own drops (meshes, screen flash...) count for Godot too, unless worded for Unreal only.
  const irDrops = r.value.report.filter(x => x.level === 'dropped' && !(x.item === 'meshes' && r.value.meshEmitters?.length)).map(x => ({ ...x, message: x.message.replace(/;.*$/s, '.') }));
  writeFileSync(join(pkg, 'report.json'), JSON.stringify({ report: [...irDrops, ...g.report] }));
  names[c.id] = r.value.name;
  spec.push({ name: c.id, doc: `work/feature-grid/docs/${c.id}.json`, ticks: [c.tick ?? DEFAULT_TICK], camera: CAMERA });
}
if (!only) rmSync(proj, { recursive: true, force: true });
writeFileSync(join(G, 'godot-spec.json'), JSON.stringify(spec));
const b = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'tools/build-godot-compare.mjs', proj, join(G, 'godot-spec.json')], { cwd: ROOT, encoding: 'utf8' });
if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(1); }
spawnSync(GODOT, ['--headless', '--path', proj, '--import'], { encoding: 'utf8', timeout: 300_000 });
mkdirSync(join(G, 'godot'), { recursive: true });
let bad = 0;
for (const s of spec) {
  const tick = s.ticks[0], dir = join(G, 'godot-movie');
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const r = spawnSync(GODOT, ['--path', proj, '--write-movie', join(dir, 'f.png'), '--fixed-fps', '60', '--quit-after', String(tick + 2), '--', s.name, '', 'noglow'], { encoding: 'utf8', timeout: 180_000 });
  const frame = join(dir, `f${String(tick).padStart(8, '0')}.png`), dst = join(G, 'godot', `${s.name}.png`);
  rmSync(dst, { force: true });
  if (existsSync(frame)) { copyFileSync(frame, dst); console.log(`ok   ${s.name} t${tick}`); }
  else { bad++; console.log(`FAIL ${s.name}: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ')}`); }
}
process.exit(bad ? 1 : 0);
