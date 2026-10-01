#!/usr/bin/env node
// Renders a Godot export so it can be looked at: node tools/godot-check.mjs <package-dir> [seconds=1.0]
//
// Builds a throwaway Godot 4 project in work/godot-test/ (dark floor, side camera, glow), copies the package to
// res://vfx_studio/<name>/, instances the scene at Source height (the export's origin is the Source anchor), imports the
// textures (--headless --import) and renders with Godot's movie writer (--write-movie, fixed 60 fps) until <seconds>.
// The frame at <seconds> is copied to work/godot/<name>.png. This script does not judge the image: read it.
// Godot: VFX_GODOT, else the console build in the user's Downloads (nothing is installed by this script).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const pkg = process.argv[2];
const seconds = Number(process.argv[3] ?? '1.0');
if (!pkg || !existsSync(pkg)) { console.error('usage: node tools/godot-check.mjs <package-dir> [seconds]'); process.exit(2); }
const GODOT = process.env.VFX_GODOT ?? 'C:/Users/itonk/Downloads/Godot_v4.6.2-stable_win64.exe/Godot_v4.6.2-stable_win64_console.exe';
if (!existsSync(GODOT)) { console.error(`godot-check: Godot not found at ${GODOT} (set VFX_GODOT).`); process.exit(2); }
const scene = readdirSync(pkg).find(f => f.endsWith('.tscn'));
if (!scene) { console.error('godot-check: no .tscn in the package'); process.exit(2); }
const name = scene.replace(/\.tscn$/, '');

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const proj = join(root, 'work', 'godot-test');
rmSync(proj, { recursive: true, force: true });
mkdirSync(join(proj, 'vfx_studio'), { recursive: true });
cpSync(resolve(pkg), join(proj, 'vfx_studio', name), { recursive: true });
writeFileSync(join(proj, 'project.godot'), `config_version=5

[application]
config/name="VFX Studio export check"
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=960
window/size/viewport_height=540
`);
writeFileSync(join(proj, 'main.tscn'), `[gd_scene load_steps=6 format=3]

[ext_resource type="PackedScene" path="res://vfx_studio/${name}/${name}.tscn" id="1_fx"]

[sub_resource type="Environment" id="Environment_1"]
background_mode = 1
background_color = Color(0.03, 0.035, 0.05, 1)
ambient_light_source = 2
ambient_light_color = Color(0.25, 0.27, 0.32, 1)
glow_enabled = true
glow_intensity = 0.8
glow_bloom = 0.1

[sub_resource type="StandardMaterial3D" id="Mat_floor"]
albedo_color = Color(0.12, 0.13, 0.15, 1)

[sub_resource type="PlaneMesh" id="Plane_1"]
material = SubResource("Mat_floor")
size = Vector2(24, 16)

[sub_resource type="BoxMesh" id="Box_1"]
size = Vector3(0.4, 0.4, 0.4)

[node name="Main" type="Node3D"]

[node name="WorldEnvironment" type="WorldEnvironment" parent="."]
environment = SubResource("Environment_1")

[node name="Sun" type="DirectionalLight3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 0.7, 0.7, 0, -0.7, 0.7, 0, 5, 0)
light_energy = 0.4

[node name="Floor" type="MeshInstance3D" parent="."]
mesh = SubResource("Plane_1")

[node name="Ref" type="MeshInstance3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.2, -2.5)
mesh = SubResource("Box_1")

[node name="Camera3D" type="Camera3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 0.989, 0.145, 0, -0.145, 0.989, 2.2, 2.0, 6.2)
fov = 36.0

[node name="Effect" parent="." instance=ExtResource("1_fx")]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1.2, 0)
`);

const run = (label, args, timeout) => {
  const r = spawnSync(GODOT, args, { encoding: 'utf8', timeout });
  const errors = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').filter(l => /ERROR|SCRIPT ERROR|Parse Error|Failed/i.test(l)).slice(0, 12);
  console.log(`[godot-check] ${label}: exit ${r.status}${errors.length ? `\n  ${errors.join('\n  ')}` : ''}`);
  return r;
};
run('import', ['--headless', '--path', proj, '--import'], 180_000);
const frames = join(proj, 'frames');
mkdirSync(frames, { recursive: true });
const count = Math.max(1, Math.round(seconds * 60));
run('render', ['--path', proj, '--write-movie', join(frames, 'f.png'), '--fixed-fps', '60', '--quit-after', String(count + 1), '--resolution', '960x540', '--position', '-4000,0'], 300_000);
const all = existsSync(frames) ? readdirSync(frames).filter(f => f.endsWith('.png')).sort() : [];
if (!all.length) { console.error('[godot-check] no frames written'); process.exit(1); }
const pick = all[Math.min(all.length - 1, count)];
mkdirSync(join(root, 'work', 'godot'), { recursive: true });
const dest = join(root, 'work', 'godot', `${basename(resolve(pkg))}.png`);
copyFileSync(join(frames, pick), dest);
console.log(`[godot-check] ${all.length} frames; wrote ${dest} (${pick}). Read it: this script does not judge the image.`);
