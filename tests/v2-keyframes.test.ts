import test from 'node:test';
import assert from 'node:assert/strict';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { validateDocument } from '../src/model/document.ts';
import type { EffectDocumentV2, PublicControl } from '../src/model/types.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';
import { compilePathPreview } from '../src/graph/toPaths.ts';
import { controlValueAt } from '../src/graph/keyframes.ts';
import { ParticleSimulation } from '../src/runtime/particles.ts';

const registry = createRegistry();
const flame = () => insertComponent(createBlankDocument(), 'flamethrower', undefined, { group: true }).doc;
const knob = (d: EffectDocumentV2, label: string): PublicControl => d.controls.find(c => c.label === label)!;
const plan = (d: unknown) => { const r = compileParticlePreview(d); assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.errors)); return r.value; };
const sumBursts = (bursts: { tick: number; count: number }[], from: number, to: number) => bursts.filter(b => b.tick >= from && b.tick < to).reduce((a, b) => a + b.count, 0);

test('controlValueAt: before, between, after, integer rounding', () => {
  const c = { type: 'number' as const, value: 5, keys: [{ tick: 10, value: 0 }, { tick: 20, value: 100 }] };
  assert.equal(controlValueAt(c, 0), 0);
  assert.equal(controlValueAt(c, 10), 0);
  assert.equal(controlValueAt(c, 15), 50);
  assert.equal(controlValueAt(c, 20), 100);
  assert.equal(controlValueAt(c, 500), 100);
  assert.equal(controlValueAt({ type: 'number', value: 7 }, 3), 7, 'no keys: the plain value');
  const i = { type: 'integer' as const, value: 0, keys: [{ tick: 0, value: 0 }, { tick: 3, value: 10 }] };
  assert.equal(controlValueAt(i, 1), 3);
  assert.equal(controlValueAt(i, 2), 7);
});

test('document validation of keys', () => {
  const check = (mutate: (d: EffectDocumentV2) => void) => { const d = flame(); mutate(d); return validateDocument(d, { registry }); };
  assert.ok(check(d => { knob(d, 'Flame density').keys = [{ tick: 12, value: 60 }, { tick: 90, value: 400 }]; }).ok, 'good keys are accepted');
  assert.equal(check(d => { knob(d, 'Flame density').keys = [{ tick: 90, value: 60 }, { tick: 12, value: 400 }]; }).ok, false, 'descending ticks');
  assert.equal(check(d => { knob(d, 'Flame density').keys = [{ tick: 12, value: 60 }, { tick: 12, value: 400 }]; }).ok, false, 'duplicate ticks');
  assert.equal(check(d => { knob(d, 'Flame density').keys = [{ tick: 12, value: 60 }, { tick: 90, value: 99999 }]; }).ok, false, 'above max');
  assert.equal(check(d => { knob(d, 'Flame density').keys = [{ tick: 12, value: -1 }]; }).ok, false, 'below min');
  assert.equal(check(d => { knob(d, 'Flame density').keys = [{ tick: 601, value: 10 }]; }).ok, false, 'tick past 600');
  assert.equal(check(d => { knob(d, 'Flame colour').keys = [{ tick: 0, value: 1 }]; }).ok, false, 'keys on a colour knob');
});

test('Flame density keyed 60 -> 400: the flame tongues carry a rate track and emit more later', () => {
  const d = flame();
  knob(d, 'Flame density').keys = [{ tick: 12, value: 60 }, { tick: 90, value: 400 }];
  const p = plan(d);
  for (const id of ['flamethrower-tonguea', 'flamethrower-tongueb']) {
    const desc = p.systems.find(s => s.descriptor.emitterId === id)!.descriptor;
    const t = (desc.animation as { path: (string | number)[]; keys: [number, number][] }[]).find(x => x.path.join('.') === 'rate.perSecond')!;
    assert.ok(t, `${id} has a rate.perSecond track`);
    assert.deepEqual(t.keys.map(k => k[0]), [12, 90]);
    assert.equal(t.keys[0][1], 60); assert.equal(t.keys[1][1], 400);
  }
  const desc = p.systems.find(s => s.descriptor.emitterId === 'flamethrower-tonguea')!.descriptor;
  const c = ParticleSimulation.create(desc);
  assert.ok(c.ok);
  const sim = c.ok ? c.value : (null as never);
  const births: number[] = [sim.snapshot().totalBirths];
  while (sim.tick < 100) { assert.ok(sim.advance().ok); births.push(sim.snapshot().totalBirths); }
  const early = births[32] - births[12], late = births[90] - births[70];
  assert.ok(late > early, `late ${late} > early ${early}`);
});

test('Colour keyed 0 -> 180: sprite layers animate hueShift, no descriptor tracks', () => {
  const d = flame();
  knob(d, 'Colour').keys = [{ tick: 0, value: 0 }, { tick: 100, value: 180 }];
  const p = plan(d);
  const animated = p.layers.filter(l => l.animation?.numbers.some(t => t.path.length === 1 && t.path[0] === 'hueShift'));
  assert.ok(animated.length > 0, 'some layer has a hueShift track');
  const t = animated[0].animation!.numbers.find(x => x.path[0] === 'hueShift')!;
  assert.deepEqual(t.keys, [[0, 0], [100, 180]]);
  for (const s of p.systems) assert.ok(!s.descriptor.animation?.length, `${s.id} has no descriptor tracks`);
});

test('a timing knob (Burn time) keyed fails with one error naming it', () => {
  const d = flame();
  knob(d, 'Burn time').keys = [{ tick: 0, value: 40 }, { tick: 100, value: 84 }];
  const r = compileParticlePreview(d);
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.errors.length, 1); assert.match(r.errors[0].message, /Burn time/); }
});

test('Smoke amount keyed 0.02 -> 0.3: more smoke births late than a static 0.08', () => {
  const smoke = (d: unknown) => plan(d).systems.find(s => s.descriptor.emitterId === 'flamethrower-smoke')!.descriptor.bursts;
  const still = smoke(flame());
  const d = flame();
  knob(d, 'Smoke amount').keys = [{ tick: 0, value: 0.02 }, { tick: 120, value: 0.3 }];
  const keyed = smoke(d);
  assert.ok(sumBursts(keyed, 60, 120) > sumBursts(still, 60, 120), `keyed ${sumBursts(keyed, 60, 120)} vs static ${sumBursts(still, 60, 120)}`);
});

test('a document without keys compiles to the same plan with or without an empty keys field', () => {
  const a = flame();
  const b = structuredClone(a);
  for (const c of b.controls) if (c.type === 'number' || c.type === 'integer') c.keys = [];
  assert.deepEqual(plan(b), plan(a));
  const c = structuredClone(a);
  for (const x of c.controls) delete x.keys;
  assert.deepEqual(plan(c), plan(a));
});

test('lightning-strike: a keyed Core width changes the ribbon width between ticks', () => {
  const d = insertComponent(createBlankDocument(), 'lightning-strike', undefined, { group: true }).doc;
  knob(d, 'Core width').keys = [{ tick: 0, value: 0.02 }, { tick: 100, value: 0.2 }];
  assert.ok(validateDocument(d, { registry }).ok);
  const widths = (t: number) => { const r = compilePathPreview(d, t); assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.errors)); return r.value.layers.map(l => l.width); };
  const w0 = widths(0), w100 = widths(100), w50 = widths(50);
  assert.notDeepEqual(w0, w100);
  const i = w0.findIndex((w, k) => w !== w100[k]);
  assert.ok(w0[i] < w50[i] && w50[i] < w100[i], `${w0[i]} < ${w50[i]} < ${w100[i]}`);
});
