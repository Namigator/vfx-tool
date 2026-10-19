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
	# The editor's backdrop 0x0b0d12 (Godot colours here are sRGB like three's hex).
	e.background_color = Color(0.043, 0.051, 0.071)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	# The editor's fill: AmbientLight 0.6 + HemisphereLight sky 0xbfd0ff 0.8 (up-facing floor) through three's Lambert
	# (/pi) = linear (0.324, 0.352, 0.446); Godot's ambient has no /pi. Plus the key light below. The old 0.25 grey left
	# the floor ~20x darker than the editor's, and the ACES toe then swallowed the effect's floor light (2026-10-19).
	e.ambient_light_color = Color(0.60, 0.625, 0.70)
	# Same post as the editor (PreviewViewport: ACES filmic, UnrealBloom strength 0.8 radius 0.45 threshold 1): without
	# it over-bright cores clipped to flat white discs and thin bright lines stayed hairlines (2026-10-17).
	e.tonemap_mode = Environment.TONE_MAPPER_ACES
	# three's ACESFilmic = the same Hill fit as Godot's ACES but with exposure 1/0.6 and no white normalisation; Godot
	# bakes in exposure 1.8 and divides by f(1.8 * white). Exposure 1/(0.6*1.8) and white 14.26 (f(25.67) = 1) give the
	# identical curve (2026-10-19; the former white 6 ran ~11% brighter in the mids).
	e.tonemap_exposure = 1.0 / (0.6 * 1.8)
	e.tonemap_white = 14.26
	e.glow_enabled = true
	# Derived from the two pipelines, not by eye (2026-10-19). three's UnrealBloom (strength 0.8, radius 0.45, threshold 1,
	# glow limit 3) takes a pixel's FULL colour once its luminance passes 1 and adds 5 blurred mips weighted
	# 0.8 * mix(f, 1.2 - f, 0.45) = 0.51, 0.50, 0.48, 0.46, 0.45 (sum 2.4). Godot passes colour x smoothstep(threshold,
	# threshold + hdr_scale, max channel): the default hdr_scale 2 let almost nothing through once the sRGB fix put cores
	# at 1-2 (glow added ~1% of the frame vs the editor's ~80%). hdr_scale 0.01 = three's step; cap 3 = the glow limit.
	# Blur radii: three's mips are sigma 6/20/56/144/352 px at full res; Godot's cascaded levels ~5/9/18/37/74/148/296,
	# so each mip's weight goes to the level(s) of matching size, intensity 1.
	e.glow_intensity = 1.0
	e.glow_strength = 1.0
	e.glow_bloom = 0.0
	e.glow_hdr_threshold = 1.0
	e.glow_hdr_scale = 0.01
	e.glow_hdr_luminance_cap = 3.0
	e.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	var levels := [0.256, 0.256, 0.496, 0.24, 0.24, 0.464, 0.448]
	for lv in range(1, 8):
		e.set_glow_level(lv - 1, levels[lv - 1])
	env.environment = e
	add_child(env)
	# The editor's key: DirectionalLight 0xfff4e6 2.6 from (3, 6, 4); Godot energy x pi / pi Lambert -> 2.6 / pi.
	var key := DirectionalLight3D.new()
	key.light_color = Color(1.0, 0.957, 0.902)
	key.light_energy = 2.6 / PI
	add_child(key)
	key.look_at_from_position(Vector3(3, 6, 4), Vector3.ZERO)
	var floor := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(16, 10)
	floor.mesh = plane
	var m := StandardMaterial3D.new()
	# The editor's ground: 0x10131a x pi/1.4 linear (= sRGB 0.110, 0.126, 0.164), roughness 0.85. The effect's floor
	# light pool scales with this albedo.
	m.albedo_color = Color(0.110, 0.126, 0.164)
	m.roughness = 0.85
	floor.material_override = m
	floor.position = Vector3(c.pos[0], c.floorY, 0)
	add_child(floor)
	var fx: Node = load(c.scene).instantiate()
	add_child(fx)
	# Per-layer measurement (tools/layer-brightness.mjs): args[1] = comma list of the effect's child nodes to keep
	# ("__none__" = none: the empty plate; "" = all), args[2] = "noglow" turns the glow off.
	if args.size() > 1 and args[1] != "":
		var keep: PackedStringArray = args[1].split(",")
		for ch in fx.get_children():
			if (ch is GeometryInstance3D or ch is Light3D or String(ch.name) == "Ribbons") and not keep.has(String(ch.name)):
				ch.visible = false
	if args.size() > 2 and args[2] == "noglow":
		e.glow_enabled = false
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
