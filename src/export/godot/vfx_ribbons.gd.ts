// The GDScript shipped with every Godot export that has beams/ribbons (written to <package>/vfx_ribbons.gd).
// It reads the baked per-tick ribbon geometry (ribbons.json), follows the scene's "play" animation and redraws each
// layer as camera-facing triangle strips (ImmediateMesh): width along the path, end fade, per-frame opacity
// (flicker/decay), additive or alpha blending, optional texture. Kept as a TS string so the exporter and the
// editor can both write it without file access.
export const VFX_RIBBONS_GD = `extends Node3D
## VFX Studio export: draws the effect's beams/ribbons (lightning, streams, rings) from baked per-tick geometry,
## in sync with the sibling AnimationPlayer's "play" animation. Data: a JSON file next to this script.

@export_file("*.json") var data_path: String
@export var player_path: NodePath = ^"../AnimationPlayer"

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
	for layer in data.layers:
		var mat := StandardMaterial3D.new()
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD if layer.additive else BaseMaterial3D.BLEND_MODE_MIX
		mat.vertex_color_use_as_albedo = true
		mat.vertex_color_is_srgb = true
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED
		mat.no_depth_test = false
		if layer.has("texture") and layer.texture != "":
			mat.albedo_texture = load(layer.texture)
		var mesh := ImmediateMesh.new()
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		mi.material_override = mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
		var c: Array = layer.color
		_layers.append({"frames": layer.frames, "mesh": mesh, "color": Color(c[0], c[1], c[2], c[3]), "fade": float(layer.endFade)})

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
			_strip(mesh, path, layer.color, layer.fade, cam_local)

func _strip(mesh: ImmediateMesh, path: Dictionary, color: Color, fade: float, cam_local: Vector3) -> void:
	var p: Array = path.p
	var n := p.size() / 4
	if n < 2:
		return
	var alpha := float(path.a)
	mesh.surface_begin(Mesh.PRIMITIVE_TRIANGLE_STRIP)
	for i in n:
		var a := Vector3(p[i * 4], p[i * 4 + 1], p[i * 4 + 2])
		var j0 := maxi(i - 1, 0)
		var j1 := mini(i + 1, n - 1)
		var tangent := Vector3(p[j1 * 4] - p[j0 * 4], p[j1 * 4 + 1] - p[j0 * 4 + 1], p[j1 * 4 + 2] - p[j0 * 4 + 2]).normalized()
		var side := tangent.cross((cam_local - a).normalized()).normalized() * (float(p[i * 4 + 3]) * 0.5)
		var u := float(i) / float(n - 1)
		var edge := 1.0
		if fade > 0.0:
			edge = clampf(minf(u, 1.0 - u) / fade, 0.0, 1.0)
		var c := Color(color.r, color.g, color.b, color.a * alpha * edge)
		mesh.surface_set_color(c)
		mesh.surface_set_uv(Vector2(u, 0.0))
		mesh.surface_add_vertex(a - side)
		mesh.surface_set_color(c)
		mesh.surface_set_uv(Vector2(u, 1.0))
		mesh.surface_add_vertex(a + side)
	mesh.surface_end()
`;
