#!/usr/bin/env node
// Feature grid stage 2 (Unreal): exports every case as an Unreal package (work/feature-grid/unreal-pkg/<id>/, report.json
// = the IR report) and imports + renders each through tools/unreal-check.mjs with Movie Render Queue (fixed 1/60 s,
// editor look, particle trails on) and the grid camera -> work/feature-grid/unreal/<id>.png. ~3 min per case.
//   node --experimental-strip-types tools/feature-grid/render-unreal.mjs [id-filter]    FG_RESUME=1 skips cases already rendered
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { unrealEffectFrom } from '../../src/export/unreal/fromPlan.ts';
import { buildUnrealPackage } from '../../src/export/unreal/package.ts';
import { CAMERA, CASES, DEFAULT_TICK, STAGE } from './cases.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const G = join(ROOT, 'work/feature-grid');
const LAB = process.env.VFX_UE_TEST_PROJECT ? resolve(process.env.VFX_UE_TEST_PROJECT, '..') : 'F:/Dev2/UnrealVFXLab';
const only = process.argv[2];

// Tool metres -> Unreal world cm with the actor at the Source and the floor at Z 0: ue = (x - sx, z - sz, y) * 100.
const s = STAGE.source, ue = p => [p[0] - s[0], p[2] - s[2], p[1]].map(v => (v * 100).toFixed(1)).join(',');
const vfov = CAMERA.fov * Math.PI / 180, hfov = (2 * Math.atan(Math.tan(vfov / 2) * 16 / 9) * 180 / Math.PI).toFixed(2);
mkdirSync(join(G, 'unreal'), { recursive: true });
let bad = 0;
for (const c of CASES) {
  if (only && !c.id.includes(only)) continue;
  const doc = join(G, 'docs', `${c.id}.json`), dst = join(G, 'unreal', `${c.id}.png`);
  if (!existsSync(doc)) { console.log(`skip ${c.id} (no doc)`); continue; }
  if (process.env.FG_RESUME && existsSync(dst)) { console.log(`have ${c.id}`); continue; }
  const name = `fg_${c.id.replace(/-/g, '_')}`, pkg = join(G, 'unreal-pkg', name);
  rmSync(pkg, { recursive: true, force: true }); mkdirSync(join(pkg, 'Textures'), { recursive: true });
  // The importer fails on a system with no sprite emitter: the empty plate is the point case with every particle invisible.
  const r = unrealEffectFrom(JSON.parse(readFileSync(c.id === 'empty' ? join(G, 'docs', 'shape-point.json') : doc, 'utf8')));
  if (c.id === 'empty' && r.ok) for (const e of r.value.emitters) e.opacityOverLife = e.opacityOverLife.map(k => ({ ...k, v: 0 }));
  // report.json lives at unreal-pkg/<id>/ for the scorer; the package itself at unreal-pkg/<name>/.
  const rdir = join(G, 'unreal-pkg', c.id); mkdirSync(rdir, { recursive: true });
  if (!r.ok) { writeFileSync(join(rdir, 'report.json'), JSON.stringify({ exportError: r.message })); console.log(`EXPORT FAIL ${c.id}`); continue; }
  writeFileSync(join(rdir, 'report.json'), JSON.stringify({ report: r.value.report }));
  const bytes = new Map(r.value.textures.map(t => [t, readFileSync(join(ROOT, 'assets', 'sprites', t))]));
  for (const f of buildUnrealPackage(r.value, bytes)) writeFileSync(join(pkg, f.path), f.bytes);
  rmSync(join(LAB, 'Content/VFXStudio', name), { recursive: true, force: true });
  rmSync(join(ROOT, 'work/unreal', `${name}.png`), { force: true });
  const tick = c.tick ?? DEFAULT_TICK;
  const t0 = Date.now();
  const run = spawnSync(process.execPath, ['tools/unreal-check.mjs', pkg, name], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 20 * 60_000,
    env: { ...process.env, VFX_UE_CAPTURE: 'mrq', VFX_LOOK: 'editor', VFX_UE_IMPORT_ARGS: '-VfxParticleTrails', VFX_UE_SECONDS: (tick / 60).toFixed(3),
      VFX_ACTOR_Z: (s[1] * 100).toFixed(1), VFX_FLOOR_Z: '0', VFX_CAM_POS: ue(CAMERA.position), VFX_CAM_LOOK: ue(CAMERA.target), VFX_FOV: hfov },
  });
  writeFileSync(join(rdir, 'capture.log'), `${run.stdout ?? ''}\n${run.stderr ?? ''}`);
  const shot = join(ROOT, 'work/unreal', `${name}.png`);
  rmSync(dst, { force: true });
  if (existsSync(shot)) { copyFileSync(shot, dst); console.log(`ok   ${c.id} t${tick} (${Math.round((Date.now() - t0) / 1000)} s)`); }
  else { bad++; console.log(`FAIL ${c.id}: exit ${run.status}; ${join(rdir, 'capture.log')}`); }
}
process.exit(bad ? 1 : 0);
