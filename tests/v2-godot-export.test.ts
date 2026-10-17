// Godot 4 exporter (src/export/godot/scene.ts): engine-neutral IR -> .tscn text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { unrealEffectFrom } from '../src/export/unreal/fromPlan.ts';
import { godotReadme, godotReportMarkdown, godotSceneFrom } from '../src/export/godot/scene.ts';

const scene = (component: string) => {
  const d = { ...insertComponent(createBlankDocument(`g-${component}`, component), component, undefined, { group: true }).doc, name: component };
  const r = unrealEffectFrom(d);
  assert.ok(r.ok);
  return { ir: r.value, g: godotSceneFrom(r.value) };
};

test('Godot: flamethrower becomes GPUParticles3D emitters, an autoplaying animation, textures under res://vfx_studio', () => {
  const { ir, g } = scene('flamethrower');
  assert.match(g.tscn, /^\[gd_scene load_steps=\d+ format=3\]/);
  assert.equal((g.tscn.match(/type="GPUParticles3D"/g) ?? []).length, ir.emitters.length + (ir.trails?.length ?? 0));
  assert.equal((g.tscn.match(/type="OmniLight3D"/g) ?? []).length, ir.lights.length);
  assert.match(g.tscn, /\[node name="AnimationPlayer" type="AnimationPlayer" parent="\."\][\s\S]*autoplay = &"play"/);
  for (const t of g.textures) assert.ok(g.tscn.includes(`path="res://vfx_studio/flamethrower/Textures/${t}"`), t);
  // load_steps = ext + sub resources + 1
  const ext = (g.tscn.match(/^\[ext_resource /gm) ?? []).length, sub = (g.tscn.match(/^\[sub_resource /gm) ?? []).length;
  assert.equal(Number(g.tscn.match(/load_steps=(\d+)/)![1]), ext + sub + 1);
});

test('Godot: static sprite cells, HDR gain and attached source motion preserve long-lived riders', () => {
  const { ir } = scene('impact-flash');
  const rider = { ...ir.emitters[0], name: 'Rider', sizeCmMin: 45, sizeCmMax: 45,
    sizeOverLife: [{ t: 0, v: 45 }, { t: 1, v: 45 }], lifetimeSecMin: 2, lifetimeSecMax: 2,
    rateOverTime: [], bursts: [{ tick: 0, count: 1 }], attachToSource: true,
    sourceTrack: [[0, [0, 0, 0]], [60, [100, 0, 0]]] as [number, [number, number, number]][],
    emission: 2.5, flipbook: { columns: 2, rows: 2, fps: 2, loop: false, randomStartFrame: false, variantFrame: 2 } };
  const text = godotSceneFrom({ ...ir, emitters: [rider], trails: undefined, ribbons: [], lights: [] }).tscn;
  assert.match(text, /scale_min = 0\.45\nscale_max = 0\.45/);
  assert.match(text, /anim_speed_min = 0\.0\nanim_speed_max = 0\.0/);
  assert.match(text, /anim_offset_min = 0\.5\nanim_offset_max = 0\.5/);
  // The editor's linear gain 1 + 2.5 = 3.5, sRGB-encoded because Godot decodes albedo_color (source_color).
  const gain = Number(text.match(/albedo_color = Color\(([\d.]+), \1, \1, 1\)/)?.[1]);
  assert.ok(Math.abs(((gain + 0.055) / 1.055) ** 2.4 - 3.5) < 0.01, `gain ${gain} decodes to 3.5`);
  assert.match(text, /vertex_color_is_srgb = true/, 'ramp colours are sRGB like the editor (it linearises them)');
  assert.match(text, /local_coords = true/);
  assert.match(text, /NodePath\("Rider:position"\)/);
  assert.match(text, /"times": PackedFloat32Array\(0\.0\),[\s\S]*?"values": \[true\]/);
  assert.doesNotMatch(text, /PackedFloat32Array\(0\.0, 0\.0/);
});

test('Godot: trails have independent ribbon skinning, tail colour/opacity, width and shared random seeds', () => {
  const { ir } = scene('impact-flash');
  const parent = { ...ir.emitters[0], name: 'Head', attachToSource: false };
  const trail = { name: 'Comet', parentEmitterName: 'Head', emitter: parent, lifetimeSec: 0.3, maxPoints: 20,
    widthCm: 8, endFade: 0.5, blend: 'additive' as const,
    widthOverTrail: [{ t: 0, v: 0 }, { t: 1, v: 1 }],
    colorOverTrail: [{ t: 0, r: 1, g: 0, b: 0.5, a: 1 }, { t: 1, r: 1, g: 0, b: 0.5, a: 1 }],
    opacityOverTrail: [{ t: 0, v: 0 }, { t: 1, v: 0.8 }] };
  const text = godotSceneFrom({ ...ir, emitters: [parent], trails: [trail], ribbons: [], lights: [] }).tscn;
  assert.match(text, /name="Comet_Trail" type="GPUParticles3D"/);
  assert.match(text, /trail_enabled = true\ntrail_lifetime = 0\.3/);
  assert.match(text, /type="RibbonTrailMesh"[\s\S]*?size = 0\.08\nsections = 19/);
  assert.match(text, /use_particle_trails = true/);
  assert.match(text, /type="GradientTexture2D"/);
  // Linear colour (sRGB 0.5 -> 0.214): Godot does not decode the HDR ramp texture.
  assert.match(text, /colors = PackedColorArray\(1\.0, 0\.0, 0\.214, 0\.0, 1\.0, 0\.0, 0\.214, 0\.8\)/);
  const seeds = [...text.matchAll(/^seed = (\d+)/gm)].map(m => m[1]);
  assert.equal(seeds.length, 2);
  assert.equal(seeds[0], seeds[1]);
  const attached = { ...parent, attachToSource: true, shape: { kind: 'point' as const }, speedCmSMin: 0, speedCmSMax: 0,
    acceleration: [0, 0, 0] as [number, number, number], noise: undefined, attract: undefined, vortex: undefined,
    sourceTrack: [[0, [0, 0, 0]], [60, [100, 0, 0]]] as [number, [number, number, number]][] };
  const moving = godotSceneFrom({ ...ir, emitters: [attached], trails: [{ ...trail, emitter: attached }], ribbons: [], lights: [] }).tscn;
  assert.match(moving, /TRANSFORM\[3\]\.xyz = EMISSION_TRANSFORM\[3\]\.xyz/);
  // The ribbon's width comes from the particle basis: Y follows the motion (identity basis = hairline trails), X faces
  // the camera that vfx_trails.gd feeds in, on a flat strip (a cross overlapped into a doubled white core).
  assert.match(moving, /TRANSFORM\[1\]\.xyz = y;/);
  assert.match(moving, /cross\(y, cam_pos - EMISSION_TRANSFORM\[3\]\.xyz\)/);
  assert.match(moving, /type="RibbonTrailMesh"[^[]*shape = 0/);
  assert.match(moving, /\[node name="TrailFacing" type="Node" parent="\."\]\nscript = ExtResource\("[^"]+"\)\ntrails = Array\[NodePath\]\(\[NodePath\("\.\.\/Comet_Trail"\)\]\)/);
  assert.ok(godotSceneFrom({ ...ir, emitters: [attached], trails: [{ ...trail, emitter: attached }], ribbons: [], lights: [] }).files.some(f => f.path === 'vfx_trails.gd'));
  assert.match(moving, /detail_blend_mode = 3/, 'untextured additive trails get the soft transverse band');
  assert.match(text, /particle_flag_align_y = true/, 'free trails align Y to their velocity');
  const node = moving.split('[node name="Comet_Trail"')[1].split('\n[')[0];
  assert.match(node, /local_coords = false/);
});

test('Godot: units and axes - metres, +Y up; the jet starts at the Source and points along +X', () => {
  const { g } = scene('flamethrower');
  const tongue = g.tscn.split('[node name="flamethrower_tongueabb"')[1].split('\n[')[0];
  assert.match(tongue, /position = Vector3\(0\.0, 0\.0, 0\.0\)/);
  const ppmId = tongue.match(/process_material = SubResource\("([^"]+)"\)/)![1];
  const ppm = g.tscn.split(`id="${ppmId}"]`)[1].split('\n[')[0];
  const dir = ppm.match(/direction = Vector3\(([^)]+)\)/)![1].split(',').map(Number);
  assert.ok(dir[0] > 0.99, `direction ${dir}`);
  assert.match(ppm, /initial_velocity_max = 11\.0/); // 11 m/s, not 1100 cm/s
});

test('Godot: size curve is normalised to 0..1 with its peak in scale_min/max; colour ramp keeps the authored colours', () => {
  const { g } = scene('flamethrower');
  const curves = [...g.tscn.matchAll(/_data = \[([^\]]+)\]/g)].map(m => [...m[1].matchAll(/Vector2\(([\d.]+), ([\d.]+)\)/g)].map(v => Number(v[2])));
  assert.ok(curves.length > 0);
  for (const c of curves) assert.ok(Math.max(...c) <= 1.0001, `curve ${c}`);
  // Tongue ramp: white at birth, orange #FFA050 at mid-life.
  const ramp = g.tscn.match(/offsets = PackedFloat32Array\(([^)]+)\)\ncolors = PackedColorArray\(([^)]+)\)/)!;
  const offs = ramp[1].split(',').map(Number), cols = ramp[2].split(',').map(Number);
  const i = offs.findIndex(o => Math.abs(o - 0.5) < 1e-6);
  assert.ok(i >= 0);
  assert.ok(Math.abs(cols[i * 4 + 1] - 0xa0 / 255) < 0.01 && Math.abs(cols[i * 4 + 2] - 0x50 / 255) < 0.01, `mid colour ${cols.slice(i * 4, i * 4 + 4)}`);
});

test('Godot: a burst emitter is one-shot; report and readme explain what changed and where to copy the folder', () => {
  const { g } = scene('impact-flash');
  assert.match(g.tscn, /one_shot = true/);
  assert.match(g.tscn, /explosiveness = 1\.0/);
  assert.ok(godotReadme(g).includes('res://vfx_studio/impact_flash/'));
  assert.match(godotReportMarkdown(g), /# Godot export: impact_flash/);
});

test('Godot: beams ship as ribbons.json + vfx_ribbons.gd (every path with its per-frame opacity), driven by a Ribbons node', () => {
  const { ir, g } = scene('lightning-strike');
  assert.deepEqual(g.files.map(f => f.path).sort(), ['ribbons.json', 'vfx_ribbons.gd']);
  assert.match(g.tscn, /\[node name="Ribbons" type="Node3D" parent="\."\]\nscript = ExtResource\("[^"]+"\)\ndata_path = "res:\/\/vfx_studio\/lightning_strike\/ribbons\.json"/);
  const data = JSON.parse(g.files.find(f => f.path === 'ribbons.json')!.text);
  assert.equal(data.layers.length, ir.ribbons.length);
  const core = data.layers.find((l: { name: string }) => l.name.includes('corerib'));
  const mid = core.frames[Math.floor(core.frames.length / 2)];
  assert.ok(mid.paths.length > 5, `trunk + branches, got ${mid.paths.length}`);
  assert.ok(new Set(core.frames.map((f: { paths: { a: number }[] }) => f.paths[0]?.a)).size > 3, 'opacity flickers/decays over frames');
  assert.equal(mid.paths[0].p.length % 4, 0);
  assert.match(g.files.find(f => f.path === 'vfx_ribbons.gd')!.text, /^extends Node3D/);
});

test('Godot: ribbons draw like the editor - one sheet cell per path, tiling, soft untextured edges, emission', () => {
  const { ir, g } = scene('helix-beam');
  const data = JSON.parse(g.files.find(f => f.path === 'ribbons.json')!.text);
  const strand = data.layers.find((l: { texture?: string }) => l.texture?.includes('electric-arc'));
  const plainLayer = data.layers.find((l: { texture?: string }) => !l.texture);
  assert.ok(strand && plainLayer, 'helix-beam has textured strands and untextured core/haze');
  const irStrand = ir.ribbons.find(b => b.textureFile?.startsWith('electric-arc'))!;
  // electric-arc is a 2x2 variant sheet: the editor draws one cell (random per path when the variant is -1), not the atlas.
  assert.deepEqual(strand.grid, [2, 2]);
  assert.deepEqual(irStrand.sheetGrid, [2, 2]);
  if (irStrand.cell === -1) {
    const cells = strand.frames.flatMap((f: { paths: { c?: number }[] }) => f.paths.map(p => p.c));
    assert.ok(cells.every((c: number | undefined) => c !== undefined && c >= 0 && c < 4), 'every path carries its cell');
  }
  assert.equal(strand.tile > 0, irStrand.tileCm !== undefined, 'tiled strands carry their tile length (m)');
  assert.ok(plainLayer.softness > 0, 'untextured strips keep the soft edge');
  assert.equal(irStrand.softness, undefined, 'textured strips take their cross-section from the texture');
  const gd = g.files.find(f => f.path === 'vfx_ribbons.gd')!.text;
  assert.match(gd, /shader_type spatial;/);
  assert.match(gd, /surface_set_uv2\(/);
  for (const u of ['grid', 'softness', 'tile', 'scroll', 'emission', 'fade', 'time_s']) assert.ok(gd.includes(`set_shader_parameter("${u}"`), u);
});
