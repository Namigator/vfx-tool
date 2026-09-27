import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENT_TEMPLATES, insertComponent } from '../src/graph/components.ts';
import { createBlankDocument, createF01Document } from '../src/graph/fixtures.ts';
import { validateDocument } from '../src/model/document.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';
import { compilePathPreview } from '../src/graph/toPaths.ts';

const valid = (d: unknown) => { const v = validateDocument(d, { registry: createRegistry() }); if (!v.ok) assert.fail(JSON.stringify(v.errors.slice(0, 3))); return v.value; };
const compiles = (d: unknown) => { const r = compileParticlePreview(d, { ribbonsHandled: true, audioHandled: true }); if (!r.ok) assert.fail(JSON.stringify(r.errors.slice(0, 3))); return r.value; };

test('every component inserts into a blank document, validates and compiles', () => {
  assert.ok(COMPONENT_TEMPLATES.length >= 7);
  for (const c of COMPONENT_TEMPLATES) {
    const { doc } = insertComponent(createBlankDocument(), c.id);
    const p = compiles(valid(doc)), r = compilePathPreview(doc, 30, { audioHandled: true });
    if (!r.ok) assert.fail(JSON.stringify(r.errors.slice(0, 3)));
    assert.ok(p.layers.length + p.trails.length + r.value.layers.length > 0, `${c.id} draws something`);
  }
});

test('components compose: two components and a repeat get unique ids and all compile together', () => {
  let d = createF01Document();
  const a = insertComponent(d, 'spark-burst'); d = a.doc;
  const b = insertComponent(d, 'fireball'); d = b.doc;
  const c = insertComponent(d, 'spark-burst'); d = c.doc;
  assert.notEqual(a.prefix, c.prefix);
  const p = compiles(valid(d));
  assert.ok(p.systems.length >= 1 + 1 + 4 + 1, `systems: ${p.systems.length}`);
  assert.equal(d.graphs[0].nodes.filter(n => n.type === 'EffectOutput').length, 1, 'shares the one output');
  assert.ok(d.durationTicks >= 120);
});

test('components bind to the existing Source/Target anchor nodes and never mutate the input', () => {
  const blank = createBlankDocument(), before = JSON.stringify(blank);
  const { doc } = insertComponent(blank, 'flame-jet');
  assert.equal(JSON.stringify(blank), before);
  const g = doc.graphs[0];
  assert.equal(g.nodes.filter(n => n.type === 'Anchor' && n.params.anchorId === 'source').length, 1);
  assert.ok(g.edges.some(e => e.source.nodeId === 'node-source' && e.target.port === 'anchor'));
  assert.ok(doc.anchors.some(a => a.id.endsWith('flamecenter')), 'component-owned anchor added with prefix');
  assert.throws(() => insertComponent(blank, 'nope'), /Unknown component/);
});

test('components publish bound knobs; changing a knob changes the compiled system', () => {
  const { doc } = insertComponent(createBlankDocument(), 'fireball');
  const knob = doc.controls.find(c => c.label === 'Impact sparks')!;
  assert.ok(knob && knob.bindings[0].nodeId === 'fireball-boom' && knob.value === 120);
  const burst = (d: typeof doc) => compiles(valid(d)).systems.find(s => s.descriptor.emitterId === 'fireball-boom')!.descriptor.bursts[0].count;
  assert.equal(burst(doc), 120);
  const more = structuredClone(doc); more.controls.find(c => c.id === knob.id)!.value = 400;
  assert.equal(burst(more), 400);
  const sizes = insertComponent(createBlankDocument(), 'flame-jet').doc;
  const size = sizes.controls.find(c => c.label === 'Flame size')!;
  size.value = 0.4;
  const s = compiles(valid(sizes)).systems[0].descriptor.size;
  assert.ok(Math.abs(s.max - 0.4) < 1e-9 && Math.abs(s.min - 0.25) < 1e-9, 'scaled binding drives sizeMin');
  for (const c of COMPONENT_TEMPLATES) assert.ok(c.knobs.length >= 3, `${c.id} has knobs`);
});

test('sound-carrying components share one audio mix/output, so several can be combined', async () => {
  const { compileAudio } = await import('../src/graph/toAudio.ts');
  let d = createBlankDocument();
  d = insertComponent(d, 'fireball').doc;
  d = insertComponent(d, 'fireball').doc;
  const g = d.graphs[0];
  assert.equal(g.nodes.filter(n => n.type === 'AudioMix').length, 1);
  assert.equal(g.nodes.filter(n => n.type === 'AudioOutput').length, 1);
  const a = compileAudio(valid(d));
  if (!a.ok) assert.fail(JSON.stringify(a.errors.slice(0, 3)));
  assert.equal(a.value.kind === 'mix' && a.value.voices.length, 8, 'both fireballs contribute their four voices');
});

test('grouped insertion: one Group node in root, internals in a child graph, same compiled systems, knobs still drive it', () => {
  for (const c of COMPONENT_TEMPLATES) {
    const flat = insertComponent(createBlankDocument(), c.id).doc, g = insertComponent(createBlankDocument(), c.id, undefined, { group: true });
    const doc = valid(g.doc);
    assert.equal(g.groupNodeId, c.id);
    assert.deepEqual(doc.graphs[0].nodes.map(n => n.type).filter(t => !t.startsWith('Audio')).sort(), ['Anchor', 'Anchor', 'EffectOutput', 'Group'], c.id);
    const child = doc.graphs.find(x => x.id === `graph-${c.id}`)!;
    assert.ok(child.nodes.some(n => n.type === 'GroupOutput'), c.id);
    const a = compiles(flat), b = compiles(doc);
    assert.equal(b.systems.length, a.systems.length, `${c.id} systems`);
    assert.deepEqual(b.systems.map(s => s.descriptor.bursts.length + (s.descriptor.rate?.perSecond ?? 0)), a.systems.map(s => s.descriptor.bursts.length + (s.descriptor.rate?.perSecond ?? 0)), c.id);
    const pf = compilePathPreview(flat, 30, { audioHandled: true }), pg = compilePathPreview(doc, 30, { audioHandled: true });
    assert.ok(pf.ok && pg.ok && pf.value.layers.length === pg.value.layers.length, `${c.id} ribbons`);
  }
  const { doc } = insertComponent(createBlankDocument(), 'spark-burst', undefined, { group: true });
  const knob = doc.controls.find(k => k.label === 'Sparks per burst')!;
  assert.equal(knob.scopeGraphId, 'graph-spark-burst');
  const count = (d: typeof doc) => compiles(valid(d)).systems[0].descriptor.bursts[0].count;
  const more = structuredClone(doc); more.controls.find(k => k.id === knob.id)!.value = 77;
  assert.notEqual(count(doc), 77);
  assert.equal(count(more), 77);

});

test('grouped sound components: cues inside the group drive the root audio chain; the mix equals the flat insert', async () => {
  const { compileAudio } = await import('../src/graph/toAudio.ts');
  for (const c of COMPONENT_TEMPLATES.filter(t => t.nodes.some(n => n.type.startsWith('Audio')))) {
    const a = compileAudio(insertComponent(createBlankDocument(), c.id).doc), b = compileAudio(insertComponent(createBlankDocument(), c.id, undefined, { group: true }).doc);
    if (!a.ok || !b.ok) assert.fail(`${c.id}: ${JSON.stringify((!a.ok ? a : b as { errors: unknown[] }).errors?.slice(0, 2))}`);
    assert.deepEqual([...b.value.mix.left], [...a.value.mix.left], c.id);
  }
});

test('Start at knob delays every Schedule of a component together (keeps their spacing)', () => {
  const { doc } = insertComponent(createBlankDocument(), 'fireball', undefined, { group: true });
  const k = doc.controls.find(c => c.label === 'Start at')!;
  assert.ok(k && k.value === 0 && k.bindings.length === 2);
  const later = structuredClone(doc); later.controls.find(c => c.id === k.id)!.value = 30; later.durationTicks = 200;
  const ticks = (d: typeof doc) => compiles(valid(d)).systems.map(s => s.descriptor.bursts[0]?.tick ?? s.descriptor.rate?.startTick).filter(t => t !== undefined).sort((a, b) => a! - b!);
  assert.deepEqual(ticks(later), ticks({ ...doc, durationTicks: 200 }).map(t => t! + 30));
  for (const c of COMPONENT_TEMPLATES) assert.ok(insertComponent(createBlankDocument(), c.id).doc.controls.some(x => x.label === 'Start at'), c.id);
});

test('event-triggered Schedules: water splash/ripples follow the arrival, so the Travel time knob moves them all together', () => {
  const { doc } = insertComponent(createBlankDocument(), 'water-stream', undefined, { group: true });
  const travel = doc.controls.find(c => c.label === 'Travel time')!;
  const ticks = (d: typeof doc) => { const p = compiles(valid(d)); return Object.fromEntries(p.systems.filter(s => /dropfloor|splash/.test(s.id)).map(s => [s.id.replace('water-stream-', ''), s.descriptor.bursts[0].tick])); };
  assert.deepEqual(ticks(doc), { dropfloor: 48, splash: 48 });
  const slow = structuredClone(doc); slow.controls.find(c => c.id === travel.id)!.value = 45; slow.durationTicks = 200;
  assert.deepEqual(ticks(slow), { dropfloor: 63, splash: 63 });
  const later = structuredClone(doc); later.controls.find(c => c.label === 'Start at')!.value = 20; later.durationTicks = 200;
  assert.deepEqual(ticks(later), { dropfloor: 68, splash: 68 }, 'Start at shifts the arrival once, not twice');
});
