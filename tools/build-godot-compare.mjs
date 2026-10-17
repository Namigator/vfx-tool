// Builds a Godot 4 project that renders exported effects for side-by-side comparison with the tool:
//   node --experimental-strip-types tools/build-godot-compare.mjs <projectDir> <spec.json>
// spec.json is the same as tools/build-roblox-compare.mjs ({ name, doc, ticks, camera } in tool metres).
// Then per effect (Movie Maker renders every frame deterministically at 60 fps):
//   Godot_console.exe --path <projectDir> --write-movie out/<name>/f.png --fixed-fps 60 --quit-after <maxTick+2> -- <name>
// Frame N of the movie is tick N. The exported scene's origin is the Source anchor, so cameras are converted to
// Source-relative metres here.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unrealEffectFrom } from '../src/export/unreal/fromPlan.ts';
import { godotSceneFrom } from '../src/export/godot/scene.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [outDir, specPath] = process.argv.slice(2);
if (!outDir || !specPath) { console.error('usage: build-godot-compare.mjs <projectDir> <spec.json>'); process.exit(2); }
const out = resolve(outDir);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const cams = {};
for (const e of spec) {
  const doc = JSON.parse(readFileSync(e.doc, 'utf8'));
  const r = unrealEffectFrom(doc);
  if (!r.ok) { console.error(`${e.name}: ${r.message}`); continue; }
  const g = godotSceneFrom(r.value);
  const dir = join(out, 'vfx_studio', g.name);
  mkdirSync(join(dir, 'Textures'), { recursive: true });
  writeFileSync(join(dir, `${g.name}.tscn`), g.tscn);
  for (const f of g.files) { mkdirSync(dirname(join(dir, f.path)), { recursive: true }); writeFileSync(join(dir, f.path), f.text); }
  for (const t of g.textures) copyFileSync(join(ROOT, 'assets', 'sprites', t), join(dir, 'Textures', t));
  const src = doc.anchors.find(a => a.id === 'source').position;
  const rel = p => p.map((v, k) => Number((v - src[k]).toFixed(3)));
  cams[e.name] = { scene: `res://vfx_studio/${g.name}/${g.name}.tscn`, pos: rel(e.camera.position), target: rel(e.camera.target), fov: e.camera.fov ?? 50, ticks: e.ticks, floorY: -src[1] };
  console.log(`${e.name}: ${g.name} (${Math.max(...e.ticks) + 2} frames)`);
}
writeFileSync(join(out, 'cams.json'), JSON.stringify(cams, null, 1));
writeFileSync(join(out, 'project.godot'), `config_version=5

[application]
config/name="VFXCompare"
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=960
window/size/viewport_height=540

[rendering]
renderer/rendering_method="forward_plus"
`);
writeFileSync(join(out, 'main.gd'), `extends Node3D
# Loads the effect named on the command line (after --), places the camera from cams.json and lets the effect play.
func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var cams: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://cams.json"))
	var c: Dictionary = cams[args[0]]
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.03, 0.03, 0.04)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.25, 0.25, 0.3)
	# Same post as the editor (PreviewViewport: ACES filmic, UnrealBloom strength 0.8 radius 0.45 threshold 1): without
	# it over-bright cores clipped to flat white discs and thin bright lines stayed hairlines (2026-10-18).
	e.tonemap_mode = Environment.TONE_MAPPER_ACES
	e.glow_enabled = true
	# Matched by eye on Nova/Bolt/Summon: Godot's glow sums levels, so the editor's 0.8 over-blooms here.
	e.glow_intensity = 0.35
	e.glow_strength = 1.0
	e.glow_bloom = 0.0
	e.glow_hdr_threshold = 1.0
	e.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	for lv in range(1, 8):
		e.set_glow_level(lv, 1.0 if lv >= 2 and lv <= 4 else 0.0)
	env.environment = e
	add_child(env)
	var floor := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(16, 10)
	floor.mesh = plane
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.1, 0.11, 0.13)
	floor.material_override = m
	floor.position = Vector3(c.pos[0], c.floorY, 0)
	add_child(floor)
	var fx: Node = load(c.scene).instantiate()
	add_child(fx)
	var cam := Camera3D.new()
	cam.fov = c.fov
	add_child(cam)
	cam.look_at_from_position(Vector3(c.pos[0], c.pos[1], c.pos[2]), Vector3(c.target[0], c.target[1], c.target[2]))
	cam.current = true
`);
writeFileSync(join(out, 'main.tscn'), `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://main.gd" id="1"]

[node name="Main" type="Node3D"]
script = ExtResource("1")
`);
