#!/usr/bin/env node
// Feature grid stage 2 (Unity): exports every case document through the editor's Unity path (IR -> Unreal IR -> Unity)
// into work/feature-grid/unity-pkg/<id>/ (effect.unity.json, Textures/, report.json), then renders them all in ONE
// batch Unity launch (VfxStudioCapture -vfxBatch) with the grid camera -> work/feature-grid/unity/<id>.png.
//   node --experimental-strip-types tools/feature-grid/render-unity.mjs [id-filter]
// Needs Unity (VFX_UNITY_EXE) and Unity Hub RUNNING (its licensing client holds the entitlement; else exit 198).
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { unrealEffectFrom } from '../../src/export/unreal/fromPlan.ts';
import { unityEffectFrom } from '../../src/export/unity/fromUnreal.ts';
import { CAMERA, CASES, DEFAULT_TICK, STAGE } from './cases.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const exe = process.env.VFX_UNITY_EXE ?? 'F:/tools/Unity/6000.6.4f1/Editor/Unity.exe';
const project = process.env.VFX_UNITY_PROJECT ?? 'F:/Dev2/UnityVFXLab';
const G = join(ROOT, 'work/feature-grid');
const only = process.argv[2];

// Tool point -> Unity metres: the prefab origin is the Source anchor, Z mirrored.
const s = STAGE.source, u = p => [p[0] - s[0], p[1], -(p[2] - s[2])];
const cam = [...u(CAMERA.position), ...u(CAMERA.target), CAMERA.fov].map(v => +v.toFixed(3)).join(',');

const lines = [], names = {};
for (const c of CASES) {
  if (only && !c.id.includes(only)) continue;
  const docFile = join(G, 'docs', `${c.id}.json`);
  if (!existsSync(docFile)) { console.log(`skip ${c.id} (no doc)`); continue; }
  const pkg = join(G, 'unity-pkg', c.id);
  rmSync(pkg, { recursive: true, force: true }); mkdirSync(join(pkg, 'Textures'), { recursive: true });
  const r = unrealEffectFrom(JSON.parse(readFileSync(docFile, 'utf8')));
  if (!r.ok) { writeFileSync(join(pkg, 'report.json'), JSON.stringify({ exportError: r.message })); console.log(`EXPORT FAIL ${c.id}: ${r.message}`); continue; }
  const { effect, report } = unityEffectFrom(r.value);
  writeFileSync(join(pkg, 'effect.unity.json'), JSON.stringify(effect));
  writeFileSync(join(pkg, 'report.json'), JSON.stringify({ report, counts: { emitters: effect.emitters.length, ribbons: effect.ribbons.length, lights: effect.lights.length } }));
  for (const t of effect.textures) copyFileSync(join(ROOT, 'assets', 'sprites', t), join(pkg, 'Textures', t));
  const tick = c.tick ?? DEFAULT_TICK;
  names[c.id] = { file: `${effect.name.replace(/[^A-Za-z0-9_-]/g, '_')}-t${tick}.png` };
  lines.push(`${pkg.replace(/\\/g, '/')}|${tick}|${cam}`);
}
const batch = join(G, 'unity-batch.txt');
writeFileSync(batch, lines.join('\n'));
if (!existsSync(exe)) { console.error(`Unity not found at ${exe}`); process.exit(2); }

rmSync(join(project, 'Assets/VfxStudio'), { recursive: true, force: true });
cpSync(join(ROOT, 'integrations/unity/VfxStudio'), join(project, 'Assets/VfxStudio'), { recursive: true });
rmSync(join(project, 'Assets/VfxStudioEffects'), { recursive: true, force: true }); // stale cases would shadow renamed ones
const frames = join(G, 'unity-frames'); rmSync(frames, { recursive: true, force: true }); mkdirSync(frames, { recursive: true });
const log = join(G, 'unity.log');
console.log(`Unity: ${lines.length} packages in one batch ...`);
const r = spawnSync(exe, ['-batchmode', '-quit', '-logFile', log, '-projectPath', project, '-executeMethod', 'VfxStudio.EditorTools.VfxStudioCapture.ImportAndCaptureCli',
  '-vfxBatch', batch, '-vfxOut', frames], { stdio: 'inherit', timeout: 40 * 60 * 1000 });
const text = existsSync(log) ? readFileSync(log, 'utf8') : '';
for (const l of text.split(/\r?\n/).filter(l => /error CS\d+|ITEM FAILED|CAPTURE FAILED/.test(l))) console.log(l.trim());
mkdirSync(join(G, 'unity'), { recursive: true });
let missing = 0;
for (const [id, { file }] of Object.entries(names)) {
  const src = join(frames, file), dst = join(G, 'unity', `${id}.png`);
  rmSync(dst, { force: true });
  if (existsSync(src)) copyFileSync(src, dst); else { missing++; console.log(`no Unity frame for ${id} (${file})`); }
}
console.log(`unity exit ${r.status}; ${Object.keys(names).length - missing}/${Object.keys(names).length} frames; log ${log}`);
process.exit(r.status === 0 && !missing ? 0 : 1);
