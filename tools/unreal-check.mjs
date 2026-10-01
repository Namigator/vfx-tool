#!/usr/bin/env node
// Headless check of an exported Unreal package: node tools/unreal-check.mjs <package-dir> [effectName]
//
// 1. Runs the VfxStudioImportCommandlet (-run=VfxStudioImport) against a test project to build a NiagaraSystem.
// 2. Renders it in a windowed editor (off-screen) with tools/unreal-capture.py: shaders compile, the system is placed at
//    Source height, simulated VFX_UE_SECONDS (default 1.0) and captured through a SceneCapture2D.
// 3. Copies the frame to work/unreal/<name>.png. Read it: this script does not judge the image.
//
// STATUS (2026-10-01): import + capture are [SAW]-verified on the flamethrower: the system runs and renders as a level
// jet from the Source. Earlier black frames had two causes, both fixed in the importer: emitters must be added through
// UNiagaraSystemFactoryNew::EmittersToAddToNewSystem (AddEmitterHandle alone left a system that completed on its first
// tick) and module inputs must be keyed by their aliased names. Spawn offsets away from Source do not take effect yet.
// Exit codes: 0 = PNG captured (visual correctness NOT verified by this script -- read the PNG), 1 = import or
// capture failed, 2 = required tools/paths not found (nothing is installed by this script).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const pkgDir = process.argv[2];
const effectName = process.argv[3] ?? (pkgDir ? basename(resolve(pkgDir)) : undefined);
if (!pkgDir || !existsSync(pkgDir)) {
  console.error('usage: node tools/unreal-check.mjs <package-dir> [effectName]');
  console.error('  package-dir: a folder written by vfx_export_unreal / the editor Export Unreal button (contains effect.json)');
  process.exit(2);
}

const UE_ROOT = process.env.VFX_UE_ROOT ?? 'F:/EpicGames/UE_5.8';
const TEST_PROJECT = process.env.VFX_UE_TEST_PROJECT ?? 'F:/Dev2/UnrealVFXLab/UnrealVFXLab.uproject';
const EDITOR_CMD = join(UE_ROOT, 'Engine/Binaries/Win64/UnrealEditor-Cmd.exe');
const EDITOR = join(UE_ROOT, 'Engine/Binaries/Win64/UnrealEditor.exe');
if (!existsSync(EDITOR_CMD) || !existsSync(TEST_PROJECT)) {
  console.error(`unreal-check: engine or test project not found (VFX_UE_ROOT=${UE_ROOT}, VFX_UE_TEST_PROJECT=${TEST_PROJECT}). Set those env vars if this machine differs.`);
  process.exit(2);
}

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const outDir = join(root, 'work', 'unreal');
mkdirSync(outDir, { recursive: true });
const destPath = `/Game/VFXStudio/${effectName}`;

function run(label, exe, args, { timeoutMs } = {}) {
  console.log(`[unreal-check] ${label}: ${exe} ${args.join(' ')}`);
  const r = spawnSync(exe, args, {
    env: { ...process.env, MSYS_NO_PATHCONV: '1' }, // REQUIRED: see header note on Git Bash path mangling.
    encoding: 'utf8', timeout: timeoutMs,
  });
  return r;
}

// --- 1. Import the package into a NiagaraSystem via the commandlet ---
// VFX_UE_SKIP_IMPORT=1 re-renders the system already imported (camera/time changes only).
const importResult = process.env.VFX_UE_SKIP_IMPORT ? { status: 0 } : run('import', EDITOR_CMD, [
  TEST_PROJECT, '-run=VfxStudioImport', `-Package=${resolve(pkgDir)}`, `-Dest=${destPath}`,
  '-unattended', '-nosplash', '-nullrhi', '-log',
], { timeoutMs: 120_000 });
if (importResult.status !== 0) {
  console.error(`[unreal-check] import FAILED (exit ${importResult.status}). See stdout/stderr below.`);
  console.error(importResult.stdout?.slice(-4000));
  console.error(importResult.stderr?.slice(-2000));
  process.exit(1);
}
console.log('[unreal-check] import OK');

// --- 2. Render it: a windowed editor (kept off-screen) runs tools/unreal-capture.py from the console (`py ...`), which
//     waits for shaders, places the system at Source height (the export's origin is the Source anchor), steps the
//     simulation and exports a SceneCapture2D frame. (-game screenshots fire on the first, blank frame; -RenderOffscreen
//     crashes in the StylusInput plugin; -ExecutePythonScript closes the editor as soon as the script returns.)
const systemName = JSON.parse(readFileSync(join(resolve(pkgDir), 'effect.json'), 'utf8')).name.replace(/[^A-Za-z0-9_]/g, '_');
const nsPath = `${destPath}/NS_${systemName}`;
const seconds = process.env.VFX_UE_SECONDS ?? '1.0';
const capDir = join(outDir, 'cap');
mkdirSync(capDir, { recursive: true });
rmSync(join(capDir, 'unreal_capture'), { force: true });
const capture = spawnSync(EDITOR, [TEST_PROJECT, '-windowed', '-WinX=-4000', '-WinY=0', '-ResX=1280', '-ResY=720', '-nosplash', '-NoLiveCoding',
  `-ExecCmds=py ${join(root, 'tools', 'unreal-capture.py')}`, '-log'], {
  env: { ...process.env, MSYS_NO_PATHCONV: '1', VFX_NS: nsPath, VFX_OUT: capDir, VFX_SECONDS: seconds }, timeout: 480_000,
});
const shot = join(capDir, 'unreal_capture');
if (!existsSync(shot)) {
  console.error(`[unreal-check] no capture produced (exit ${capture.status}). See ${join(TEST_PROJECT, '..', 'Saved', 'Logs')} for VFXCAP lines.`);
  process.exit(1);
}
const dest = join(outDir, `${effectName}.png`);
copyFileSync(shot, dest);
console.log(`[unreal-check] wrote ${dest} -- read it: this script does not judge the image.`);
process.exit(0);
