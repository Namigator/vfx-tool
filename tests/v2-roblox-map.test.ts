// Roblox exporter mapping (src/export/roblox/fromPlan.ts): our compiled effect → RobloxEffect IR.
import test from 'node:test';
import assert from 'node:assert/strict';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { robloxEffectFrom } from '../src/export/roblox/fromPlan.ts';
import { reportMarkdown } from '../src/export/roblox/report.ts';
import { MAX_SEQUENCE_KEYS, STUDS_PER_METER } from '../src/export/roblox/types.ts';

const effect = (id: string, edit?: (d: ReturnType<typeof insertComponent>['doc']) => void) => {
  const d = insertComponent(createBlankDocument(), id, undefined, { group: true }).doc;
  edit?.(d);
  const r = robloxEffectFrom(d);
  if (!r.ok) assert.fail(r.message);
  return r.value;
};

test('Roblox map: flamethrower becomes emitters with rate windows, event bursts, lights and an honest report', () => {
  const e = effect('flamethrower');
  assert.equal(e.emitters.length, 7);
  assert.equal(e.lights.length, 2);
  const tongue = e.emitters.find(x => x.name.includes('tonguea'))!;
  assert.ok(tongue.rate.length > 2 && tongue.rate[0][1] > 0, 'emits during the burn');
  assert.equal(tongue.rate[tongue.rate.length - 1][1], 0, 'stops at the end');
  assert.equal(tongue.flipbook?.layout, 'Grid4x4');
  assert.equal(tongue.textureKey, 'flame-tongue-a.png');
  assert.ok(tongue.speed[1] > 20, `speed in studs/s (${tongue.speed})`);
  for (const em of e.emitters) {
    for (const seq of [em.size, em.transparency, em.color]) {
      assert.ok(seq.length >= 2 && seq.length <= MAX_SEQUENCE_KEYS && seq[0].t === 0 && seq[seq.length - 1].t === 1, em.name);
    }
    assert.ok(em.transparency.every(k => k.v >= 0 && k.v <= 1));
  }
  const smoke = e.emitters.find(x => x.name.includes('smoke'))!;
  assert.ok(smoke.bursts.length > 10 && smoke.bursts.every(b => b.position), 'smoke is born where flames die');
  assert.ok(e.report.some(r => r.level === 'dropped' && /Turbulence/.test(r.message)));
  assert.ok(e.textures.includes('smoke-puff.png'));
  const md = reportMarkdown(e, { 'smoke-puff.png': '123' });
  assert.match(md, /rbxassetid:\/\/123/);
  assert.match(md, /NOT UPLOADED/);
});

test('Roblox map: lightning beams share one bolt geometry and smooth motion is thinned to blendable frames', () => {
  const e = effect('lightning-strike');
  const shared = e.beams.filter(b => b.sameGeometryAs);
  assert.ok(shared.length >= 3, `core/inner/outer passes reuse the bolt (${shared.map(b => b.name)})`);
  for (const b of shared) {
    const src = e.beams.find(x => x.name === b.sameGeometryAs)!;
    assert.ok(src && src.frames.length > 0 && b.frames.length === 0 && (b.widthRatio ?? 0) > 0);
  }
  const ripple = e.beams.find(b => b.name.includes('ripple'))!;
  assert.ok(ripple.interpolate && ripple.frames.length < 10, `ripple frames ${ripple.frames.length}`);
  assert.ok(JSON.stringify(e).length < 400_000, 'export data stays compact');
  // Positions are origin-relative studs: the bolt spans the Source→Target distance (4 m in the blank layout).
  const pts = e.beams.flatMap(b => b.frames.flatMap(f => f.paths ?? []).flatMap(p => p.points));
  const xs = pts.map(p => p[0]);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 3 * STUDS_PER_METER, 'bolt spans several metres in studs');
});

test('Roblox map: a keyframed Colour becomes colour frames on the emitters', () => {
  const e = effect('flamethrower', d => { d.controls.find(c => c.label === 'Colour')!.keys = [{ tick: 20, value: 0 }, { tick: 100, value: 180 }]; });
  const tongue = e.emitters.find(x => x.name.includes('tonguea'))!;
  assert.ok(tongue.colorFrames && tongue.colorFrames.length === 2, 'one colour frame per key');
  const [a, b] = tongue.colorFrames!;
  assert.equal(a.color.length, b.color.length);
  assert.ok(a.color.some((k, i) => k.c[2] < b.color[i].c[2]), 'blue rises toward the second key');
});

test('Roblox map: exports carry the authored Source/Target and the projectile flight for runtime aiming', async () => {
  const fire = effect('fireball');
  const { source, target } = fire.anchors;
  assert.ok(Math.hypot(target[0] - source[0], target[1] - source[1], target[2] - source[2]) > 10, 'Source→Target distance in studs');
  assert.ok(fire.travel && fire.travel.travelTicks > 0, 'the fireball flight is exported');
  assert.ok(fire.report.some(r => r.item === 'targeting'));
  const bolt = effect('lightning-strike');
  assert.equal(bolt.travel, undefined, 'no projectile flight in a strike');
  const { writeRbxmx } = await import('../src/export/roblox/rbxmx.ts');
  const xml = writeRbxmx(fire, { playerSource: '-- player' });
  assert.match(xml, /anchors/);
  assert.match(xml, /travelTicks/);
});
