// Unity exporter (src/export/unity/fromUnreal.ts): engine-neutral IR -> effect.unity.json shape.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { unrealEffectFrom } from '../src/export/unreal/fromPlan.ts';
import { MIN_FADE_POINTS, resampleForFade, unityEffectFrom, unityReadme, unityReportMarkdown } from '../src/export/unity/fromUnreal.ts';

const irOf = (component: string) => {
  const d = { ...insertComponent(createBlankDocument(`u-${component}`, component), component, undefined, { group: true }).doc, name: component };
  const r = unrealEffectFrom(d);
  assert.ok(r.ok);
  return r.value;
};

test('Unity: flamethrower emitters have consistent parallel arrays and 3-vectors', () => {
  const { effect, report } = unityEffectFrom(irOf('flamethrower'));
  assert.equal(effect.format, 'vfx-studio-unity');
  assert.ok(effect.emitters.length > 0);
  for (const e of effect.emitters) {
    assert.equal(e.rateTicks.length, e.rateValues.length);
    assert.equal(e.burstTicks.length, e.burstCounts.length);
    assert.equal(e.burstTicks.length, e.burstHasPosition.length);
    assert.equal(e.burstPositions.length, 3 * e.burstTicks.length);
    assert.equal(e.sizeKeysT.length, e.sizeKeysV.length);
    assert.equal(e.colorKeysRgb.length, 3 * e.colorKeysT.length);
    assert.equal(e.alphaKeysT.length, e.alphaKeysV.length);
    assert.equal(e.trackPositions.length, 3 * e.trackTicks.length);
    for (const v of [e.position, e.direction, e.boxSize, e.acceleration, e.attractPosition, e.vortexPosition, e.vortexAxis]) assert.equal(v.length, 3);
  }
  for (const l of effect.lights) {
    assert.equal(l.intensityTicks.length, l.intensityValues.length);
    assert.equal(l.trackPositions.length, 3 * l.trackTicks.length);
    assert.equal(l.position.length, 3);
    assert.equal(l.color.length, 3);
  }
  const md = unityReportMarkdown(effect.name, report);
  assert.match(md, /# Unity export: flamethrower/);
  assert.ok(!/Niagara/.test(md));
  assert.ok(!/Niagara/.test(unityReadme(effect.name)));
  JSON.parse(JSON.stringify(effect));
});

test('Unity: Z is mirrored and cm become metres', () => {
  const ir = irOf('flamethrower');
  ir.emitters[0] = { ...ir.emitters[0], position: [100, 200, 300] };
  const { effect } = unityEffectFrom(ir);
  assert.deepEqual(effect.emitters[0].position, [1, 3, -2]);
});

test('Unity: lightning strike ships ribbons with 4-float points', () => {
  const { effect, report } = unityEffectFrom(irOf('lightning-strike'));
  assert.ok(effect.ribbons.length > 0);
  let paths = 0;
  for (const rb of effect.ribbons) {
    assert.equal(rb.color.length, 3);
    assert.ok(rb.frames.length > 0);
    for (const f of rb.frames) for (const p of f.paths) { paths++; assert.equal(p.points.length % 4, 0); }
  }
  assert.ok(paths > 0);
  assert.ok(!/Niagara/.test(unityReportMarkdown(effect.name, report)));
});

test('Unity: ribbons draw like the editor (as Godot) - one sheet cell per path, tiling, soft untextured edges', () => {
  const ir = irOf('helix-beam');
  const { effect, report } = unityEffectFrom(ir);
  const irStrand = ir.ribbons.find(b => b.textureFile?.startsWith('electric-arc'))!;
  const strand = effect.ribbons.find(r => r.texture.startsWith('electric-arc'))!;
  const plain = effect.ribbons.find(r => !r.texture)!;
  assert.ok(strand && plain, 'helix-beam has textured strands and untextured core/haze');
  assert.deepEqual(strand.grid, [2, 2], 'a 2x2 variant sheet: one cell per path, not the whole atlas');
  const cells = strand.frames.flatMap(f => f.paths.map(p => p.cell));
  assert.ok(cells.length > 0 && cells.every(c => Number.isInteger(c) && c >= 0 && c < 4), 'every path carries a valid cell');
  if (irStrand.cell !== -1) assert.ok(cells.every(c => c === irStrand.cell));
  assert.equal(strand.tile, irStrand.tileCm !== undefined ? Math.round(irStrand.tileCm) / 100 : 0, 'tile length in metres');
  assert.equal(strand.scroll.length, 2);
  assert.equal(strand.softness, 0);
  assert.ok(plain.softness > 0, 'untextured strips keep the soft edge');
  assert.deepEqual(plain.grid, [1, 1]);
  assert.match(unityReportMarkdown(effect.name, report), /one sheet cell per path/);
});

test('Unity: short faded paths are resampled so the end fade has interior vertices (2-point paths vanished)', () => {
  const two: [number, number, number, number][] = [[0, 0, 0, 10], [100, 0, 0, 30]];
  const dense = resampleForFade(two, 0.2);
  assert.equal(dense.length, MIN_FADE_POINTS);
  assert.deepEqual(dense[0], two[0]);
  assert.deepEqual(dense[dense.length - 1], two[1]);
  assert.deepEqual(dense[8], [50, 0, 0, 20]);
  assert.equal(resampleForFade(two, 0), two, 'no fade: unchanged');
  const long = Array.from({ length: 20 }, (_, i) => [i, 0, 0, 1] as [number, number, number, number]);
  assert.equal(resampleForFade(long, 0.2), long, 'enough points: unchanged');
  const ir = irOf('helix-beam');
  const { effect } = unityEffectFrom(ir);
  for (const r of effect.ribbons) if (r.endFade > 0) for (const f of r.frames) for (const p of f.paths) assert.ok(p.points.length / 4 >= MIN_FADE_POINTS, `${r.name}: ${p.points.length / 4} points`);
});

test('Unity: particle trails are reported as dropped, not lost silently', () => {
  const ir = irOf('flamethrower');
  ir.trails = [{ name: 'fake_trail', emitter: ir.emitters[0], lifetimeSec: 0.3, maxPoints: 16, widthCm: 10, endFade: 0,
    widthOverTrail: [], colorOverTrail: [], opacityOverTrail: [], blend: 'additive' }];
  const { report } = unityEffectFrom(ir);
  assert.ok(report.some(x => x.level === 'dropped' && x.item === 'fake_trail'));
});

test('Unity: variants sheets draw the static editor cell (no flipping)', () => {
  const ir = irOf('flamethrower');
  ir.emitters[0] = { ...ir.emitters[0], flipbook: { columns: 2, rows: 2, fps: 4.4, loop: false, randomStartFrame: false, variantFrame: 3 } };
  ir.emitters[1] = { ...ir.emitters[1], flipbook: { columns: 2, rows: 2, fps: 4.4, loop: false, randomStartFrame: true, variantFrame: -1 } };
  const { effect } = unityEffectFrom(ir);
  assert.deepEqual([effect.emitters[0].flipFps, effect.emitters[0].flipStartFrame], [0, 3]);
  assert.deepEqual([effect.emitters[1].flipFps, effect.emitters[1].flipStartFrame], [0, -1]);
});

test('Unity: a moving-head trail is baked as a ribbon (tail first, head last and full, drains after the head dies)', () => {
  const ir = irOf('flamethrower');
  const track: [number, [number, number, number]][] = Array.from({ length: 11 }, (_, i) => [10 + i, [i * 100, 0, 0]]);
  ir.trails = [{ name: 'head_trail', emitter: { ...ir.emitters[0], sourceTrack: track, bursts: [{ tick: 10, count: 1 }], lifetimeSecMax: 10 / 60 },
    lifetimeSec: 5 / 60, maxPoints: 16, widthCm: 20, endFade: 0.3,
    widthOverTrail: [{ t: 0, v: 0 }, { t: 1, v: 1 }], colorOverTrail: [{ t: 0, r: 1, g: 0, b: 1, a: 1 }, { t: 1, r: 1, g: 0, b: 1, a: 1 }],
    opacityOverTrail: [{ t: 0, v: 0 }, { t: 1, v: 0.8 }], blend: 'additive' }];
  const { effect } = unityEffectFrom(ir);
  const r = effect.ribbons.find(x => x.name === 'head_trail');
  assert.ok(r);
  assert.equal(r.keepHead, true);
  assert.deepEqual(r.color, [1, 0, 1]);
  const at = (tick: number) => r.frames.find(f => f.tick === tick)!.paths[0]?.points ?? [];
  const p = at(18); // history 5 ticks: track ticks 13..18 -> x 3..8 m, tail first
  assert.deepEqual([p[0], p.at(-4)], [3, 8]);
  assert.equal(p.at(-1), 0.2); // head at full width
  assert.equal(p[3], 0); // tail tapers
  assert.equal(r.frames.find(f => f.tick === 20 + 5 + 1)!.paths.length, 0); // dies at 20, drained 5 ticks later
});

test('box emitters keep their box (they fell through to a point; feature grid 2026-10-29)', () => {
  const doc = JSON.parse(readFileSync('tests/fixtures/feature-box.json', 'utf8'));
  const r = unrealEffectFrom(doc);
  assert.ok(r.ok);
  const s = r.value.emitters[0].shape;
  assert.deepEqual(s, { kind: 'box', extentsCm: [70, 70, 70] });
  assert.deepEqual(unityEffectFrom(r.value).effect.emitters[0].boxSize, [1.4, 1.4, 1.4]);
});

test('Unity: drops worded for Unreal are still reported (mesh layers vanished silently; feature grid 2026-10-29)', () => {
  const ir = irOf('flamethrower');
  ir.report = [...ir.report, { level: 'dropped', item: 'meshes', message: '2 mesh-particle layer(s) are not exported; see report for manual Niagara Mesh Renderer setup.' }];
  const { report } = unityEffectFrom(ir);
  const m = report.find(x => x.item === 'meshes');
  assert.ok(m && m.level === 'dropped');
  assert.equal(m.message, '2 mesh-particle layer(s) are not exported.');
});

test('flat (world-axis) quads stay flat: Unity Horizontal Billboard, Godot Y-facing quad (they stood upright; feature grid 2026-10-29)', async () => {
  const { godotSceneFrom } = await import('../src/export/godot/scene.ts');
  const ir = irOf('flamethrower');
  ir.emitters = [{ ...ir.emitters[0], alignment: 'worldUpCameraFacing', facingAxis: [0, 0, 1] }];
  assert.equal(unityEffectFrom(ir).effect.emitters[0].alignment, 'flat');
  const tscn = godotSceneFrom(ir).tscn;
  assert.match(tscn, /orientation = 1/);
  assert.match(tscn, /particle_flag_rotate_y = true/);
  ir.emitters = [{ ...ir.emitters[0], facingAxis: [1, 0, 0] }];
  const side = unityEffectFrom(ir);
  assert.equal(side.effect.emitters[0].alignment, 'camera');
  assert.ok(side.report.some(x => x.level === 'approximated' && /sideways/.test(x.message)));
});

test('untextured sprites ship the soft disc the editor draws (not the tight soft-glow dot)', () => {
  const doc = JSON.parse(readFileSync('tests/fixtures/feature-box.json', 'utf8'));
  for (const n of doc.graphs[0].nodes) if (n.type === 'Material') { n.params.template = 'SpriteUnlit'; delete n.params.sprite; }
  const r = unrealEffectFrom(doc);
  assert.ok(r.ok);
  assert.equal(r.value.emitters[0].textureFile, 'soft-disc.png');
  assert.equal(r.value.emitters[0].flipbook, undefined);
});
