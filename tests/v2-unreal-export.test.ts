// Unreal exporter mapping (src/export/unreal/fromPlan.ts): our compiled effect -> UnrealEffect IR.
import test from 'node:test';
import assert from 'node:assert/strict';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { unrealEffectFrom } from '../src/export/unreal/fromPlan.ts';
import { reportMarkdown } from '../src/export/unreal/report.ts';
import { readmeMarkdown, buildUnrealPackage } from '../src/export/unreal/package.ts';
import { CM_PER_METER, toUe, toUeDir } from '../src/export/unreal/types.ts';

const effect = (id: string, edit?: (d: ReturnType<typeof insertComponent>['doc']) => void) => {
  const d = insertComponent(createBlankDocument(), id, undefined, { group: true }).doc;
  edit?.(d);
  const r = unrealEffectFrom(d);
  if (!r.ok) assert.fail(r.message);
  return r.value;
};

test('Unreal units/axes: toUe swaps Y<->Z and scales metres to centimetres; toUeDir does the swap without scale', () => {
  assert.deepEqual(toUe([1, 2, 3]), [100, 300, 200]);
  assert.deepEqual(toUeDir([1, 2, 3]), [1, 3, 2]);
  assert.deepEqual(toUe([0, 0, 0]), [0, 0, 0]);
  assert.equal(CM_PER_METER, 100);
});

test('Unreal map: flamethrower becomes emitters with rate windows, event bursts, lights and an honest report', () => {
  const e = effect('flamethrower');
  assert.ok(e.emitters.length >= 5, `emitters: ${e.emitters.length}`);
  assert.ok(e.lights.length >= 1, `lights: ${e.lights.length}`);
  const tongue = e.emitters.find(x => x.name.includes('tonguea'))!;
  assert.ok(tongue, 'has a tongue emitter');
  assert.ok(tongue.rateOverTime.length > 2 && tongue.rateOverTime[0][1] > 0, 'emits during the burn');
  assert.equal(tongue.rateOverTime[tongue.rateOverTime.length - 1][1], 0, 'stops at the end');
  assert.equal(tongue.flipbook?.columns, 4);
  assert.equal(tongue.flipbook?.rows, 4);
  assert.equal(tongue.textureFile, 'flame-tongue-a.png');
  assert.ok(tongue.speedCmSMax > 500, `speed in cm/s scaled from m/s (${tongue.speedCmSMax})`);
  assert.equal(tongue.alignment, 'velocity');
  assert.ok(tongue.stretchRatio >= 1);
  // Unlike Roblox, turbulence is KEPT (Curl Noise Force), not dropped.
  assert.ok(!e.report.some(r => r.level === 'dropped' && /Turbulence/.test(r.message)), 'no turbulence drop');
  for (const em of e.emitters) {
    for (const seq of [em.sizeOverLife, em.opacityOverLife, em.colorOverLife]) {
      assert.ok(seq.length >= 2 && seq[0].t === 0 && seq[seq.length - 1].t === 1, em.name);
    }
    assert.ok(em.opacityOverLife.every(k => k.v >= 0 && k.v <= 1), `${em.name} opacity in 0..1 (not Roblox's inverted transparency)`);
    assert.ok(['additive', 'translucent', 'opaque'].includes(em.blend));
    assert.ok(['Fountain', 'SimpleSpriteBurst', 'Minimal', 'Ribbon', 'Light'].includes(em.suggestedTemplate));
  }
  const smoke = e.emitters.find(x => x.name.includes('smoke'));
  if (smoke) assert.ok(smoke.bursts.length > 0, 'smoke is event-born');
  assert.ok(e.textures.includes('smoke-puff.png'));
  const md = reportMarkdown(e);
  assert.match(md, /smoke-puff\.png/);
  assert.match(md, /Curl Noise Force|kept/);
});

test('Unreal map: fireball keeps drag/acceleration forces Roblox would export separately and reports bursts', () => {
  const e = effect('fireball');
  assert.ok(e.emitters.length > 0);
  const withForces = e.emitters.find(em => em.drag > 0 || em.acceleration.some(a => a !== 0) || em.noise || em.attract || em.vortex);
  assert.ok(withForces, 'at least one emitter carries a force');
  for (const em of e.emitters) {
    assert.ok(em.lifetimeSecMax >= em.lifetimeSecMin && em.lifetimeSecMin >= 0);
    assert.ok(em.sizeCmMax >= em.sizeCmMin);
  }
});

test('Unreal map: lightning-strike exports ribbon layers with per-tick point geometry in Unreal cm', () => {
  const e = effect('lightning-strike');
  assert.ok(e.ribbons.length > 0, `ribbons: ${e.ribbons.length}`);
  const withGeometry = e.ribbons.find(b => b.frames.some(f => f.points.length >= 2));
  assert.ok(withGeometry, 'at least one ribbon has real geometry');
  const pts = e.ribbons.flatMap(b => b.frames.flatMap(f => f.points));
  assert.ok(pts.every(p => p.every(Number.isFinite)), 'all ribbon coordinates finite');
  // Positions are origin-relative cm: the bolt spans several metres (hundreds of cm).
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[2]);
  const spanX = Math.max(...xs) - Math.min(...xs), spanZ = Math.max(...zs) - Math.min(...zs);
  assert.ok(spanX > 100 || spanZ > 100, `bolt spans metres in cm (spanX=${spanX}, spanZ=${spanZ})`);
  assert.ok(e.report.some(r => r.item === 'scale' && /axis mapping/i.test(r.message)), 'explicit axis mapping note');
});

test('Unreal map: meshes and presentation are reported, not silently dropped', () => {
  const earth = effect('earth-upheaval');
  assert.ok(earth.report.some(r => r.level === 'dropped' && r.item === 'meshes'), 'mesh layers become a report item');
});

test('Unreal package: buildUnrealPackage writes effect.json, README.md and report.md; textures included when bytes are supplied', () => {
  const e = effect('flamethrower');
  const textureBytes = new Map(e.textures.map(t => [t, new Uint8Array([1, 2, 3])]));
  const files = buildUnrealPackage(e, textureBytes);
  const paths = files.map(f => f.path);
  assert.ok(paths.includes('effect.json'));
  assert.ok(paths.includes('README.md'));
  assert.ok(paths.includes('report.md'));
  for (const t of e.textures) assert.ok(paths.includes(`Textures/${t}`), `texture ${t} included`);
  const ir = JSON.parse(files.find(f => f.path === 'effect.json')!.bytes as string);
  assert.equal(ir.name, e.name);
  assert.equal(ir.ticksPerSecond, 60);
  const readme = readmeMarkdown(e);
  assert.match(readme, /VfxStudioImporter/);
  assert.match(readme, /-run=VfxStudioImport/);
});

test('Unreal package: a texture with no supplied bytes is left out of the file list (not silently fabricated)', () => {
  const e = effect('flamethrower');
  const files = buildUnrealPackage(e, new Map());
  assert.ok(!files.some(f => f.path.startsWith('Textures/')), 'no texture files without bytes');
});

test('Unreal IR: colour over life keeps the authored colours (flamethrower tongue: white -> #FFE0A0 -> #FFA050)', async () => {
  const { createBlankDocument } = await import('../src/graph/fixtures.ts');
  const { insertComponent } = await import('../src/graph/components.ts');
  const { unrealEffectFrom } = await import('../src/export/unreal/fromPlan.ts');
  const d = insertComponent(createBlankDocument('colours', 'colours'), 'flamethrower', undefined, { group: true }).doc;
  const r = unrealEffectFrom(d);
  assert.ok(r.ok);
  const tongue = r.value.emitters.find(e => e.name.includes('tongueabb'))!;
  const at = (t: number) => tongue.colorOverLife.find(k => Math.abs(k.t - t) < 1e-6)!;
  assert.deepEqual([at(0).r, at(0).g, at(0).b], [1, 1, 1]);
  assert.ok(Math.abs(at(0.25).g - 0xe0 / 255) < 0.01 && Math.abs(at(0.25).b - 0xa0 / 255) < 0.01, JSON.stringify(at(0.25)));
  assert.ok(Math.abs(at(0.5).g - 0xa0 / 255) < 0.01 && Math.abs(at(0.5).b - 0x50 / 255) < 0.01, JSON.stringify(at(0.5)));
});

test('Unreal IR: attraction keeps its kill/soft radius and the vortex its inward pull and falloff (charge-up)', () => {
  const e = effect('charge-up');
  const motes = e.emitters.find(m => m.attract && m.vortex)!;
  assert.ok(motes, 'charge-up has an attracted, swirling emitter');
  assert.deepEqual(motes.attract, { positionCm: [0, 0, 0], strengthCmS2: 1400, softRadiusCm: 15, killRadiusCm: 12 });
  assert.equal(motes.vortex!.falloffCm, 200);
  assert.equal(motes.vortex!.inwardCmS2, 0);
  assert.equal(e.report.some(r => r.item === 'positions'), false, 'offsets now take effect: no hand-fix report item');
});
