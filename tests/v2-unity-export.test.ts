// Unity exporter (src/export/unity/fromUnreal.ts): engine-neutral IR -> effect.unity.json shape.
import test from 'node:test';
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
