// Godot 4 export: our effect -> a text scene (.tscn) of GPUParticles3D nodes driven by an AnimationPlayer.
//
// Built from the engine-neutral IR the Unreal exporter already produces (src/export/unreal/fromPlan.ts: rates, bursts,
// shapes, forces, life curves, flipbooks, lights, moving sources), converted back to Godot's units: Godot is metres,
// right-handed, +Y up like VFX Studio, so the conversion is just cm -> m and Unreal's Y/Z swap undone. Unlike Niagara's
// stock templates, Godot's ParticleProcessMaterial takes size, colour and alpha over life as curves directly, so those
// export exactly. Timing (when each emitter runs, when bursts fire, a moving source, light intensity) lives in one
// "play" animation that autoplays. The scene origin is the Source anchor.
import type { UeEmitter, UeLight, UnrealEffect } from '../unreal/types.ts';

export type GodotReportItem = { level: 'approximated' | 'dropped' | 'info'; item: string; message: string };
export type GodotScene = { name: string; tscn: string; textures: string[]; report: GodotReportItem[]; resPath: string };

type V3 = [number, number, number];
/** Unreal IR (cm, x, y=our z, z=our y) -> Godot (m, x, y up, z). */
const fromUe = (p: readonly number[]): V3 => [p[0] / 100, p[2] / 100, p[1] / 100];
const dirFromUe = (p: readonly number[]): V3 => { const v: V3 = [p[0], p[2], p[1]]; const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const n = (x: number) => { const r = Math.round(x * 10000) / 10000; return Number.isInteger(r) ? `${r}.0` : String(r); };
const vec3 = (v: readonly number[]) => `Vector3(${n(v[0])}, ${n(v[1])}, ${n(v[2])})`;
const str = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const nodeName = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_') || 'Emitter';

class Resources {
  ext: string[] = []; sub: string[] = []; private ids = new Map<string, string>(); private count = 0;
  extTexture(path: string): string {
    const key = `ext:${path}`;
    if (!this.ids.has(key)) { const id = `${this.ids.size + 1}_tex`; this.ids.set(key, id); this.ext.push(`[ext_resource type="Texture2D" path=${str(path)} id="${id}"]`); }
    return `ExtResource("${this.ids.get(key)}")`;
  }
  add(type: string, body: string[]): string {
    const id = `${type}_${++this.count}`;
    this.sub.push(`[sub_resource type="${type}" id="${id}"]\n${body.join('\n')}`);
    return `SubResource("${id}")`;
  }
}

/** A Godot Curve over life 0..1 (values may exceed 1: max_value is raised to fit). */
function curve(res: Resources, keys: { t: number; v: number }[]): string {
  const pts = keys.length ? keys : [{ t: 0, v: 1 }, { t: 1, v: 1 }];
  const max = Math.max(1, ...pts.map(k => k.v)), min = Math.min(0, ...pts.map(k => k.v));
  const data = pts.map(k => `Vector2(${n(k.t)}, ${n(k.v)}), 0.0, 0.0, 1, 1`).join(', ');
  const c = res.add('Curve', [`min_value = ${n(min)}`, `max_value = ${n(max)}`, `_data = [${data}]`, `point_count = ${pts.length}`]);
  return res.add('CurveTexture', [`curve = ${c}`]);
}

/** Colour ramp over life: colour keys (sRGB) and the opacity curve merged onto shared offsets. */
function colorRamp(res: Resources, e: UeEmitter): string {
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
  return res.add('GradientTexture1D', [`gradient = ${g}`]);
}

type Track = { path: string; interp: 0 | 1; update: 0 | 1; keys: [number, string][] };

function emitterNode(res: Resources, e: UeEmitter, texRoot: string, duration: number, tracks: Track[], report: GodotReportItem[]): string {
  const name = nodeName(e.name);
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
    // Godot damping is a constant deceleration (m/s^2), ours is proportional to speed: match the initial slow-down.
    const d = e.drag * speedAvg;
    ppm.push(`damping_min = ${n(d * 0.8)}`, `damping_max = ${n(d * 1.2)}`);
    report.push({ level: 'approximated', item: e.name, message: 'Drag (proportional to speed) becomes Godot damping (a constant deceleration matched at launch speed).' });
  }
  if (e.noise) {
    // Godot turbulence steers velocity toward a noise field (influence 0..1): far stronger than our additive curl noise,
    // so keep the influence small (3 m/s^2 of noise -> ~0.03), or a fast jet turns into a slow drifting wall.
    const amp = e.noise.amplitudeCmS2 / 100;
    ppm.push('turbulence_enabled = true', 'turbulence_noise_strength = 1.0', `turbulence_noise_scale = ${n(Math.max(0.5, Math.min(10, 1 / Math.max(0.05, e.noise.frequency))))}`,
      `turbulence_influence_min = ${n(Math.min(0.08, amp / 120))}`, `turbulence_influence_max = ${n(Math.min(0.12, amp / 80))}`);
    report.push({ level: 'approximated', item: e.name, message: 'Curl noise becomes Godot turbulence (strength matched roughly; check the look).' });
  }
  if (e.attract) report.push({ level: 'dropped', item: e.name, message: 'Attraction is not exported (add a GPUParticlesAttractorSphere3D by hand).' });
  if (e.vortex) report.push({ level: 'dropped', item: e.name, message: 'Vortex swirl is not exported (add a GPUParticlesAttractorVectorField3D or turbulence by hand).' });
  if (e.groundCollision) report.push({ level: 'dropped', item: e.name, message: 'Ground collision is not exported (add a GPUParticlesCollisionBox3D floor by hand).' });
  // Size: quad is 1 m; scale_min/max = birth size, the curve multiplies over life (keys relative to the mid size).
  // The curve is normalised to 0..1 (Godot clamps curve values to its range) and its peak moves into scale_min/max.
  const mid = Math.max(1e-4, (e.sizeCmMin + e.sizeCmMax) / 2);
  const factors = e.sizeOverLife.map(k => ({ t: k.t, v: k.v / mid })), sizePeak = Math.max(1e-4, ...factors.map(k => k.v), factors.length ? 0 : 1);
  const sMin = (e.sizeCmMin / 100) * (factors.length ? sizePeak : 1), sMax = (e.sizeCmMax / 100) * (factors.length ? sizePeak : 1);
  ppm.push(`scale_min = ${n(sMin)}`, `scale_max = ${n(sMax)}`);
  if (factors.length) ppm.push(`scale_curve = ${curve(res, factors.map(k => ({ t: k.t, v: k.v / sizePeak })))}`);
  ppm.push(`color_ramp = ${colorRamp(res, e)}`);
  if (e.spinDegMin || e.spinDegMax) ppm.push(`angle_min = ${n(e.spinDegMin)}`, `angle_max = ${n(e.spinDegMax)}`);
  if (e.angularVelocityDegSMin || e.angularVelocityDegSMax) ppm.push(`angular_velocity_min = ${n(e.angularVelocityDegSMin)}`, `angular_velocity_max = ${n(e.angularVelocityDegSMax)}`);
  const velocity = e.alignment === 'velocity';
  if (velocity) ppm.push('particle_flag_align_y = true');
  const fb = e.flipbook;
  if (fb && (fb.columns > 1 || fb.rows > 1)) {
    const frames = fb.columns * fb.rows, meanLife = (lifeMin + lifeMax) / 2;
    const speed = fb.fps > 0 ? (fb.fps * meanLife) / frames : 0; // Godot anim speed 1 = the whole sheet once per lifetime
    ppm.push(`anim_speed_min = ${n(speed)}`, `anim_speed_max = ${n(speed)}`, ...(fb.randomStartFrame ? ['anim_offset_max = 1.0'] : []));
  }
  const process = res.add('ParticleProcessMaterial', ppm);
  // ---- draw material: unshaded billboard, additive or alpha blend, colour from the ramp (vertex colour) ----
  const mat = [`transparency = 1`, `blend_mode = ${e.blend === 'additive' ? 1 : 0}`, 'shading_mode = 0', 'vertex_color_use_as_albedo = true',
    // Velocity-aligned: no billboard + Align Y (Godot's Y-billboard uses world up, so it would stand every flame upright).
    `billboard_mode = ${velocity ? 0 : 3}`, 'billboard_keep_scale = true', 'cull_mode = 2'];
  if (e.textureFile) mat.push(`albedo_texture = ${res.extTexture(`${texRoot}/${e.textureFile}`)}`);
  if (fb && (fb.columns > 1 || fb.rows > 1)) mat.push(`particles_anim_h_frames = ${fb.columns}`, `particles_anim_v_frames = ${fb.rows}`, `particles_anim_loop = ${fb.loop}`);
  const material = res.add('StandardMaterial3D', mat);
  const quad = res.add('QuadMesh', [`material = ${material}`]);
  // ---- timing: continuous rate or one burst ----
  const node: string[] = [`[node name=${str(name)} type="GPUParticles3D" parent="."]`];
  const peak = Math.max(0, ...e.rateOverTime.map(([, v]) => v));
  const t = (tick: number) => Math.min(duration, tick) / 60;
  if (peak > 0) {
    node.push(`amount = ${Math.max(1, Math.ceil(peak * lifeMax))}`);
    tracks.push({ path: `${name}:emitting`, interp: 0, update: 1, keys: [[0, 'false'], ...e.rateOverTime.map(([tick, v]) => [t(tick), v > 0 ? 'true' : 'false'] as [number, string])] });
    if (new Set(e.rateOverTime.map(([, v]) => v).filter(v => v > 0)).size > 1)
      tracks.push({ path: `${name}:amount_ratio`, interp: 1, update: 0, keys: e.rateOverTime.filter(([, v]) => v > 0).map(([tick, v]) => [t(tick), n(v / peak)] as [number, string]) });
  } else if (e.bursts.length) {
    const b = e.bursts[0];
    node.push(`amount = ${Math.max(1, b.count)}`, 'one_shot = true', 'explosiveness = 1.0');
    tracks.push({ path: `${name}:emitting`, interp: 0, update: 1, keys: [[0, 'false'], [t(b.tick), 'true']] });
    if (e.bursts.length > 1) report.push({ level: 'approximated', item: e.name, message: `${e.bursts.length} bursts: only the first is exported as a one-shot burst.` });
  } else {
    node.push('amount = 1');
    report.push({ level: 'dropped', item: e.name, message: 'No rate or burst: the emitter is exported but never emits.' });
  }
  node.push('emitting = false', `lifetime = ${n(lifeMax)}`, 'fixed_fps = 60', 'interpolate = true', `local_coords = ${e.attachToSource ? 'true' : 'false'}`,
    `position = ${vec3(fromUe(e.position))}`, 'visibility_aabb = AABB(-20, -20, -20, 40, 40, 40)', `process_material = ${process}`, `draw_pass_1 = ${quad}`);
  if (e.sourceTrack?.length) tracks.push({ path: `${name}:position`, interp: 1, update: 0, keys: e.sourceTrack.map(([tick, p]) => [t(tick), vec3(fromUe(p))] as [number, string]) });
  if (velocity && e.stretchRatio > 1.05) report.push({ level: 'approximated', item: e.name, message: `Velocity stretch x${e.stretchRatio} becomes velocity-aligned sprites without stretch (scale the quad's Y in the material to stretch).` });
  return node.join('\n');
}

function lightNode(l: UeLight, duration: number, tracks: Track[]): string {
  const name = nodeName(l.name);
  const peak = Math.max(0, ...l.intensity.map(([, v]) => v));
  const node = [`[node name=${str(name)} type="OmniLight3D" parent="."]`, `light_color = Color(${l.color.map(n).join(', ')}, 1)`,
    `omni_range = ${n(Math.max(0.1, l.radiusCm / 100))}`, `light_energy = 0.0`, `position = ${vec3(fromUe(l.positionCm))}`];
  if (peak > 0) tracks.push({ path: `${name}:light_energy`, interp: 1, update: 0, keys: [[0, '0.0'], ...l.intensity.map(([tick, v]) => [Math.min(duration, tick) / 60, n(v)] as [number, string])] });
  if (l.sourceTrack?.length) tracks.push({ path: `${name}:position`, interp: 1, update: 0, keys: l.sourceTrack.map(([tick, p]) => [Math.min(duration, tick) / 60, vec3(fromUe(p))] as [number, string]) });
  return node.join('\n');
}

/** Builds the scene text. `resRoot` is where the package folder lives in the Godot project (textures under it). */
export function godotSceneFrom(e: UnrealEffect, resRoot = `res://vfx_studio/${e.name}`): GodotScene {
  const res = new Resources(), tracks: Track[] = [], report: GodotReportItem[] = [];
  const duration = e.durationTicks;
  const nodes = [`[node name=${str(nodeName(e.name))} type="Node3D"]`];
  for (const em of e.emitters) nodes.push(emitterNode(res, em, `${resRoot}/Textures`, duration, tracks, report));
  for (const l of e.lights) nodes.push(lightNode(l, duration, tracks));
  if (e.ribbons.length) report.push({ level: 'dropped', item: 'ribbons', message: `${e.ribbons.length} beam/ribbon layer(s) (lightning, streams) are not exported to Godot yet.` });
  // Carry the Unreal IR's own notes that still apply (meshes, flashes, keyframes, many bursts, multi-path...).
  for (const r of e.report) if (!/Niagara|Unreal|importer|UE 5|Shape Location/i.test(r.message)) report.push(r);
  report.push({ level: 'info', item: 'scale', message: 'Godot uses metres and +Y up like VFX Studio; the scene origin is the Source anchor. The "play" animation autoplays; call $AnimationPlayer.play("play") to fire it again.' });
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
  return { name: e.name, tscn, textures: e.textures, report, resPath: resRoot };
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
    '', 'Size, colour and fade over each particle\'s life are exact (Godot curves). See report.md for what changed.', ''].join('\n');
}
