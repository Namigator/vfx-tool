import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ID_PATTERN } from '../src/model/types.ts';
import { validateParameterValue } from '../src/model/values.ts';
import { validateDocument } from '../src/model/document.ts';
import { resolveParameters } from '../src/model/controls.ts';
import { createRegistry, MATERIAL_TEMPLATES } from '../src/graph/registry.ts';
import { createF01Document } from '../src/graph/fixtures.ts';

const EXPECTED_TYPES = ['Anchor', 'Schedule', 'Emitter', 'InitialProperties', 'Gravity', 'Drag', 'NoiseForce', 'Attract', 'Vortex', 'GroundCollision', 'RandomRange', 'ParticleEvents', 'Material', 'BillboardRenderer', 'ParticleTrail', 'MotionTrail', 'MeshRenderer', 'SpriteRenderer', 'PointLight', 'PathFollower', 'ScreenFlash', 'CameraImpulse', 'EffectOutput', 'Group', 'GroupInput', 'GroupOutput', 'LinePath', 'BezierPath', 'HelixPath', 'PathTransform', 'JaggedPath', 'BranchPath', 'RevealPath', 'RadialPath', 'RingPath', 'RibbonRenderer', 'EffectTimeCurve', 'AudioSource', 'AudioEnvelope', 'AudioFilter', 'AudioMix', 'AudioOutput'];
const LOWER_CAMEL = /^[a-z][A-Za-z0-9]*$/;

test('registry contains the current graph catalog at version 1, keyed type@version', () => {
  const reg = createRegistry();
  assert.deepEqual([...reg.keys()].sort(), EXPECTED_TYPES.map(t => `${t}@1`).sort());
  for (const [key, spec] of reg) {
    assert.equal(key, `${spec.type}@${spec.definitionVersion}`);
    assert.equal(spec.definitionVersion, 1);
    assert.ok(Array.isArray(spec.capabilities));
  }
});

test('all parameter defaults validate against their own specs', () => {
  for (const [key, spec] of createRegistry()) {
    for (const p of spec.parameters) {
      assert.deepEqual(validateParameterValue(p.default, p, `${key}.${p.id}`), [], `${key}.${p.id}`);
    }
  }
});

test('ports and parameters are unique, lowerCamelCase and metadata-consistent', () => {
  for (const [key, spec] of createRegistry()) {
    for (const list of [spec.inputs, spec.outputs, spec.parameters]) {
      const ids = list.map(x => x.id);
      assert.equal(new Set(ids).size, ids.length, `${key} duplicate IDs`);
      for (const id of ids) assert.match(id, LOWER_CAMEL, `${key}.${id}`);
      for (const id of ids) assert.match(id, ID_PATTERN);
    }
    // Parameter-driven input ports share their parameter ID; no static input may collide with a different meaning.
    const inputIds = new Set(spec.inputs.map(p => p.id));
    for (const p of spec.parameters) assert.ok(!inputIds.has(p.id), `${key}.${p.id} collides with a structured input`);
    for (const p of spec.parameters) {
      assert.ok(p.label.length > 0 && p.domains.length > 0, `${key}.${p.id}`);
      if (p.min !== undefined && p.max !== undefined) assert.ok(p.min <= p.max, `${key}.${p.id} bounds`);
      if (p.type === 'enum') assert.ok(p.choices && p.choices.length > 0 && new Set(p.choices).size === p.choices.length);
      else assert.equal(p.choices, undefined, `${key}.${p.id} choices on non-enum`);
      if (p.type === 'number' || p.type === 'integer') {
        assert.ok(p.min !== undefined && p.max !== undefined, `${key}.${p.id} must be bounded`);
      }
    }
  }
});

test('disabled behavior matches node category', () => {
  const reg = createRegistry();
  const b = (t: string) => reg.get(`${t}@1`)!.disabledBehavior;
  assert.equal(b('Schedule'), 'empty');
  assert.equal(b('Emitter'), 'empty');
  assert.equal(b('BillboardRenderer'), 'empty');
  assert.equal(b('Group'), 'empty');
  assert.equal(b('InitialProperties'), 'bypass');
  assert.equal(b('Material'), 'fallback');
  assert.equal(b('Anchor'), 'fallback');
  assert.equal(b('EffectOutput'), 'protected');
  assert.equal(b('GroupInput'), 'protected');
  assert.equal(b('GroupOutput'), 'protected');
});

test('structured ports follow plan 25', () => {
  const reg = createRegistry();
  const ports = (t: string, side: 'inputs' | 'outputs') => reg.get(`${t}@1`)![side].map(p => `${p.id}:${p.type}`);
  assert.deepEqual(ports('Anchor', 'outputs'), ['out:anchor']);
  assert.deepEqual(ports('Schedule', 'outputs'), ['start:event', 'end:event', 'window:timeWindow']);
  assert.deepEqual(ports('Emitter', 'inputs'), ['anchor:anchor', 'paths:paths', 'trigger:event', 'window:timeWindow', 'aim:anchor']);
  assert.ok(reg.get('Emitter@1')!.inputs.every(p => !p.required));
  assert.deepEqual(ports('Emitter', 'outputs'), ['particles:particles']);
  assert.deepEqual(ports('InitialProperties', 'inputs'), ['particles:particles']);
  assert.deepEqual(ports('Material', 'outputs'), ['material:material']);
  assert.deepEqual(ports('BillboardRenderer', 'inputs'), ['particles:particles', 'material:material']);
  assert.deepEqual(ports('BillboardRenderer', 'outputs'), ['visual:visual']);
  assert.deepEqual(ports('EffectOutput', 'inputs'), ['visual:visual', 'audio:audio', 'presentation:presentation']);
  assert.ok(reg.get('EffectOutput@1')!.inputs.every(p => p.cardinality === 'many'));
});

test('BillboardRenderer life curves are normalized, flat-1 by default and bounded', () => {
  const params = createRegistry().get('BillboardRenderer@1')!.parameters;
  const flat = { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] };
  for (const [id, max] of [['sizeOverLife', 20], ['opacityOverLife', 1]] as const) {
    const p = params.find(x => x.id === id)!;
    assert.deepEqual([p.type, p.curveDomain, p.min, p.max, p.default], ['curve', 'normalized', 0, max, flat], id);
    const over = { ...flat, keys: [{ x: 0, y: 1 }, { x: 1, y: max + 0.5 }] };
    assert.ok(validateParameterValue(over, p, id).length > 0, `${id} rejects y > ${max}`);
  }
});

test('audio nodes follow plans 11, 24 and 25', () => {
  const reg = createRegistry();
  const spec = (t: string) => reg.get(`${t}@1`)!;
  const ports = (t: string, side: 'inputs' | 'outputs') => spec(t)[side].map(p => `${p.id}:${p.type}:${p.cardinality}`);
  const bounds = (t: string, id: string) => { const p = spec(t).parameters.find(x => x.id === id)!; return [p.unit, p.min, p.max]; };
  assert.deepEqual(ports('AudioSource', 'inputs'), ['trigger:event:many', 'window:timeWindow:one']);
  for (const t of ['AudioSource', 'AudioOutput']) assert.deepEqual(ports(t, 'outputs'), ['audio:audio:one']);
  assert.deepEqual(ports('AudioOutput', 'inputs'), ['audio:audio:one']);
  // Decision 2026-09-27 (27-GAP-AUDIT): envelope = attack/hold/release seconds + release curve; filter = RBJ mode, cutoff start→end log sweep, Q.
  for (const t of ['AudioEnvelope', 'AudioFilter']) { assert.deepEqual(ports(t, 'inputs'), ['audio:audio:one']); assert.deepEqual(ports(t, 'outputs'), ['audio:audio:one']); assert.equal(spec(t).disabledBehavior, 'bypass'); }
  assert.deepEqual(bounds('AudioFilter', 'cutoffHz'), ['hertz', 20, 20000]);
  assert.deepEqual(bounds('AudioFilter', 'q'), ['none', 0.1, 20]);
  assert.deepEqual(ports('AudioMix', 'inputs'), ['inputs:audio:many']);
  assert.deepEqual(ports('AudioMix', 'outputs'), ['audio:audio:one']);
  assert.equal(spec('AudioMix').inputs[0].required, false, 'zero inputs is valid silence');
  assert.equal(spec('AudioSource').parameters.some(p => p.id === 'randomStreamId'), false, 'node.randomStreamId is authoritative');

  assert.deepEqual(bounds('AudioSource', 'offsetTicks'), ['tick', 0, 36000]);
  assert.deepEqual(bounds('AudioSource', 'durationTicks'), ['tick', 1, 600]);
  assert.deepEqual(bounds('AudioSource', 'gain'), ['linearGain', 0, 2]);
  assert.deepEqual(bounds('AudioSource', 'pitchRatio'), ['none', 0.25, 4]);
  assert.deepEqual(bounds('AudioSource', 'frequencyHz'), ['hertz', 20, 16000]);
  assert.deepEqual(bounds('AudioSource', 'pulseDuty'), ['normalized', 0.05, 0.95]);
  assert.deepEqual(spec('AudioSource').parameters.find(p => p.id === 'source')!.choices, ['oscillator', 'noise', 'chirp']);
  assert.deepEqual(spec('AudioOutput').parameters, []);
  assert.deepEqual(spec('AudioMix').parameters.map(p => p.id), ['masterGain'], 'per-input gain/pan live on edge.mix');
  const master = spec('AudioMix').parameters[0];
  assert.deepEqual([master.type, master.unit, master.default, master.min, master.max, master.step, master.editPolicy], ['number', 'linearGain', 1, 0, 1, 0.01, 'live']);

  assert.equal(spec('AudioSource').disabledBehavior, 'empty');
  assert.deepEqual([spec('AudioMix').disabledBehavior, spec('AudioMix').bypass], ['empty', undefined]);
  assert.deepEqual([spec('AudioOutput').disabledBehavior, spec('AudioOutput').bypass], ['bypass', { input: 'audio', output: 'audio' }]);
});

test('structural and material parameters', () => {
  const reg = createRegistry();
  assert.deepEqual(reg.get('Group@1')!.parameters.map(p => [p.id, p.type]), [['graphId', 'string']]);
  assert.deepEqual(reg.get('GroupInput@1')!.parameters.map(p => [p.id, p.type]), [['portId', 'string']]);
  assert.deepEqual(reg.get('GroupOutput@1')!.parameters.map(p => [p.id, p.type]), [['portId', 'string']]);
  assert.deepEqual(reg.get('Anchor@1')!.parameters.map(p => [p.id, p.type]), [['anchorId', 'string']]);
  const template = reg.get('Material@1')!.parameters.find(p => p.id === 'template')!;
  assert.deepEqual(template.choices, ['SpriteUnlit', 'SpriteTextured']);
  assert.deepEqual(MATERIAL_TEMPLATES, ['SpriteUnlit', 'SpriteTextured']);
  assert.ok(reg.get('Material@1')!.parameters.every(p => p.type !== 'asset'));
});

test('defaults are independent across factory calls', () => {
  const a = createRegistry();
  const b = createRegistry();
  const color = a.get('InitialProperties@1')!.parameters.find(p => p.id === 'color')!;
  (color.default as { srgb: string }).srgb = '#000000';
  (a.get('Emitter@1')!.parameters.find(p => p.id === 'direction')!.default as number[])[0] = 0;
  a.get('Emitter@1')!.inputs.pop();
  a.get('Material@1')!.parameters[0].choices!.push('Other');
  assert.deepEqual(b.get('InitialProperties@1')!.parameters.find(p => p.id === 'color')!.default, { srgb: '#FFFFFF', alpha: 1 });
  assert.deepEqual(b.get('Emitter@1')!.parameters.find(p => p.id === 'direction')!.default, [1, 0, 0]);
  assert.equal(b.get('Emitter@1')!.inputs.length, 5);
  assert.deepEqual(b.get('Material@1')!.parameters[0].choices, ['SpriteUnlit', 'SpriteTextured']);
  assert.deepEqual(createRegistry(), b);
});

test('F01 validates and resolves with the production registry', () => {
  const registry = createRegistry();
  const doc = createF01Document();
  const v = validateDocument(doc, { registry });
  assert.ok(v.ok, JSON.stringify(v.ok ? [] : v.errors));
  assert.deepEqual(v.warnings, []);
  const r = resolveParameters(doc, registry);
  assert.ok(r.ok, JSON.stringify(r.ok ? [] : r.errors));
  assert.equal(doc.durationTicks, 120);
  const value = (nodeId: string, p: string) => r.ok ? r.value.find(x => x.nodeId === nodeId && x.parameter === p)?.value : undefined;
  assert.equal(value('node-schedule', 'startTicks'), 0);
  assert.equal(value('node-schedule', 'durationTicks'), 60);
  assert.equal(value('node-schedule', 'mode'), 'once');
  assert.equal(value('node-emitter', 'burst'), 1);
  assert.equal(value('node-emitter', 'rate'), 0);
  assert.equal(value('node-emitter', 'lifetimeMin'), 1);
  assert.equal(value('node-emitter', 'lifetimeMax'), 1);
  assert.equal(value('node-emitter', 'speedMin'), 0);
  assert.equal(value('node-emitter', 'speedMax'), 0);
  assert.equal(value('node-initial', 'sizeMin'), 0.1);
  assert.equal(value('node-initial', 'sizeMax'), 0.1);
  assert.equal(value('node-material', 'template'), 'SpriteUnlit');
  assert.equal(value('node-source', 'anchorId'), 'source');
  assert.equal(value('node-target', 'anchorId'), 'target');
});

test('F01 wiring is complete', () => {
  const g = createF01Document().graphs[0];
  const wires = g.edges.map(e => `${e.source.nodeId}.${e.source.port}->${e.target.nodeId}.${e.target.port}`).sort();
  assert.deepEqual(wires, [
    'node-billboard.visual->node-output.visual',
    'node-emitter.particles->node-initial.particles',
    'node-initial.particles->node-billboard.particles',
    'node-material.material->node-billboard.material',
    'node-schedule.start->node-emitter.trigger',
    'node-source.out->node-emitter.anchor',
  ]);
  const a = createF01Document();
  a.graphs[0].nodes[0].params.anchorId = 'target';
  assert.equal(createF01Document().graphs[0].nodes[0].params.anchorId, 'source');
});

test('pure graph/model modules import no DOM, React or Three', () => {
  const files = ['graph/registry.ts', 'graph/fixtures.ts', 'model/types.ts', 'model/values.ts', 'model/document.ts', 'model/controls.ts', 'model/canonical.ts'];
  for (const f of files) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    const imports = [...src.matchAll(/(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
    for (const spec of imports) assert.match(spec, /^\.\.?\//, `${f} imports ${spec}`);
    assert.doesNotMatch(src, /from\s*['"](react|three)/, `${f} imports React/Three`);
  }
});
