// Headless Unity check of a VFX Studio Unity export package: node tools/unity-check.mjs <package-dir> [ticks=30,60,90] [yaw=0] [pitch=15] [zoom=1]
// Syncs integrations/unity/VfxStudio into the test project's Assets/VfxStudio, runs Unity in batch mode (with the GPU:
// no -nographics) to import the package into a prefab and render the chosen ticks to PNG, and prints the frame paths.
// Env: VFX_UNITY_EXE (default F:/tools/Unity/6000.6.4f1/Editor/Unity.exe), VFX_UNITY_PROJECT (default F:/Dev2/UnityVFXLab,
// created on first use), VFX_UNITY_CAM="px,py,pz,tx,ty,tz,fov" fixed camera in Unity metres (see VfxStudioCapture.cs). Exit 0 = frames written, 1 = Unity reported a failure, 2 = Unity missing.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const [pkgArg, ticks = '30,60,90', yaw = '0', pitch = '15', zoom = '1'] = process.argv.slice(2);
if (!pkgArg) { console.error('usage: node tools/unity-check.mjs <package-dir> [ticks] [yaw] [pitch]'); process.exit(2); }
const exe = process.env.VFX_UNITY_EXE ?? 'F:/tools/Unity/6000.6.4f1/Editor/Unity.exe';
const project = process.env.VFX_UNITY_PROJECT ?? 'F:/Dev2/UnityVFXLab';
if (!existsSync(exe)) { console.error(`Unity not found at ${exe} (set VFX_UNITY_EXE)`); process.exit(2); }
const pkg = resolve(pkgArg);
const name = JSON.parse(readFileSync(join(pkg, 'effect.unity.json'), 'utf8')).name;
const logs = resolve('work/unity/logs'); mkdirSync(logs, { recursive: true });
const run = (args, log) => {
  const r = spawnSync(exe, ['-batchmode', '-quit', '-logFile', log, ...args], { stdio: 'inherit', timeout: 15 * 60 * 1000 });
  return { code: r.status, text: existsSync(log) ? readFileSync(log, 'utf8') : '' };
};
if (!existsSync(join(project, 'Assets'))) {
  console.log(`creating Unity project ${project} ...`);
  const r = run(['-createProject', project], join(logs, 'create.log'));
  if (r.code !== 0) { console.error('project creation failed, see work/unity/logs/create.log'); process.exit(1); }
}
// Fresh copy of the integration (stale scripts would hide compile errors) and of the package.
rmSync(join(project, 'Assets/VfxStudio'), { recursive: true, force: true });
cpSync(resolve('integrations/unity/VfxStudio'), join(project, 'Assets/VfxStudio'), { recursive: true });
const out = resolve('work/unity/frames');
const log = join(logs, `${name}.log`);
const r = run(['-projectPath', project, '-executeMethod', 'VfxStudio.EditorTools.VfxStudioCapture.ImportAndCaptureCli',
  '-vfxPackage', pkg, '-vfxOut', out, '-vfxTicks', ticks, '-vfxYaw', yaw, '-vfxPitch', pitch, '-vfxZoom', zoom,
  ...(process.env.VFX_UNITY_CAM ? ['-vfxCam', process.env.VFX_UNITY_CAM] : [])], log);
const lines = r.text.split(/\r?\n/);
const errors = lines.filter(l => /error CS\d+|CAPTURE FAILED|Exception/.test(l));
for (const l of lines.filter(l => l.includes('[VfxStudio]'))) console.log(l.trim());
if (errors.length) { console.error(errors.slice(0, 20).join('\n')); }
console.log(`unity exit ${r.code}; log ${log}`);
process.exit(r.code === 0 && !errors.some(l => /error CS|CAPTURE FAILED/.test(l)) ? 0 : 1);
