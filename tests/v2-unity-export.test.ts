// Unity exporter (src/export/unity/fromUnreal.ts): engine-neutral IR -> effect.unity.json shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { unrealEffectFrom } from '../src/export/unreal/fromPlan.ts';
import { unityEffectFrom, unityReadme, unityReportMarkdown } from '../src/export/unity/fromUnreal.ts';

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
