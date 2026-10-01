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
  assert.equal((g.tscn.match(/type="GPUParticles3D"/g) ?? []).length, ir.emitters.length);
  assert.equal((g.tscn.match(/type="OmniLight3D"/g) ?? []).length, ir.lights.length);
  assert.match(g.tscn, /\[node name="AnimationPlayer" type="AnimationPlayer" parent="\."\][\s\S]*autoplay = &"play"/);
  for (const t of g.textures) assert.ok(g.tscn.includes(`path="res://vfx_studio/flamethrower/Textures/${t}"`), t);
  // load_steps = ext + sub resources + 1
  const ext = (g.tscn.match(/^\[ext_resource /gm) ?? []).length, sub = (g.tscn.match(/^\[sub_resource /gm) ?? []).length;
  assert.equal(Number(g.tscn.match(/load_steps=(\d+)/)![1]), ext + sub + 1);
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
