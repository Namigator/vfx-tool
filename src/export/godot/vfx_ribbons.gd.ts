// The GDScript shipped with every Godot export that has beams/ribbons (written to <package>/vfx_ribbons.gd).
// It reads the baked per-tick ribbon geometry (ribbons.json), follows the scene's "play" animation and redraws each
// layer as camera-facing triangle strips (ImmediateMesh) with a small spatial shader that mirrors the editor's ribbon
// fragment shader (PreviewViewport.ts RIBBON_FRAGMENT): one sheet cell per path (not the whole atlas), tiled or
// stretched along the path, UV scroll, the soft transverse edge of untextured strips, smooth end fades by arc length
// and emission. Kept as a TS string so the exporter and the editor can both write it without file access.
export const VFX_RIBBONS_GD = `extends Node3D
## VFX Studio export: draws the effect's beams/ribbons (lightning, streams, rings) from baked per-tick geometry,
## in sync with the sibling AnimationPlayer's "play" animation. Data: a JSON file next to this script.

@export_file("*.json") var data_path: String
@export var player_path: NodePath = ^"../AnimationPlayer"

# UV = (arc length along the path in metres, -1..1 across the strip); UV2 = (path length in metres, sheet cell).
const SHADER := """
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, shadows_disabled, %s;
uniform sampler2D tex : source_color, filter_linear, repeat_disable;
uniform bool use_tex = false;
uniform vec2 grid = vec2(1.0);
uniform float softness = 0.0;
uniform float tile = 0.0;
uniform vec2 scroll = vec2(0.0);
uniform float emission = 0.0;
uniform float fade = 0.0;
uniform float time_s = 0.0;
vec3 to_linear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
void fragment() {
	float len = UV2.x;
	float a = COLOR.a;
	vec3 rgb = to_linear(COLOR.rgb);
	if (use_tex) {
		float u = tile > 0.0 ? UV.x / tile : clamp(UV.x / max(len, 0.000001), 0.0, 1.0);
		float va = UV.y * 0.5 + 0.5;
		u += scroll.x * time_s;
		va += scroll.y * time_s;
		if (tile > 0.0 || scroll.x != 0.0) { u = fract(u); }
		float cell = min(UV2.y, grid.x * grid.y - 1.0);
		float col = mod(cell, grid.x);
		float row = floor(cell / grid.x);
		vec2 cu = clamp(vec2(u, scroll.y != 0.0 ? fract(va) : va), 0.002, 0.998);
		vec4 t = texture(tex, vec2((col + cu.x) / grid.x, (row + 1.0 - cu.y) / grid.y));
		rgb *= t.rgb;
		a *= t.a;
	} else if (softness > 0.0) {
		a *= 1.0 - smoothstep(1.0 - softness, 1.0, abs(UV.y));
	}
	float fl = fade * len;
	if (fl > 0.000001) {
		float e = min(1.0, min(UV.x, len - UV.x) / fl);
		a *= e * e * (3.0 - 2.0 * e);
	}
	ALBEDO = rgb * (1.0 + emission);
	ALPHA = a;
}
"""

var _layers: Array = []

func _ready() -> void:
	var f := FileAccess.open(data_path, FileAccess.READ)
	if f == null:
		push_warning("vfx_ribbons: cannot read %s" % data_path)
		return
	var data = JSON.parse_string(f.get_as_text())
	if typeof(data) != TYPE_DICTIONARY:
		push_warning("vfx_ribbons: bad data in %s" % data_path)
		return
	var shaders := {}
	for layer in data.layers:
		var blend := "blend_add" if layer.additive else "blend_mix"
		if not shaders.has(blend):
			var sh := Shader.new()
			sh.code = SHADER % blend
			shaders[blend] = sh
		var mat := ShaderMaterial.new()
		mat.shader = shaders[blend]
		mat.set_shader_parameter("fade", float(layer.endFade))
		mat.set_shader_parameter("emission", float(layer.get("emission", 0.0)))
		mat.set_shader_parameter("softness", float(layer.get("softness", 0.0)))
		var cell := 0
		if layer.has("texture") and layer.texture != "":
			mat.set_shader_parameter("tex", load(layer.texture))
			mat.set_shader_parameter("use_tex", true)
			var g: Array = layer.get("grid", [1, 1])
			mat.set_shader_parameter("grid", Vector2(g[0], g[1]))
			mat.set_shader_parameter("tile", float(layer.get("tile", 0.0)))
			var s: Array = layer.get("scroll", [0, 0])
			mat.set_shader_parameter("scroll", Vector2(s[0], s[1]))
			cell = int(layer.get("cell", 0))
		var mesh := ImmediateMesh.new()
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		mi.material_override = mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
		var c: Array = layer.color
		_layers.append({"frames": layer.frames, "mesh": mesh, "mat": mat, "color": Color(c[0], c[1], c[2], c[3]), "cell": cell})

func _process(_delta: float) -> void:
	var player := get_node_or_null(player_path) as AnimationPlayer
	var tick := -1
	if player != null and player.is_playing():
		tick = int(floor(player.current_animation_position * 60.0))
	var cam := get_viewport().get_camera_3d()
	for layer in _layers:
		var mesh: ImmediateMesh = layer.mesh
		mesh.clear_surfaces()
		if tick < 0 or cam == null:
			continue
		layer.mat.set_shader_parameter("time_s", tick / 60.0)
		var frame = null
		for fr in layer.frames:
			if int(fr.tick) <= tick:
				frame = fr
			else:
				break
		if frame == null:
			continue
		var cam_local := global_transform.affine_inverse() * cam.global_position
		for path in frame.paths:
			# A random cell per path (cell -1 in the editor) comes baked per path as "c".
			_strip(mesh, path, layer.color, int(path.get("c", layer.cell)), cam_local)

func _strip(mesh: ImmediateMesh, path: Dictionary, color: Color, cell: int, cam_local: Vector3) -> void:
	var p: Array = path.p
	var n := p.size() / 4
	if n < 2:
		return
	var arc := PackedFloat32Array()
	arc.resize(n)
	for i in range(1, n):
		arc[i] = arc[i - 1] + Vector3(p[i * 4] - p[i * 4 - 4], p[i * 4 + 1] - p[i * 4 - 3], p[i * 4 + 2] - p[i * 4 - 2]).length()
	var total := arc[n - 1]
	var c := Color(color.r, color.g, color.b, color.a * float(path.a))
	mesh.surface_begin(Mesh.PRIMITIVE_TRIANGLE_STRIP)
	for i in n:
		var a := Vector3(p[i * 4], p[i * 4 + 1], p[i * 4 + 2])
		var j0 := maxi(i - 1, 0)
		var j1 := mini(i + 1, n - 1)
		var tangent := Vector3(p[j1 * 4] - p[j0 * 4], p[j1 * 4 + 1] - p[j0 * 4 + 1], p[j1 * 4 + 2] - p[j0 * 4 + 2]).normalized()
		var side := tangent.cross((cam_local - a).normalized()).normalized() * (float(p[i * 4 + 3]) * 0.5)
		for k in [-1.0, 1.0]:
			mesh.surface_set_color(c)
			mesh.surface_set_uv(Vector2(arc[i], k))
			mesh.surface_set_uv2(Vector2(total, cell))
			mesh.surface_add_vertex(a + side * k)
	mesh.surface_end()
`;
