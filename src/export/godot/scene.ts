// Godot 4 export: our effect -> a text scene (.tscn) of GPUParticles3D nodes driven by an AnimationPlayer.
//
// Built from the engine-neutral IR the Unreal exporter already produces (src/export/unreal/fromPlan.ts: rates, bursts,
// shapes, forces, life curves, flipbooks, lights, moving sources), converted back to Godot's units: Godot is metres,
// right-handed, +Y up like VFX Studio, so the conversion is just cm -> m and Unreal's Y/Z swap undone. Unlike Niagara's
// stock templates, Godot's ParticleProcessMaterial takes size, colour and alpha over life as curves directly, so those
// export exactly. Timing (when each emitter runs, when bursts fire, a moving source, light intensity) lives in one
// "play" animation that autoplays. The scene origin is the Source anchor.
import type { UeEmitter, UeLight, UeParticleTrail, UeRibbon, UnrealEffect } from '../unreal/types.ts';
import { VFX_RIBBONS_GD } from './vfx_ribbons.gd.ts';

/** Linear -> sRGB encoding, also above 1 (Godot decodes source_color values with the same curve). */
export const srgbEncode = (l: number) => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);

/** A trail whose particle rides the moving source (a projectile's comet tail): drawn by the camera-facing rider shader. */
const ridesAnchor = (e: UeEmitter) => !!(e.attachToSource && e.sourceTrack?.length && e.shape.kind === 'point'
  && e.speedCmSMax === 0 && e.acceleration.every(v => v === 0) && !e.noise && !e.vortex && !e.attract);

/** The editor's trail strip (RIBBON_FRAGMENT, additive softness 1): brightness across the width 1 - smoothstep(0, 1, |v|). */
function softBand(res: Resources): string {
  const xs = Array.from({ length: 17 }, (_, i) => i / 16);
  const v = (x: number) => { const u = Math.abs(2 * x - 1); return 1 - u * u * (3 - 2 * u); };
  const g = res.add('Gradient', [`offsets = PackedFloat32Array(${xs.map(n).join(', ')})`, `colors = PackedColorArray(${xs.map(x => { const c = n(v(x)); return `${c}, ${c}, ${c}, 1.0`; }).join(', ')})`]);
  return res.add('GradientTexture2D', [`gradient = ${g}`, 'width = 64', 'height = 2', 'fill_from = Vector2(0, 0)', 'fill_to = Vector2(1, 0)']);
}

/** Feeds the camera position to the rider trails' process shaders, which turn each ribbon section to face it. */
export const VFX_TRAILS_GD = `extends Node
## VFX Studio export: keeps the particle trails' ribbons facing the camera like the editor's trail strips
## (each listed trail's process shader turns its sections toward cam_pos).
@export var trails: Array[NodePath] = []

func _process(_delta: float) -> void:
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	for p in trails:
		var node := get_node_or_null(p) as GPUParticles3D
		if node != null and node.process_material is ShaderMaterial:
			(node.process_material as ShaderMaterial).set_shader_parameter("cam_pos", cam.global_position)
`;
const srgbDecode = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export type GodotReportItem = { level: 'approximated' | 'dropped' | 'info'; item: string; message: string };
export type GodotScene = { name: string; tscn: string; textures: string[]; report: GodotReportItem[]; resPath: string;
  /** Extra text files of the package (beams: ribbons.json + vfx_ribbons.gd), relative to the package folder. */
  files: { path: string; text: string }[] };

type V3 = [number, number, number];
/** Unreal IR (cm, x, y=our z, z=our y) -> Godot (m, x, y up, z). */
const fromUe = (p: readonly number[]): V3 => [p[0] / 100, p[2] / 100, p[1] / 100];
const dirFromUe = (p: readonly number[]): V3 => { const v: V3 = [p[0], p[2], p[1]]; const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const n = (x: number) => { const r = Math.round(x * 10000) / 10000; return Number.isInteger(r) ? `${r}.0` : String(r); };
const vec3 = (v: readonly number[]) => `Vector3(${n(v[0])}, ${n(v[1])}, ${n(v[2])})`;
const str = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const nodeName = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_') || 'Emitter';
const seedOf = (name: string) => [...name].reduce((hash, c) => (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0, 1);

class Resources {
  ext: string[] = []; sub: string[] = []; private ids = new Map<string, string>(); private count = 0;
  extTexture(path: string): string { return this.extOf('Texture2D', path); }
  extOf(type: string, path: string): string {
    const key = `ext:${path}`;
    if (!this.ids.has(key)) { const id = `${this.ids.size + 1}_${type === 'Script' ? 'script' : 'tex'}`; this.ids.set(key, id); this.ext.push(`[ext_resource type="${type}" path=${str(path)} id="${id}"]`); }
    return `ExtResource("${this.ids.get(key)}")`;
  }
  add(type: string, body: string[]): string {
    const id = `${type}_${++this.count}`;
    this.sub.push(`[sub_resource type="${type}" id="${id}"]\n${body.join('\n')}`);
    return `SubResource("${id}")`;
  }
}

/** A Godot Curve over life 0..1 (values may exceed 1: max_value is raised to fit). */
function curve(res: Resources, keys: { t: number; v: number }[], texture = true): string {
  const pts = keys.length ? keys : [{ t: 0, v: 1 }, { t: 1, v: 1 }];
  const max = Math.max(1, ...pts.map(k => k.v)), min = Math.min(0, ...pts.map(k => k.v));
  const data = pts.map(k => `Vector2(${n(k.t)}, ${n(k.v)}), 0.0, 0.0, 1, 1`).join(', ');
  const c = res.add('Curve', [`min_value = ${n(min)}`, `max_value = ${n(max)}`, `_data = [${data}]`, `point_count = ${pts.length}`]);
  return texture ? res.add('CurveTexture', [`curve = ${c}`]) : c;
}

/** Colour ramp over life: colour keys (sRGB) and the opacity curve merged onto shared offsets. */
function colorRamp(res: Resources, e: Pick<UeEmitter, 'colorOverLife' | 'opacityOverLife'>, trail = false): string {
  const ts = [...new Set([...e.colorOverLife.map(k => k.t), ...e.opacityOverLife.map(k => k.t), 0, 1])].sort((a, b) => a - b);
  const at = <K extends { t: number }>(keys: K[], t: number, pick: (k: K) => number[]): number[] => {
    if (!keys.length) return pick({ t } as K).map(() => 1);
    if (t <= keys[0].t) return pick(keys[0]);
    for (let i = 1; i < keys.length; i++) if (t <= keys[i].t) {
      const a = keys[i - 1], b = keys[i], u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0, pa = pick(a), pb = pick(b);
      return pa.map((x, j) => x + (pb[j] - x) * u);
    }
    return pick(keys[keys.length - 1]);
  };
  const colors = ts.map(t => {
    const [r, g, b] = e.colorOverLife.length ? at(e.colorOverLife, t, k => [k.r, k.g, k.b]) : [1, 1, 1];
    const [a] = e.opacityOverLife.length ? at(e.opacityOverLife, t, k => [k.v]) : [1];
    return [r, g, b, a].map(n).join(', ');
  });
  const g = res.add('Gradient', [`offsets = PackedFloat32Array(${ts.map(n).join(', ')})`, `colors = PackedColorArray(${colors.join(', ')})`]);
  // RibbonTrailMesh UV.y goes from head (0) to tail (1); the IR curves go tail -> head.
  return trail ? res.add('GradientTexture2D', [`gradient = ${g}`, 'width = 2', 'height = 256', 'use_hdr = true',
    'fill_from = Vector2(0, 1)', 'fill_to = Vector2(0, 0)']) : res.add('GradientTexture1D', [`gradient = ${g}`]);
}

// interp 0 = nearest (holds each key until the next: UeStepTrack values), 1 = linear (positions).
type Track = { path: string; interp: 0 | 1; update: 0 | 1; keys: [number, string][] };

function emitterNode(res: Resources, e: UeEmitter, texRoot: string, duration: number, tracks: Track[], report: GodotReportItem[], trail?: UeParticleTrail): string {
  const name = nodeName(trail ? `${trail.name}_Trail` : e.name);
  const lifeMax = Math.max(0.017, e.lifetimeSecMax), lifeMin = Math.min(lifeMax, Math.max(0.017, e.lifetimeSecMin));
  const speedMin = e.speedCmSMin / 100, speedMax = e.speedCmSMax / 100, speedAvg = (speedMin + speedMax) / 2;
  const dir = dirFromUe(e.direction);
  // ---- process material: spawn shape, velocity, forces, life curves ----
  const ppm: string[] = [`direction = ${vec3(dir)}`, `initial_velocity_min = ${n(speedMin)}`, `initial_velocity_max = ${n(speedMax)}`,
    `gravity = ${vec3(fromUe(e.acceleration))}`, `lifetime_randomness = ${n(1 - lifeMin / lifeMax)}`];
  const s = e.shape;
  if (s.kind === 'sphere') ppm.push('emission_shape = 1', `emission_sphere_radius = ${n(s.radiusCm / 100)}`, 'spread = 180.0');
  else if (s.kind === 'box') ppm.push('emission_shape = 3', `emission_box_extents = ${vec3(fromUe(s.extentsCm).map(Math.abs))}`, 'spread = 0.0');
  else if (s.kind === 'disc') ppm.push('emission_shape = 6', `emission_ring_axis = ${vec3(dir)}`, `emission_ring_radius = ${n(s.radiusCm / 100)}`, 'emission_ring_inner_radius = 0.0', 'emission_ring_height = 0.0', 'spread = 0.0');
  else if (s.kind === 'cone') ppm.push(`spread = ${n(s.angleDeg)}`, ...(s.radiusCm > 0.5 ? ['emission_shape = 1', `emission_sphere_radius = ${n(s.radiusCm / 100)}`] : []));
  else ppm.push('spread = 0.0');
  if (e.drag > 0) {
    // Godot damping is a constant deceleration (m/s^2), ours is proportional to speed. Match the DISTANCE travelled over
    // a lifetime, v0 (1 - e^-kL) / k = v0^2 / 2d: matching the initial slow-down (d = k v0) stopped particles at half
    // the editor's reach, bunched at the start (feature grid drag row, 2026-10-29).
    const L = (lifeMin + lifeMax) / 2, reach = (1 - Math.exp(-e.drag * L)) / e.drag;
    const d = speedAvg / (2 * Math.max(1e-3, reach));
    ppm.push(`damping_min = ${n(d * 0.8)}`, `damping_max = ${n(d * 1.2)}`);
    report.push({ level: 'approximated', item: e.name, message: 'Drag (proportional to speed) becomes Godot damping (a constant deceleration matched to the distance travelled).' });
  }
  if (e.noise) {
    // Godot turbulence steers velocity toward a noise field (influence 0..1): far stronger than our additive curl noise,
    // so keep the influence small (3 m/s^2 of noise -> ~0.03), or a fast jet turns into a slow drifting wall.
    const amp = e.noise.amplitudeCmS2 / 100;
    ppm.push('turbulence_enabled = true', 'turbulence_noise_strength = 1.0', `turbulence_noise_scale = ${n(Math.max(0.5, Math.min(10, 1 / Math.max(0.05, e.noise.frequency))))}`,
      `turbulence_influence_min = ${n(Math.min(0.08, amp / 120))}`, `turbulence_influence_max = ${n(Math.min(0.12, amp / 80))}`);
    report.push({ level: 'approximated', item: e.name, message: 'Curl noise becomes Godot turbulence (strength matched roughly; check the look).' });
  }
  // Attraction: a GPUParticlesAttractorSphere3D at the point, attenuation 0 = the same pull everywhere inside its radius
  // (the editor's pull is near-constant outside the soft radius). Attractors act on every particle node sharing a
  // visual layer, so each attracted emitter gets its own layer bit (2..20) and its attractor that cull mask.
  let attractor = '', layerBit = 0;
  if (e.attract) {
    const k = (attractorCount.get(res) ?? 0) + 1;
    attractorCount.set(res, k);
    if (k <= 19) {
      layerBit = 1 << k;
      attractor = [`[node name=${str(`${name}_attract`)} type="GPUParticlesAttractorSphere3D" parent="."]`, `position = ${vec3(fromUe(e.attract.positionCm))}`,
        `strength = ${n(e.attract.strengthCmS2 / 100)}`, 'attenuation = 0.0', 'radius = 50.0', `cull_mask = ${layerBit}`].join('\n');
      report.push({ level: 'approximated', item: e.name, message: 'Attraction becomes a GPUParticlesAttractorSphere3D (constant pull, no kill radius).' });
    } else report.push({ level: 'dropped', item: e.name, message: 'Attraction is not exported (more than 19 attracted emitters; add a GPUParticlesAttractorSphere3D by hand).' });
  }
  if (e.vortex) report.push({ level: 'dropped', item: e.name, message: 'Vortex swirl is not exported (add a GPUParticlesAttractorVectorField3D or turbulence by hand).' });
  // Ground collision: the process collides with the scene's floor box (godotSceneFrom adds one GPUParticlesCollisionBox3D).
  if (e.groundCollision) {
    const gc = e.groundCollision;
    ppm.push(`collision_mode = ${gc.mode === 'kill' ? 2 : 1}`, `collision_bounce = ${n(gc.mode === 'bounce' ? gc.restitution : 0)}`, 'collision_friction = 0.5', 'collision_use_scale = false');
    report.push({ level: 'approximated', item: e.name, message: 'Ground collision collides with a GPUParticlesCollisionBox3D floor (stop = no bounce).' });
  }
  // Size: quad is 1 m; scale_min/max = birth size, the curve multiplies over life (keys relative to the mid size).
  // The curve is normalised to 0..1 (Godot clamps curve values to its range) and its peak moves into scale_min/max.
  const mid = Math.max(1e-4, (e.sizeCmMin + e.sizeCmMax) / 2);
  const factors = e.sizeOverLife.map(k => ({ t: k.t, v: k.v / mid })), sizePeak = Math.max(1e-4, ...factors.map(k => k.v), factors.length ? 0 : 1);
  const sMin = (e.sizeCmMin / 100) * (factors.length ? sizePeak : 1), sMax = (e.sizeCmMax / 100) * (factors.length ? sizePeak : 1);
  // Trail width is authored independently of the head's sprite size/life curves.
  ppm.push(`scale_min = ${n(trail ? 1 : sMin)}`, `scale_max = ${n(trail ? 1 : sMax)}`);
  if (!trail && factors.length) ppm.push(`scale_curve = ${curve(res, factors.map(k => ({ t: k.t, v: k.v / sizePeak })))}`);
  if (!trail) ppm.push(`color_ramp = ${colorRamp(res, e)}`);
  if (e.spinDegMin || e.spinDegMax) ppm.push(`angle_min = ${n(e.spinDegMin)}`, `angle_max = ${n(e.spinDegMax)}`);
  if (e.angularVelocityDegSMin || e.angularVelocityDegSMax) ppm.push(`angular_velocity_min = ${n(e.angularVelocityDegSMin)}`, `angular_velocity_max = ${n(e.angularVelocityDegSMax)}`);
  const velocity = !trail && e.alignment === 'velocity';
  // Flat quads (editor worldAxis, lying on the ground): no billboard, a Y-facing quad spun about Y (feature grid 2026-10-29).
  const flat = !trail && !velocity && !!e.facingAxis && Math.abs(e.facingAxis[2]) > 0.9;
  if (!trail && !velocity && e.facingAxis && !flat) report.push({ level: 'approximated', item: e.name, message: 'A flat quad facing a sideways axis is drawn as a camera-facing billboard.' });
  if (flat) ppm.push('particle_flag_rotate_y = true');
  // Trails too: the ribbon's width axes are the particle's X/Z, so Y must follow the motion (see the rider shader below).
  if (velocity || trail) ppm.push('particle_flag_align_y = true');
  const fb = trail ? undefined : e.flipbook;
  if (fb && (fb.columns > 1 || fb.rows > 1)) {
    const frames = fb.columns * fb.rows, meanLife = (lifeMin + lifeMax) / 2;
    // Variants sheets are static cells even when SpriteRenderer's generic mode says overLife.
    const staticFrame = fb.variantFrame ?? (fb.fps === 0 ? fb.startFrame : undefined);
    const speed = staticFrame !== undefined ? 0 : fb.fps > 0 ? (fb.fps * meanLife) / frames : 0;
    ppm.push(`anim_speed_min = ${n(speed)}`, `anim_speed_max = ${n(speed)}`);
    if (staticFrame !== undefined && staticFrame >= 0) {
      ppm.push(`anim_offset_min = ${n(staticFrame / frames)}`, `anim_offset_max = ${n(staticFrame / frames)}`);
    } else if (fb.randomStartFrame || staticFrame === -1) ppm.push('anim_offset_max = 1.0');
  }
  let process = res.add('ParticleProcessMaterial', ppm);
  const followsAnchor = !!trail && ridesAnchor(e);
  if (followsAnchor) {
    // A local-space trail would move its entire history with the anchor. These stationary
    // attached riders instead follow EMISSION_TRANSFORM in world space, so Godot skins the
    // ribbon against the actual previous world positions. The head remains a local sprite.
    const shader = res.add('Shader', ['code = ' + str(`shader_type particles;
render_mode disable_force, disable_velocity;
uniform vec3 cam_pos = vec3(0.0, 2.0, 8.0);
void start() {
  TRANSFORM = EMISSION_TRANSFORM;
  COLOR = vec4(1.0);
  CUSTOM = vec4(0.0);
}
void process() {
  // A trail ribbon takes its width from the particle's basis at each history point (RibbonTrailMesh runs along local
  // Y, the flat strip along X). Copying EMISSION_TRANSFORM's identity basis put the width ALONG a bolt flying in X:
  // a hairline instead of a 13-34 cm tail; a cross-shaped strip overlapped itself into a doubled white core
  // (tools/layer-brightness.mjs, 2026-10-17). Y follows the motion, X faces the camera (vfx_trails.gd sets cam_pos):
  // the editor's camera-facing trail strip.
  vec3 d = EMISSION_TRANSFORM[3].xyz - TRANSFORM[3].xyz;
  if (dot(d, d) > 1e-10) {
    vec3 y = normalize(d);
    vec3 x = cross(y, cam_pos - EMISSION_TRANSFORM[3].xyz);
    if (dot(x, x) < 1e-10) { x = cross(abs(y.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), y); }
    x = normalize(x);
    TRANSFORM[0].xyz = x;
    TRANSFORM[1].xyz = y;
    TRANSFORM[2].xyz = cross(x, y);
  }
  TRANSFORM[3].xyz = EMISSION_TRANSFORM[3].xyz;
  CUSTOM.y += DELTA / LIFETIME;
  if (CUSTOM.y >= 1.0) { ACTIVE = false; }
}`)]);
    process = res.add('ShaderMaterial', [`shader = ${shader}`]);
  }
  if (trail && e.attachToSource && e.sourceTrack?.length && !followsAnchor)
    report.push({ level: 'approximated', item: trail.name, message: 'Attached particles with independent spawn/motion retain local-space trail history; anchor motion is represented exactly only for stationary point riders.' });
  // ---- draw material: unshaded billboard, additive or alpha blend, colour from the ramp (vertex colour) ----
  // The IR colours are sRGB like the editor's; the editor linearises them (billboardLife srgbToLinear) and Godot only does
  // when vertex_color_is_srgb is set - without it every layer drew 2-6x brighter and washed toward white (the "white-hot
  // cores", measured per layer with tools/layer-brightness.mjs, 2026-10-17).
  const mat = [`transparency = 1`, `blend_mode = ${(trail?.blend ?? e.blend) === 'additive' ? 1 : 0}`, 'shading_mode = 0', 'vertex_color_use_as_albedo = true', 'vertex_color_is_srgb = true',
    // Velocity-aligned: no billboard + Align Y (Godot's Y-billboard uses world up, so it would stand every flame upright).
    `billboard_mode = ${trail || velocity || flat ? 0 : 3}`, 'billboard_keep_scale = true', 'cull_mode = 2'];
  if (!trail && e.emission) {
    // albedo_color is decoded sRGB -> linear by Godot: encode the editor's LINEAR (1 + emission) gain (1.5 stayed 2.53).
    const gain = n(srgbEncode(1 + e.emission));
    mat.push(`albedo_color = Color(${gain}, ${gain}, ${gain}, 1)`);
  }
  if (trail) {
    // The ramp is an HDR float texture, which Godot samples WITHOUT the sRGB decode of albedo textures: it holds the
    // editor's linear colour x (1 + emission) (sRGB values here drew the pink sheath nearly white, 2026-10-17).
    const gain = 1 + (trail.emission ?? 0);
    mat.push('use_particle_trails = true', `albedo_texture = ${colorRamp(res, {
      colorOverLife: trail.colorOverTrail.map(k => ({ ...k, r: srgbDecode(k.r) * gain, g: srgbDecode(k.g) * gain, b: srgbDecode(k.b) * gain })),
      opacityOverLife: trail.opacityOverTrail,
    }, true)}`);
    if (trail.textureFile) mat.push('detail_enabled = true', 'detail_blend_mode = 3', `detail_albedo = ${res.extTexture(`${texRoot}/${trail.textureFile}`)}`);
    // Untextured additive trails: the editor's soft transverse falloff (a flat full-width strip drew ~2x the light).
    else if (trail.blend === 'additive') mat.push('detail_enabled = true', 'detail_blend_mode = 3', `detail_albedo = ${softBand(res)}`);
  } else if (e.textureFile) mat.push(`albedo_texture = ${res.extTexture(`${texRoot}/${e.textureFile}`)}`);
  if (fb && (fb.columns > 1 || fb.rows > 1)) mat.push(`particles_anim_h_frames = ${fb.columns}`, `particles_anim_v_frames = ${fb.rows}`, `particles_anim_loop = ${fb.loop}`);
  const material = res.add('StandardMaterial3D', mat);
  const sections = trail ? Math.max(2, Math.min(128, trail.maxPoints - 1)) : 0;
  const quad = trail ? res.add('RibbonTrailMesh', [`material = ${material}`, ...(followsAnchor ? ['shape = 0'] : []), `size = ${n(trail.widthCm / 100)}`,
    `sections = ${sections}`, 'section_segments = 1', `section_length = ${n(Math.max(0.001, speedAvg * trail.lifetimeSec / sections))}`,
    `curve = ${curve(res, trail.widthOverTrail.map(k => ({ t: 1 - k.t, v: k.v })).reverse(), false)}`])
    // Velocity stretch: like the editor's billboard, the quad is r times longer along its local +Y (= the velocity with
    // Align Y; image top = leading tip) and offset so the particle sits at the pivot (0 tail, 1 tip). Without it the
    // Charge motes (x6) were 2-3 cm dots instead of streaks (Godot side-by-side 2026-10-17).
    : velocity && e.stretchRatio > 1.05 ? res.add('QuadMesh', [`material = ${material}`, `size = Vector2(1, ${n(e.stretchRatio)})`,
      `center_offset = ${vec3([0, (0.5 - (e.pivot ?? 0.5)) * e.stretchRatio, 0])}`])
    : flat ? res.add('QuadMesh', [`material = ${material}`, 'orientation = 1'])
    : res.add('QuadMesh', [`material = ${material}`]);
  // ---- timing: continuous rate or one burst ----
  const node: string[] = [`[node name=${str(name)} type="GPUParticles3D" parent="."]`];
  const peak = Math.max(0, ...e.rateOverTime.map(([, v]) => v));
  const t = (tick: number) => Math.min(duration, tick) / 60;
  if (peak > 0) {
    node.push(`amount = ${Math.max(1, Math.ceil(peak * lifeMax))}`);
    tracks.push({ path: `${name}:emitting`, interp: 0, update: 1, keys: [[0, 'false'], ...e.rateOverTime.map(([tick, v]) => [t(tick), v > 0 ? 'true' : 'false'] as [number, string])] });
    if (new Set(e.rateOverTime.map(([, v]) => v).filter(v => v > 0)).size > 1)
      tracks.push({ path: `${name}:amount_ratio`, interp: 0, update: 0, keys: e.rateOverTime.filter(([, v]) => v > 0).map(([tick, v]) => [t(tick), n(v / peak)] as [number, string]) });
  } else if (e.bursts.length) {
    const b = e.bursts[0];
    node.push(`amount = ${Math.max(1, b.count)}`, 'one_shot = true', 'explosiveness = 1.0');
    tracks.push({ path: `${name}:emitting`, interp: 0, update: 1, keys: [[0, 'false'], [t(b.tick), 'true']] });
    if (e.bursts.length > 1) report.push({ level: 'approximated', item: e.name, message: `${e.bursts.length} bursts: only the first is exported as a one-shot burst.` });
  } else {
    node.push('amount = 1');
    report.push({ level: 'dropped', item: e.name, message: 'No rate or burst: the emitter is exported but never emits.' });
  }
  node.push('emitting = false', `lifetime = ${n(lifeMax)}`, 'fixed_fps = 60', 'interpolate = true', `local_coords = ${e.attachToSource && !followsAnchor ? 'true' : 'false'}`,
    `position = ${vec3(fromUe(e.position))}`, 'visibility_aabb = AABB(-20, -20, -20, 40, 40, 40)', `process_material = ${process}`, `draw_pass_1 = ${quad}`);
  // Skinning affects every draw pass, so keep the head on its own node. Duplicate the spawn/motion
  // process with the same seed and timing instead of a sub-emitter (which introduces a birth delay).
  // Size/colour differ, but do not change spawn/velocity random sampling in ParticleProcessMaterial.
  node.push('use_fixed_seed = true', `seed = ${seedOf(trail?.parentEmitterName ?? e.name)}`);
  if (layerBit) node.push(`layers = ${layerBit}`);
  if (trail) node.push('trail_enabled = true', `trail_lifetime = ${n(Math.max(0.017, trail.lifetimeSec))}`);
  if (e.sourceTrack?.length) tracks.push({ path: `${name}:position`, interp: 1, update: 0, keys: e.sourceTrack.map(([tick, p]) => [t(tick), vec3(fromUe(p))] as [number, string]) });
  if (velocity && e.stretchRatio > 1.05) report.push({ level: 'approximated', item: e.name, message: `Velocity stretch x${e.stretchRatio} is a quad that long along the velocity (Align Y); unlike the editor it does not turn to face the camera.` });
  return attractor ? `${node.join('\n')}\n\n${attractor}` : node.join('\n');
}
const attractorCount = new WeakMap<Resources, number>();
/** Above this many positioned bursts an emitter stays one node (a steady stream from its origin) to bound the scene size. */
const MAX_PLACED_BURSTS = 16;

/**
 * Preview light intensity (candela) -> Godot OmniLight3D light_energy. The editor's three.js PointLight is physical:
 * diffuse = I x albedo / pi / d^2 (decay 2). Godot (non-physical units) multiplies energy by pi and its Lambert divides
 * by pi, so with omni_attenuation 2 (inverse square) energy = I / pi matches. The former 0.06 with Godot's default 1/d
 * falloff lit the floor ~5x dimmer than the editor at 1 m (layer-brightness, 2026-10-19).
 */
export const GODOT_LIGHT_ENERGY_SCALE = 1 / Math.PI;

function lightNode(l: UeLight, duration: number, tracks: Track[], name = nodeName(l.name)): string {
  const peak = Math.max(0, ...l.intensity.map(([, v]) => v));
  const node = [`[node name=${str(name)} type="OmniLight3D" parent="."]`, `light_color = Color(${l.color.map(n).join(', ')}, 1)`,
    `omni_range = ${n(Math.max(0.1, l.radiusCm / 100))}`, 'omni_attenuation = 2.0', `light_energy = 0.0`, `position = ${vec3(fromUe(l.positionCm))}`];
  // Step track: linear interpolation ramped Bolt's impact light 0 -> 50 from tick 0 instead of switching it on at its
  // impact tick (a floor pool 16 ticks early, layer-brightness 2026-10-19). Ramps are per-tick keys already.
  if (peak > 0) tracks.push({ path: `${name}:light_energy`, interp: 0, update: 0, keys: [[0, '0.0'], ...l.intensity.map(([tick, v]) => [Math.min(duration, tick) / 60, n(v * GODOT_LIGHT_ENERGY_SCALE)] as [number, string])] });
  if (l.sourceTrack?.length) tracks.push({ path: `${name}:position`, interp: 1, update: 0, keys: l.sourceTrack.map(([tick, p]) => [Math.min(duration, tick) / 60, vec3(fromUe(p))] as [number, string]) });
  return node.join('\n');
}

/** Builds the scene text. `resRoot` is where the package folder lives in the Godot project (textures under it). */
export function godotSceneFrom(e: UnrealEffect, resRoot = `res://vfx_studio/${e.name}`): GodotScene {
  const res = new Resources(), tracks: Track[] = [], report: GodotReportItem[] = [];
  const duration = e.durationTicks;
  const nodes = [`[node name=${str(nodeName(e.name))} type="Node3D"]`];
  for (const em of e.emitters) {
    // Bursts born at their own positions (children where a parent particle died): one one-shot node per burst at that
    // point. As a single emitter they streamed from its origin, the floor (feature grid sub-emitter row, 2026-10-29).
    const placed = em.bursts.filter(b => b.count > 0);
    if (placed.some(b => b.positionCm) && placed.length <= MAX_PLACED_BURSTS) {
      placed.forEach((b, i) => nodes.push(emitterNode(res, { ...em, name: `${em.name}_b${i + 1}`, position: b.positionCm ?? em.position, rateOverTime: [],
        bursts: [{ tick: b.tick, count: b.count }], sourceTrack: undefined }, `${resRoot}/Textures`, duration, tracks, report)));
      report.push({ level: 'approximated', item: em.name, message: `${placed.length} bursts at their own positions become ${placed.length} one-shot emitters.` });
      continue;
    }
    nodes.push(emitterNode(res, em, `${resRoot}/Textures`, duration, tracks, report));
  }
  for (const trail of e.trails ?? []) nodes.push(emitterNode(res, trail.emitter, `${resRoot}/Textures`, duration, tracks, report, trail));
  // A light on several paths (Nova's 8 shards) is one IR light per path under the same name: same-named sibling nodes
  // left the animation driving only one of them (Nova's floor light 0.34x, 2026-10-19). Like emitters: <name>_path<k>.
  const lightNames = new Map<string, number>();
  for (const l of e.lights) {
    const k = (lightNames.get(l.name) ?? 0) + 1;
    lightNames.set(l.name, k);
    nodes.push(lightNode(l, duration, tracks, nodeName(k > 1 ? `${l.name}_path${k}` : l.name)));
  }
  const floor = [...e.emitters, ...(e.trails ?? []).map(t => t.emitter)].find(em => em.groundCollision)?.groundCollision;
  if (floor) nodes.push(['[node name="FloorCollision" type="GPUParticlesCollisionBox3D" parent="."]', `position = Vector3(0, ${n(floor.groundZCm / 100 - 0.5)}, 0)`, 'size = Vector3(60, 1, 60)'].join('\n'));
  const files: GodotScene['files'] = [];
  if (e.ribbons.length) {
    // Beams: baked per-tick geometry (every path: trunk + branches, with its flicker/decay opacity) drawn by a small
    // script as camera-facing strips, synced to the "play" animation.
    files.push({ path: 'ribbons.json', text: ribbonsJson(e.ribbons, `${resRoot}/Textures`) }, { path: 'vfx_ribbons.gd', text: VFX_RIBBONS_GD });
    const script = res.extOf('Script', `${resRoot}/vfx_ribbons.gd`);
    nodes.push(`[node name="Ribbons" type="Node3D" parent="."]\nscript = ${script}\ndata_path = ${str(`${resRoot}/ribbons.json`)}`);
    report.push({ level: 'info', item: 'ribbons', message: `${e.ribbons.length} beam/ribbon layer(s) are drawn by vfx_ribbons.gd from ribbons.json (baked per frame, camera-facing strips; no texture scrolling or distortion).` });
  }
  const riders = (e.trails ?? []).filter(tr => ridesAnchor(tr.emitter)).map(tr => `${nodeName(tr.name)}_Trail`);
  if (riders.length) {
    files.push({ path: 'vfx_trails.gd', text: VFX_TRAILS_GD });
    const script = res.extOf('Script', `${resRoot}/vfx_trails.gd`);
    nodes.push(`[node name="TrailFacing" type="Node" parent="."]\nscript = ${script}\ntrails = Array[NodePath]([${riders.map(r => `NodePath(${str(`../${r}`)})`).join(', ')}])`);
  }
  // Carry the Unreal IR's own notes that still apply (meshes, flashes, keyframes, many bursts, multi-path...).
  for (const r of e.report) if (!/Niagara|Unreal|importer|UE 5|Shape Location/i.test(r.message)) report.push(r);
  if (e.trails?.length) report.push({ level: 'info', item: 'trails', message: `${e.trails.length} particle trail layer(s) use separate seeded GPUParticles3D nodes with RibbonTrailMesh skinning.` });
  report.push({ level: 'info', item: 'scale', message: 'Godot uses metres and +Y up like VFX Studio; the scene origin is the Source anchor. The "play" animation autoplays; call $AnimationPlayer.play("play") to fire it again.' });
  // A burst at tick zero replaces the initial disabled key. Duplicate timestamps can select
  // the disabled value instead of starting a one-particle long-lived sprite.
  for (const tr of tracks) tr.keys = [...new Map(tr.keys).entries()].sort((a, b) => a[0] - b[0]);
  const trackLines = tracks.flatMap((tr, i) => [
    `tracks/${i}/type = "value"`, `tracks/${i}/imported = false`, `tracks/${i}/enabled = true`, `tracks/${i}/path = NodePath(${str(tr.path)})`,
    `tracks/${i}/interp = ${tr.interp}`, `tracks/${i}/loop_wrap = true`,
    `tracks/${i}/keys = {\n"times": PackedFloat32Array(${tr.keys.map(k => n(k[0])).join(', ')}),\n"transitions": PackedFloat32Array(${tr.keys.map(() => '1').join(', ')}),\n"update": ${tr.update},\n"values": [${tr.keys.map(k => k[1]).join(', ')}]\n}`,
  ]);
  const anim = res.add('Animation', [`resource_name = "play"`, `length = ${n(duration / 60)}`, ...trackLines]);
  const lib = res.add('AnimationLibrary', [`_data = {\n&"play": ${anim}\n}`]);
  nodes.push(`[node name="AnimationPlayer" type="AnimationPlayer" parent="."]\nlibraries = {\n&"": ${lib}\n}\nautoplay = &"play"`);
  const tscn = [`[gd_scene load_steps=${res.ext.length + res.sub.length + 1} format=3]`, '', ...res.ext, ...(res.ext.length ? [''] : []),
    ...res.sub.flatMap(s => [s, '']), ...nodes.flatMap(x => [x, ''])].join('\n');
  return { name: e.name, tscn, textures: e.textures, report, resPath: resRoot, files };
}

export function godotReportMarkdown(g: GodotScene): string {
  const lines = [`# Godot export: ${g.name}`, '', `Scene: \`${g.name}.tscn\` (copy this folder to \`${g.resPath}/\`).`, ''];
  for (const [level, title] of [['dropped', 'Left out'], ['approximated', 'Approximated'], ['info', 'Notes']] as const) {
    const items = g.report.filter(r => r.level === level);
    if (!items.length) continue;
    lines.push(`## ${title}`, '');
    const folded = new Map<string, string[]>();
    for (const r of items) folded.set(r.message, [...(folded.get(r.message) ?? []), r.item]);
    for (const [m, where] of folded) lines.push(`- ${m} (${[...new Set(where)].join(', ')})`);
    lines.push('');
  }
  return lines.join('\n');
}

export function godotReadme(g: GodotScene): string {
  return [`# ${g.name} — Godot 4 export`, '',
    `1. Copy this folder into your Godot 4 project as \`${g.resPath}/\` (the scene's texture paths point there).`,
    `2. Open the project; Godot imports the textures.`,
    `3. Instance \`${g.name}.tscn\` where the effect should start (its origin is the caster / nozzle). It plays once on load;`,
    '   call `$AnimationPlayer.play("play")` on the instance to play it again.',
    '', 'Size, colour and fade over each particle\'s life are exact (Godot curves). Beams (if any) are drawn by vfx_ribbons.gd',
    'from ribbons.json: when exporting a game, add *.json to the export resource filter. See report.md for what changed.', ''].join('\n');
}

/** Ribbon layers as compact JSON for vfx_ribbons.gd: Godot metres (+Y up), flat [x, y, z, width] per point. */
function ribbonsJson(ribbons: UeRibbon[], texRoot: string): string {
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const layers = ribbons.map(b => ({
    name: b.name,
    // Per-path alpha already includes the layer opacity: the layer colour carries RGB only.
    color: [b.color.r, b.color.g, b.color.b, 1],
    additive: b.blend === 'additive',
    endFade: b.endFade ?? 0,
    emission: b.emission ?? 0,
    softness: b.softness ?? 0,
    ...(b.textureFile ? {
      texture: `${texRoot}/${b.textureFile}`, grid: b.sheetGrid ?? [1, 1], cell: Math.max(0, b.cell ?? 0),
      tile: (b.tileCm ?? 0) / 100, scroll: b.scroll ?? [0, 0],
    } : {}),
    frames: b.frames.map(f => ({
      tick: f.tick,
      paths: (f.paths ?? (f.points.length ? [{ points: f.points, alpha: 1 }] : [])).map(p => ({
        a: p.alpha,
        ...('cell' in p && p.cell !== undefined ? { c: p.cell } : {}),
        p: p.points.flatMap(q => [r(q[0] / 100), r(q[2] / 100), r(q[1] / 100), r(q[3] / 100)]),
      })),
    })),
  }));
  return JSON.stringify({ format: 'vfx-studio-ribbons', version: 1, ticksPerSecond: 60, layers });
}
