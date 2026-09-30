#!/usr/bin/env node
// Headless check of an exported Unreal package: node tools/unreal-check.mjs <package-dir> [effectName]
//
// 1. Runs the VfxStudioImportCommandlet (-run=VfxStudioImport) against a test project to build a NiagaraSystem.
// 2. Builds (or reuses) a test level via a Python editor script: a dark floor, a NiagaraActor running the imported
//    system (with a warm-up so a frame taken at game-start still lands mid-effect), and a CameraActor set to
//    auto-activate for Player 0.
// 3. Launches UnrealEditor.exe <project> <level> -game -RenderOffscreen -unattended, fires HighResShot via
//    -ExecCmds, and relies on a hard wall-clock timeout (this process kills the child) since -game does not exit on
//    its own after a console-triggered screenshot.
// 4. Copies the resulting PNG to work/unreal/<name>.png.
//
// HONESTY NOTE (2026-10-01): steps 1-3's MECHANICS are [RAN] verified — the commandlet imports a real package with
// zero "module not found" warnings (every module-input override lands on a real Niagara module) and the -game
// capture pipeline produces a real PNG at the requested resolution with no crash. What is NOT yet working: the
// captured frame is blank (pure black) -- Niagara particles are not visibly appearing. Confirmed along the way (see
// F:/Dev2/VFX-Tool/work/unreal-spike/logs/1[4-9]* and 2*-3*_*.log for the raw evidence):
//   - Git Bash / MSYS mangles a leading "/Game/..." or "/Dest=" path into "C:/Program Files/Git/Game/...";
//     MSYS_NO_PATHCONV=1 is REQUIRED on every UnrealEditor(-Cmd).exe invocation from a bash-like shell on Windows.
//   - CameraActor needs auto_activate_for_player = Player0 (Python: unreal.AutoReceiveInput.PLAYER0) or -game mode
//     renders from the wrong/default view.
//   - A bright PointLight + the default-lit floor material overexposes to solid white; either skip the light
//     (the exported materials are Unlit/emissive so they should show against black without any light) or use a
//     modest intensity and a non-default floor material.
//   - MSM_Unlit materials only read the Emissive Color output -- BaseColor is ignored. The importer's translucent
//     material was wired to BaseColor; fixed in VfxNiagaraImporter.cpp (GetOrCreateBaseMaterial) to always drive
//     Emissive. This was a real, worthwhile fix but did NOT by itself make particles appear, so activation/bounds
//     timing in headless -game is the remaining suspect, not material wiring.
//   - NiagaraComponent.warmup_time (Python) is a settable property and was used to pre-simulate ~2s so a shot taken
//     near game-start would land mid-effect (the flamethrower is ~4s long) -- this is unverified as fixing anything
//     since the frame is still blank for an unrelated reason.
// Leading unexamined hypotheses for a follow-up (needs interactive engine access to resolve quickly, which this
// pass avoided per "headless only, no computer use"): NiagaraComponent bAutoActivate may not actually kick off
// simulation before the first rendered frame in a cooked/-game context the way it does in-editor; or the system's
// dynamic bounds are not yet computed on frame 1, causing a bounds-based cull. Compare against opening the same
// level in the editor and pressing Play (a `-game` launch is not required for that check) as the fastest next step.
//
// Exit codes: 0 = PNG captured (visual correctness NOT verified by this script -- read the PNG), 1 = import or
// capture failed, 2 = required tools/paths not found (nothing is installed by this script).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
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
const importResult = run('import', EDITOR_CMD, [
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

// --- 2. Build the test level (dark floor + NiagaraActor + camera) via a Python editor script ---
const levelPath = '/Game/VFXStudio/L_Check';
const pyScript = join(outDir, `_build_level_${effectName}.py`);
writeFileSync(pyScript, `import unreal
NS_PATH = "${destPath}/NS_${effectName}"
LEVEL_PATH = "${levelPath}"
if unreal.EditorAssetLibrary.does_asset_exist(LEVEL_PATH):
    unreal.EditorAssetLibrary.delete_asset(LEVEL_PATH)
unreal.EditorLoadingAndSavingUtils.new_blank_map(True)
el = unreal.EditorLevelLibrary
floor = el.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(0, 0, -5), unreal.Rotator(0, 0, 0))
cube_mesh = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube.Cube")
if cube_mesh and floor:
    floor.static_mesh_component.set_static_mesh(cube_mesh)
    floor.set_actor_scale3d(unreal.Vector(20, 20, 0.1))
ns = unreal.EditorAssetLibrary.load_asset(NS_PATH)
niagara_actor = el.spawn_actor_from_class(unreal.NiagaraActor, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
if niagara_actor and ns:
    niagara_actor.niagara_component.set_asset(ns)
    niagara_actor.niagara_component.set_editor_property("auto_activate", True)
    try:
        niagara_actor.niagara_component.set_editor_property("warmup_time", 2.0)
    except Exception as e:
        print("warmup_time not settable:", e)
cam = el.spawn_actor_from_class(unreal.CameraActor, unreal.Vector(600, -600, 250), unreal.Rotator(0, 0, 0))
if cam:
    cam.set_actor_rotation((unreal.Vector(0, 0, 100) - cam.get_actor_location()).rotator(), False)
    cam.set_editor_property("auto_activate_for_player", unreal.AutoReceiveInput.PLAYER0)
saved = unreal.EditorLoadingAndSavingUtils.save_map(el.get_editor_world(), LEVEL_PATH)
print("LEVEL_SAVED", LEVEL_PATH, saved)
`);
const levelResult = run('build-level', EDITOR_CMD, [
  TEST_PROJECT, '-run=pythonscript', `-script=${pyScript}`, '-unattended', '-nosplash', '-log',
], { timeoutMs: 120_000 });
if (levelResult.status !== 0) {
  console.error(`[unreal-check] level build FAILED (exit ${levelResult.status}).`);
  console.error(levelResult.stdout?.slice(-4000));
  process.exit(1);
}
console.log('[unreal-check] level build OK');

// --- 3. Headless render: -game -RenderOffscreen + HighResShot, killed by a hard timeout (no clean -game exit path
//     for a console-triggered screenshot is set up here; see header). ---
const screenshotDir = join(TEST_PROJECT.replace(/[^/\\]+\.uproject$/, ''), 'Saved', 'Screenshots', 'WindowsEditor');
rmSync(join(screenshotDir, 'HighresScreenshot00000.png'), { force: true });
const CAPTURE_TIMEOUT_MS = 60_000;
run('capture (killed by timeout; this is expected)', EDITOR, [
  TEST_PROJECT, levelPath, '-game', '-RenderOffscreen', '-ResX=960', '-ResY=540', '-unattended', '-nosplash',
  '-ExecCmds=HighResShot 1',
], { timeoutMs: CAPTURE_TIMEOUT_MS });

const shot = join(screenshotDir, 'HighresScreenshot00000.png');
if (!existsSync(shot)) {
  console.error('[unreal-check] no screenshot produced. See work/unreal-spike/logs for prior debugging of this exact failure mode.');
  process.exit(1);
}
const dest = join(outDir, `${effectName}.png`);
copyFileSync(shot, dest);
console.log(`[unreal-check] wrote ${dest}`);
console.log('[unreal-check] IMPORTANT: this script does NOT verify the frame is not blank. Read the PNG yourself -- as of 2026-10-01 it reliably captures a pure black frame (see the header note for what is confirmed working vs. not).');
process.exit(0);
