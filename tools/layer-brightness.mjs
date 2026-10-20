#!/usr/bin/env node
// Per-layer brightness: the editor vs the Godot export, one layer at a time, same camera and tick.
//   node --experimental-strip-types tools/layer-brightness.mjs --name ArcaneBolt --tick 72 [--spec work/compare/spec.json]
//        [--layers energy-bolt-core,energy-bolt-halo] [--glow 1|0|both] [--out work/compare/layers/<name>-t<tick>]
// Why: three Godot "hot core" tuning passes (ACES + glow, glow levels, white point) changed the post and guessed
// (2026-10-17). This measures what each layer adds BEFORE any tuning: the editor solos one renderer node
// (capture.html ?solo=<id>, ?glow=0 for no bloom), Godot hides every other child of the exported scene (main.gd args
// from tools/build-godot-compare.mjs). Both subtract their own empty plate.
// Per layer: addedLuma (mean added luminance over the frame), litArea (fraction >0.05 brighter), peak, white = share
// of lit pixels that are near-white (all channels >= 0.9), sat = mean saturation of lit pixels, rgb = mean added
// colour of lit pixels. Writes metrics.json, a markdown table and sheet.png (rows = layers, editor | godot).
// Needs: the vite dev server (http://127.0.0.1:5174), Chrome, ffmpeg, Godot 4.6 (VFX_GODOT). Godot opens a window.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unrealEffectFrom } from '../src/export/unreal/fromPlan.ts';
import { captureRun } from './captureStatus.node.ts';

// --engine unreal (2026-10-17): the same comparison against an imported Unreal package. Needs --ue-pkg <package dir>
// (written by tools/unreal-export.mjs) already imported at --ue-dest </Game/... folder> (tools/unreal-check.mjs). One
// windowed UE 5.8 editor renders every solo shot (tools/unreal-capture.py VFX_SHOTS) from the editor's camera; the
// capture has no bloom, so only glow 0 is compared. Unreal layers also include ribbons (baked slices <name>_s<k>).
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const ROOT = resolve(import.meta.dirname, '..');
const name = opt('name'), tick = Number(opt('tick'));
const engine = opt('engine', 'godot');
if (!name || !Number.isFinite(tick) || !['godot', 'unreal'].includes(engine)) { console.error('usage: layer-brightness.mjs --name <spec name> --tick <t> [--layers a,b] [--glow 1|0|both] [--engine godot|unreal --ue-pkg <dir> --ue-dest </Game/...>]'); process.exit(2); }
const spec = JSON.parse(readFileSync(resolve(opt('spec', 'work/compare/spec.json')), 'utf8')).find(e => e.name === name);
if (!spec) throw new Error(`no ${name} in the spec`);
const project = resolve(opt('godot-project', 'work/godot-compare'));
const GODOT = process.env.VFX_GODOT ?? 'C:/Users/itonk/Downloads/Godot_v4.6.2-stable_win64.exe/Godot_v4.6.2-stable_win64_console.exe';
const editor = opt('editor', 'http://127.0.0.1:5174');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
const out = resolve(opt('out', join('work', 'compare', 'layers', engine === 'unreal' ? `${name}-ue-t${tick}` : `${name}-t${tick}`)));
mkdirSync(out, { recursive: true });
const W = 960, H = 540;

// Layers: every renderer the export carries (IR emitters + particle trails), editor node id <-> Godot node name.
const doc = JSON.parse(readFileSync(resolve(spec.doc), 'utf8'));
const ir = unrealEffectFrom(doc);
if (!ir.ok) throw new Error(ir.message);
const nodeIds = Object.values(doc.graphs).flatMap(g => g.nodes.map(n => n.id));
const idOf = irName => nodeIds.find(id => id.replace(/[^A-Za-z0-9_]/g, '_') === irName);
// A renderer on several paths (PathFollower) exports one emitter per path: <name>, <name>_path2, ... - all one layer.
const byNode = new Map();
// Unreal: names come from the imported package (what the importer actually built), ribbons as their baked slices
// (at most 6, MaxRibbonSlices; a slice that does not exist only logs a warning) and lights as their own emitters.
const uePkg = engine === 'unreal' ? JSON.parse(readFileSync(join(resolve(opt('ue-pkg', '')), 'effect.json'), 'utf8')) : null;
const renderers = uePkg
  ? [...uePkg.emitters.map(e => [e.name, [e.name]]), ...(uePkg.trails ?? []).map(t => [t.name, [`${t.name}_Trail`]]),
    ...(uePkg.ribbons ?? []).map(r => [r.name, [0, 1, 2, 3, 4, 5].map(k => `${r.name}_s${k}`)]), ...(uePkg.lights ?? []).map(l => [l.name, [l.name]])]
  : [...ir.value.emitters.map(e => [e.name, [e.name]]), ...(ir.value.trails ?? []).map(t => [t.name, [`${t.name}_Trail`]])];
for (const [irName, names] of renderers) {
  const id = idOf(irName.replace(/_path\d+$/, ''));
  if (id) byNode.set(id, [...(byNode.get(id) ?? []), ...names]);
}
const all = [...byNode].map(([editor, nodes]) => ({ editor, godot: nodes.join(',') }));
const wanted = opt('layers')?.split(',');
const layers = wanted ? all.filter(l => wanted.includes(l.editor)) : all;
if (!layers.length) throw new Error(`no layers (have: ${all.map(l => l.editor).join(', ')})`);

const docUrl = '/' + resolve(spec.doc).slice(ROOT.length + 1).replace(/\\/g, '/');
const cam = spec.camera;
function editorShot(solo, glow, png) {
  const capture = captureRun(ROOT, tick, editor);
  rmSync(png, { force: true });
  const url = `${editor}/capture.html?doc=${encodeURIComponent(docUrl)}&tick=${tick}&cam=${cam.position.join(',')}&look=${cam.target.join(',')}&fov=${cam.fov ?? 50}&solo=${encodeURIComponent(solo)}&glow=${glow}`;
  spawnSync(chrome, ['--headless=new', '--hide-scrollbars', `--window-size=${W},${H}`, '--virtual-time-budget=20000', `--screenshot=${png}`, `${url}&run=${capture.run}`], { timeout: 60_000, killSignal: 'SIGKILL' });
  if (!existsSync(png)) throw new Error(`editor capture failed (${solo})`);
  capture.check(png);
}
function godotShot(keep, glow, png) {
  const dir = join(out, 'godot-movie');
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  // Movie Maker needs an ABSOLUTE path; frame N is tick N.
  const r = spawnSync(GODOT, ['--path', project, '--write-movie', join(dir, 'f.png'), '--fixed-fps', '60', '--quit-after', String(tick + 2), '--', name, keep, glow === 1 ? '' : 'noglow'], { encoding: 'utf8', timeout: 180_000 });
  const frame = join(dir, `f${String(tick).padStart(8, '0')}.png`);
  if (!existsSync(frame)) throw new Error(`godot frame ${tick} missing (${keep}): ${(r.stderr || r.stdout || '').slice(-600)}`);
  const s = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', frame, png]);
  if (s.status !== 0) throw new Error('ffmpeg copy failed');
}
// Unreal: every shot of one glow pass in ONE editor run (each launch costs ~40 s); returns keep -> png.
function unrealBatch(keeps, tag) {
  const UE = process.env.VFX_UE_ROOT ?? 'F:/EpicGames/UE_5.8';
  const project = process.env.VFX_UE_TEST_PROJECT ?? 'F:/Dev2/UnrealVFXLab/UnrealVFXLab.uproject';
  const capDir = join(out, 'ue-cap');
  rmSync(capDir, { recursive: true, force: true }); mkdirSync(capDir, { recursive: true });
  const shots = keeps.map(k => k === '__none__' ? '-' : k === '' ? '*' : k);
  // Editor metres (Y up) -> Unreal cm (Z up) around the Source, where the system actor stands (VFX_ACTOR_Z = its height).
  const src = doc.anchors.find(a => a.id === 'source')?.position ?? [0, 0, 0];
  const ue = p => [(p[0] - src[0]) * 100, (p[2] - src[2]) * 100, p[1] * 100].map(v => v.toFixed(2)).join(',');
  const hfov = 2 * Math.atan(Math.tan(((cam.fov ?? 50) * Math.PI) / 360) * W / H) * 180 / Math.PI; // three.js fov is vertical
  const env = { ...process.env, MSYS_NO_PATHCONV: '1', VFX_NS: `${opt('ue-dest')}/NS_${uePkg.name.replace(/[^A-Za-z0-9_]/g, '_')}`, VFX_OUT: capDir,
    VFX_SECONDS: (tick / 60).toFixed(6), VFX_ACTOR_Z: String(src[1] * 100), VFX_CAM_POS: ue(cam.position), VFX_CAM_LOOK: ue(cam.target),
    VFX_FOV: hfov.toFixed(3), VFX_EMITTERS: [...new Set([...byNode.values()].flat())].join(','), VFX_SHOTS: shots.join(';') };
  spawnSync(join(UE, 'Engine/Binaries/Win64/UnrealEditor.exe'), [project, '-windowed', '-WinX=-4000', '-WinY=0', '-ResX=1280', '-ResY=720', '-nosplash', '-NoLiveCoding',
    '-ini:EditorPerProjectUserSettings:[/Script/UnrealEd.EditorPerformanceSettings]:bThrottleCPUWhenNotForeground=False',
    `-ExecCmds=py ${join(ROOT, 'tools', 'unreal-capture.py')}`, '-log'], { env, timeout: 900_000 });
  const pngs = new Map();
  keeps.forEach((k, i) => {
    const f = join(capDir, `unreal_capture_${i}`), png = join(out, `ue-${i}-${tag}.png`);
    if (!existsSync(f)) throw new Error(`unreal shot ${i} (${shots[i]}) missing: see ${join(project, '..', 'Saved', 'Logs')} VFXCAP lines`);
    if (spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', f, png]).status !== 0) throw new Error('ffmpeg copy failed');
    pngs.set(k, png);
  });
  return pngs;
}
const raw = file => spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${W}:${H}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 1 << 28 }).stdout;
function measure(png, plate) {
  const a = raw(png), b = raw(plate);
  let sum = 0, lit = 0, peak = 0, white = 0, sat = 0; const rgb = [0, 0, 0];
  for (let i = 0; i < W * H; i++) {
    const c = [0, 1, 2].map(k => a[i * 3 + k] / 255), p = [0, 1, 2].map(k => b[i * 3 + k] / 255);
    const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], yp = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    const d = Math.max(0, y - yp);
    sum += d; peak = Math.max(peak, d);
    if (d > 0.05) {
      lit++;
      const mx = Math.max(...c), mn = Math.min(...c);
      if (mn >= 0.9) white++;
      sat += mx > 0 ? (mx - mn) / mx : 0;
      for (let k = 0; k < 3; k++) rgb[k] += Math.max(0, c[k] - p[k]);
    }
  }
  const r3 = x => +x.toFixed(3);
  return { addedLuma: +(sum / (W * H)).toFixed(5), litArea: +(lit / (W * H)).toFixed(4), peak: r3(peak), white: lit ? r3(white / lit) : 0, sat: lit ? r3(sat / lit) : 0, rgb: rgb.map(v => r3(lit ? v / lit : 0)) };
}

const glows = engine === 'unreal' ? [0] : opt('glow', 'both') === 'both' ? [1, 0] : [Number(opt('glow'))];
const results = [];
for (const glow of glows) {
  const tag = glow ? 'glow' : 'noglow';
  // The engine side: Godot renders each shot on demand; Unreal renders the whole pass up front in one editor run.
  const ueShots = engine === 'unreal' ? unrealBatch(['__none__', ...layers.map(l => l.godot), ''], tag) : null;
  const engineShot = (keep, png) => ueShots ? spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', ueShots.get(keep), png]) : godotShot(keep, glow, png);
  editorShot('__none__', glow, join(out, `editor-plate-${tag}.png`));
  engineShot('__none__', join(out, `godot-plate-${tag}.png`));
  for (const l of layers) {
    const ep = join(out, `editor-${l.editor}-${tag}.png`), gp = join(out, `godot-${l.editor}-${tag}.png`);
    editorShot(l.editor, glow, ep);
    engineShot(l.godot, gp);
    const e = measure(ep, join(out, `editor-plate-${tag}.png`)), g = measure(gp, join(out, `godot-plate-${tag}.png`));
    results.push({ layer: l.editor, glow: !!glow, editor: e, godot: g, lumaRatio: e.addedLuma ? +(g.addedLuma / e.addedLuma).toFixed(2) : null });
    console.log(`${tag} ${l.editor}: luma editor ${e.addedLuma} ${engine} ${g.addedLuma} (x${results.at(-1).lumaRatio}) | white ${e.white} / ${g.white} | sat ${e.sat} / ${g.sat}`);
  }
  // Everything at once, for reference.
  editorShot('', glow, join(out, `editor-ALL-${tag}.png`));
  engineShot('', join(out, `godot-ALL-${tag}.png`));
  const e = measure(join(out, `editor-ALL-${tag}.png`), join(out, `editor-plate-${tag}.png`)), g = measure(join(out, `godot-ALL-${tag}.png`), join(out, `godot-plate-${tag}.png`));
  results.push({ layer: 'ALL', glow: !!glow, editor: e, godot: g, lumaRatio: e.addedLuma ? +(g.addedLuma / e.addedLuma).toFixed(2) : null });
  console.log(`${tag} ALL: luma editor ${e.addedLuma} ${engine} ${g.addedLuma} | white ${e.white} / ${g.white} | sat ${e.sat} / ${g.sat}`);
}
rmSync(join(out, 'godot-movie'), { recursive: true, force: true });
writeFileSync(join(out, 'metrics.json'), JSON.stringify({ name, tick, engine, camera: cam, results }, null, 1));
const md = [`| layer | glow | editor luma | ${engine} luma | ${engine}/editor | white e / g | sat e / g | peak e / g | rgb editor | rgb ${engine} |`, '|---|---|---|---|---|---|---|---|---|---|',
  ...results.map(r => `| ${r.layer} | ${r.glow ? 'on' : 'off'} | ${r.editor.addedLuma} | ${r.godot.addedLuma} | ${r.lumaRatio ?? '-'} | ${r.editor.white} / ${r.godot.white} | ${r.editor.sat} / ${r.godot.sat} | ${r.editor.peak} / ${r.godot.peak} | ${r.editor.rgb.join(', ')} | ${r.godot.rgb.join(', ')} |`)].join('\n');
writeFileSync(join(out, 'metrics.md'), md + '\n');
// Sheet: one row per layer (glow on), editor | godot, cropped to the middle half of the frame for size.
const rows = [...layers.map(l => l.editor), 'ALL'];
const tag = glows.includes(1) ? 'glow' : 'noglow';
const inputs = rows.flatMap(r => ['-i', join(out, `editor-${r}-${tag}.png`), '-i', join(out, `godot-${r}-${tag}.png`)]);
const fc = rows.map((r, k) => `[${2 * k}:v]scale=${W / 2}:${H / 2}[e${k}];[${2 * k + 1}:v]scale=${W / 2}:${H / 2}[g${k}];[e${k}][g${k}]hstack[row${k}]`).join(';');
spawnSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${fc};${rows.map((_, k) => `[row${k}]`).join('')}vstack=${rows.length}`, join(out, 'sheet.png')]);
console.log(md);
console.log(`sheet ${join(out, 'sheet.png')} (rows: ${rows.join(', ')}; left editor, right ${engine}, glow ${tag === 'glow' ? 'on' : 'off'})`);
