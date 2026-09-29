import { compilePathPreview } from '../src/graph/toPaths.ts';
import { waveAt } from '../src/graph/effectTime.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Diagnostic, EffectDocumentV2, NodeDefinition, ValidationResult } from '../src/model/types.ts';
import { compileParticlePreview, multiplyColors, type ParticlePreviewPlan } from '../src/graph/toParticles.ts';
import { createF01Document } from '../src/graph/fixtures.ts';
import { sampleParticlesAtTick } from '../src/runtime/particles.ts';
import { scheduleEventRandomKey } from '../src/runtime/random.ts';

const node = (id: string, type: string, params: NodeDefinition['params'] = {}, enabled = true): NodeDefinition =>
  ({ id, type, definitionVersion: 1, label: id, enabled, randomStreamId: `rs-${id}`, params });
const edge = (id: string, s: string, sp: string, t: string, tp: string, order = 0) =>
  ({ id, source: { nodeId: s, port: sp }, target: { nodeId: t, port: tp }, order });
const root = (d: EffectDocumentV2) => d.graphs[0];
const find = (d: EffectDocumentV2, id: string) => root(d).nodes.find(n => n.id === id) as NodeDefinition;

function f01(mutate?: (d: EffectDocumentV2) => void): EffectDocumentV2 {
  const d = createF01Document();
  mutate?.(d);
  return d;
}
function plan(d: EffectDocumentV2): ParticlePreviewPlan {
  const r = compileParticlePreview(d);
  if (!r.ok) assert.fail(`compile failed: ${JSON.stringify(r.errors, null, 1)}`);
  return r.value;
}
function errorsOf(r: ValidationResult<unknown>): Diagnostic[] {
  if (r.ok) assert.fail('expected compile errors');
  return r.errors;
}
const countAt = (p: ParticlePreviewPlan, tick: number, i = 0) => {
  const r = sampleParticlesAtTick(p.systems[i].descriptor, tick);
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  return r.value.particles.length;
};
const set = (id: string, params: NodeDefinition['params']) => (d: EffectDocumentV2) => Object.assign(find(d, id).params, params);

test('F01 graph compiles to one point system and one billboard layer with exact tick 0/59/60 counts', () => {
  const p = plan(f01());
  assert.equal(p.durationTicks, 120);
  assert.equal(p.systems.length, 1);
  assert.equal(p.systems[0].id, 'node-initial');
  assert.deepEqual(p.systems[0].descriptor, {
    documentSeed: 42, durationTicks: 120, emitterId: 'node-emitter', randomStreamId: 'rs-emitter', shape: 'point',
    sourcePosition: [0, 1, 0], initialVelocity: { kind: 'vector', value: [0, 0, 0] },
    bursts: [{ tick: 0, eventRandomKey: scheduleEventRandomKey('rs-schedule', 0, 0), count: 1 }],
    lifetimeTicks: { min: 60, max: 60 }, size: { min: 0.1, max: 0.1 }, operators: [],
  });
  assert.deepEqual(p.layers, [{
    nodeId: 'node-billboard', systemId: 'node-initial', color: { srgb: '#FFFFFF', alpha: 1 }, hueShift: 0,
    opacity: 1, emission: 0, blend: 'additive', alphaCutoff: 0.5, groundFade: 0, renderOrderOffset: 0, visualOrder: 0,
    sizeOverLife: { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
    opacityOverLife: { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
    colorOverLife: { stops: [{ position: 0, color: { srgb: '#FFFFFF', alpha: 1 } }, { position: 1, color: { srgb: '#FFFFFF', alpha: 1 } }] },
    alignment: 'camera', worldAxis: [0, 1, 0], stretchRatio: 1, pivot: 0.5,
  }]);
  assert.equal(countAt(p, 0), 1);
  assert.equal(countAt(p, 59), 1);
  assert.equal(countAt(p, 60), 0);
});

test('changed burst, size and lifetime flow into the descriptor', () => {
  const p = plan(f01(d => { set('node-emitter', { burst: 3, lifetimeMin: 0.5, lifetimeMax: 0.5 })(d); set('node-initial', { sizeMin: 0.2, sizeMax: 0.4 })(d); }));
  const d = p.systems[0].descriptor;
  assert.equal(d.bursts[0].count, 3);
  assert.deepEqual(d.lifetimeTicks, { min: 30, max: 30 });
  assert.deepEqual(d.size, { min: 0.2, max: 0.4 });
  assert.equal(countAt(p, 29), 3);
  assert.equal(countAt(p, 30), 0);
});

test('root transform applies rotation, uniform scale and translation once to position, velocity and size', () => {
  const s = Math.SQRT1_2;
  const p = plan(f01(d => {
    d.rootTransform = { position: [1, 2, 3], rotation: [0, 0, s, s], scale: 2 };
    set('node-emitter', { speedMin: 1, speedMax: 1, direction: [1, 0, 0] })(d);
  }));
  const d = p.systems[0].descriptor;
  const near = (a: number[], b: number[]) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-12, `${a} vs ${b}`));
  near(d.sourcePosition, [-1, 2, 3]);
  assert.equal(d.initialVelocity.kind, 'vector');
  if (d.initialVelocity.kind === 'vector') near(d.initialVelocity.value, [0, 2, 0]);
  assert.deepEqual(d.size, { min: 0.2, max: 0.2 });
});

test('disabled emitter, modifier, renderer, schedule and providers', () => {
  const noEmitter = plan(f01(d => { find(d, 'node-emitter').enabled = false; }));
  assert.deepEqual([noEmitter.systems, noEmitter.layers], [[], []]);

  const bypass = plan(f01(d => { find(d, 'node-initial').enabled = false; }));
  assert.equal(bypass.systems[0].id, 'node-emitter');
  assert.deepEqual(bypass.systems[0].descriptor.size, { min: 0.08, max: 0.16 });

  const noSink = plan(f01(d => { find(d, 'node-billboard').enabled = false; }));
  assert.deepEqual([noSink.systems, noSink.layers], [[], []]);

  const noSchedule = plan(f01(d => { find(d, 'node-schedule').enabled = false; }));
  assert.deepEqual(noSchedule.systems[0].descriptor.bursts, []);

  const mat = errorsOf(compileParticlePreview(f01(d => { find(d, 'node-material').enabled = false; })));
  assert.ok(mat.some(e => e.nodeId === 'node-billboard' && e.code === 'MISSING_REFERENCE'));
  const anchor = errorsOf(compileParticlePreview(f01(d => { find(d, 'node-source').enabled = false; })));
  assert.ok(anchor.some(e => e.nodeId === 'node-emitter' && e.code === 'MISSING_REFERENCE'));
});

test('billboards on one particle chain share a single system', () => {
  const p = plan(f01(d => {
    root(d).nodes.push(node('node-bb2', 'BillboardRenderer', { renderOrderOffset: 2 }), node('node-mat2', 'Material', { blend: 'normal', tint: { srgb: '#808080', alpha: 1 } }));
    root(d).edges.push(
      edge('edge-p2', 'node-initial', 'particles', 'node-bb2', 'particles'),
      edge('edge-m2', 'node-mat2', 'material', 'node-bb2', 'material'),
      edge('edge-v2', 'node-bb2', 'visual', 'node-output', 'visual', 1),
    );
  }));
  assert.equal(p.systems.length, 1);
  assert.deepEqual(p.layers.map(l => [l.nodeId, l.systemId, l.blend, l.renderOrderOffset]),
    [['node-billboard', 'node-initial', 'additive', 0], ['node-bb2', 'node-initial', 'normal', 2]]);
});

test('group-wrapped chain compiles to the same plan as F01', () => {
  const d = createF01Document();
  const g = root(d);
  const keep = ['node-material', 'node-output', 'node-target'];
  const moved = g.nodes.filter(n => !keep.includes(n.id));
  g.nodes = [...g.nodes.filter(n => keep.includes(n.id)), node('node-group', 'Group', { graphId: 'graph-child' })];
  g.edges = [
    edge('edge-mat-in', 'node-material', 'material', 'node-group', 'mat'),
    edge('edge-group-out', 'node-group', 'fx', 'node-output', 'visual'),
  ];
  d.graphs.push({
    id: 'graph-child',
    inputs: [{ id: 'mat', label: 'Material', type: 'material', cardinality: 'one', required: true, direction: 'input' }],
    outputs: [{ id: 'fx', label: 'Visual', type: 'visual', cardinality: 'one', required: false, direction: 'output' }],
    nodes: [...moved, node('node-gin', 'GroupInput', { portId: 'mat' }), node('node-gout', 'GroupOutput', { portId: 'fx' })],
    edges: [
      edge('edge-trigger', 'node-schedule', 'start', 'node-emitter', 'trigger'),
      edge('edge-anchor', 'node-source', 'out', 'node-emitter', 'anchor'),
      edge('edge-emit', 'node-emitter', 'particles', 'node-initial', 'particles'),
      edge('edge-initial', 'node-initial', 'particles', 'node-billboard', 'particles'),
      edge('edge-child-mat', 'node-gin', 'out', 'node-billboard', 'material'),
      edge('edge-child-out', 'node-billboard', 'visual', 'node-gout', 'in'),
    ],
  });
  d.editor.graphs['graph-root'].nodes = { 'node-material': { x: 0, y: 0 } };
  assert.deepEqual(plan(d), plan(f01()));
});

test('unsupported settings are addressed errors, never ignored', () => {
  const cases: Array<[string, NodeDefinition['params'], string]> = [
    ['node-emitter', { shape: 'path' }, 'shape'],
    ['node-emitter', { space: 'local' }, 'space'],
    ['node-billboard', { alignment: 'worldAxis', worldAxis: [0, 0, 0] }, 'worldAxis'],
    ['node-billboard', { softIntersection: true }, 'softIntersection'],
  ];
  for (const [id, params, field] of cases) {
    const errs = errorsOf(compileParticlePreview(f01(set(id, params))));
    assert.ok(errs.some(e => e.nodeId === id && e.fieldPath?.endsWith(`params.${field}`)), field);
  }
});

test('schedule mapping: end output, repeat events dropped at document end, clamped rate window', () => {
  const end = plan(f01(d => { root(d).edges[0].source.port = 'end'; }));
  assert.deepEqual(end.systems[0].descriptor.bursts.map(b => b.tick), [60]);

  const rep = plan(f01(set('node-schedule', { mode: 'repeat', startTicks: 100, repeatIntervalTicks: 10, repeatCount: 5 })));
  assert.deepEqual(rep.systems[0].descriptor.bursts.map(b => [b.tick, b.eventRandomKey]),
    [[100, scheduleEventRandomKey('rs-schedule', 100, 0)], [110, scheduleEventRandomKey('rs-schedule', 110, 1)]]);

  const rate = plan(f01(d => {
    set('node-emitter', { rate: 60, burst: 0 })(d);
    set('node-schedule', { startTicks: 10, durationTicks: 200, mode: 'window' })(d);
    root(d).edges.push(edge('edge-window', 'node-schedule', 'window', 'node-emitter', 'window'));
  }));
  assert.deepEqual(rate.systems[0].descriptor.rate, { perSecond: 60, startTick: 10, endTick: 120 });
  assert.deepEqual(rate.systems[0].descriptor.bursts, []);

  const dup = errorsOf(compileParticlePreview(f01(d => { root(d).edges.push(edge('edge-trigger2', 'node-schedule', 'start', 'node-emitter', 'trigger', 1)); })));
  assert.ok(dup.some(e => e.code === 'DUPLICATE_ID' && e.nodeId === 'node-emitter'));
});

test('aggregate budget rejects excessive total births and live particles', () => {
  const total = errorsOf(compileParticlePreview(f01(d => {
    set('node-emitter', { burst: 4096 })(d);
    set('node-schedule', { mode: 'repeat', repeatIntervalTicks: 5, repeatCount: 20 })(d);
  })));
  assert.ok(total.some(e => e.code === 'BUDGET_EXCEEDED' && /total/.test(e.message)));
  const live = errorsOf(compileParticlePreview(f01(d => {
    set('node-emitter', { burst: 4096 })(d);
    set('node-schedule', { mode: 'repeat', repeatIntervalTicks: 1, repeatCount: 3 })(d);
  })));
  assert.ok(live.some(e => e.code === 'BUDGET_EXCEEDED' && /alive/.test(e.message)));
});

test('color multiplies in linear RGB and alphas multiply', () => {
  assert.deepEqual(multiplyColors({ srgb: '#FF0000', alpha: 0.5 }, { srgb: '#808080', alpha: 1 }), { srgb: '#800000', alpha: 0.5 });
  const p = plan(f01(d => {
    set('node-initial', { color: { srgb: '#FF0000', alpha: 0.5 } })(d);
    set('node-material', { tint: { srgb: '#808080', alpha: 1 } })(d);
  }));
  assert.deepEqual(p.layers[0].color, { srgb: '#800000', alpha: 0.5 });
});

test('authored billboard life curves flow into the layer as copies', () => {
  const size = { domain: 'normalized' as const, interpolation: 'linear' as const, keys: [{ x: 0, y: 0.5 }, { x: 1, y: 4 }] };
  const opacity = { domain: 'normalized' as const, interpolation: 'hold' as const, keys: [{ x: 0, y: 1 }, { x: 0.8, y: 0 }] };
  const d = f01(set('node-billboard', { sizeOverLife: size, opacityOverLife: opacity }));
  const p = plan(d);
  assert.deepEqual(p.layers[0].sizeOverLife, size);
  assert.deepEqual(p.layers[0].opacityOverLife, opacity);
  assert.notEqual(p.layers[0].sizeOverLife, find(d, 'node-billboard').params.sizeOverLife);
});

test('out-of-bounds life curves are addressed errors', () => {
  for (const [id, y] of [['sizeOverLife', 25], ['opacityOverLife', 1.5]] as const) {
    const errors = errorsOf(compileParticlePreview(f01(set('node-billboard', {
      [id]: { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 1 }, { x: 1, y }] },
    }))));
    assert.ok(errors.some(e => (e.fieldPath ?? '').includes(id)), JSON.stringify(errors));
  }
});

test('compiling does not mutate the input document', () => {
  const d = f01();
  const before = JSON.stringify(d);
  plan(d);
  assert.equal(JSON.stringify(d), before);
});

test('two schedule windows are rejected before particle lowering can drop the rate', () => {
  const document = f01(d => {
    find(d, 'node-emitter').params.rate = 10;
    root(d).nodes.push(node('schedule-second', 'Schedule', { startTicks: 0, durationTicks: 60, mode: 'once' }));
    root(d).edges.push(
      edge('window-first', 'node-schedule', 'window', 'node-emitter', 'window'),
      edge('window-second', 'schedule-second', 'window', 'node-emitter', 'window', 1),
    );
  });
  const errors = errorsOf(compileParticlePreview(document));
  assert.ok(errors.some(d => d.nodeId === 'node-emitter' && /window/.test(d.message)), JSON.stringify(errors));
});

// Inserts Emitter→Initial→[Gravity]→[Drag]→Billboard by rewiring the billboard's particle input.
function withForces(opts: { gravity?: NodeDefinition['params']; drag?: NodeDefinition['params']; gravityEnabled?: boolean; order?: 'gd' | 'dg' }) {
  return f01(d => {
    const g = root(d);
    const into = g.edges.find(e => e.target.nodeId === 'node-billboard' && e.target.port === 'particles')!;
    const chain = (opts.order ?? 'gd') === 'gd' ? ['node-gravity', 'node-drag'] : ['node-drag', 'node-gravity'];
    g.nodes.push(node('node-gravity', 'Gravity', opts.gravity ?? {}, opts.gravityEnabled ?? true), node('node-drag', 'Drag', opts.drag ?? {}));
    g.edges.push(edge('e-f1', into.source.nodeId, 'particles', chain[0], 'particles'), edge('e-f2', chain[0], 'particles', chain[1], 'particles'));
    into.source = { nodeId: chain[1], port: 'particles' };
  });
}

test('Gravity and Drag compile to operators in declared order; chain identity is the modifier nearest the renderer', () => {
  const p = plan(withForces({ gravity: { acceleration: [0, -5, 0] }, drag: { coefficient: 2 } }));
  assert.equal(p.systems[0].id, 'node-drag');
  assert.deepEqual(p.systems[0].descriptor.operators, [{ kind: 'gravity', acceleration: [0, -5, 0] }, { kind: 'drag', coefficient: 2 }]);
  assert.equal(p.layers[0].systemId, 'node-drag');
  const q = plan(withForces({ order: 'dg' }));
  assert.equal(q.systems[0].id, 'node-gravity');
  assert.deepEqual(q.systems[0].descriptor.operators, [{ kind: 'drag', coefficient: 0.8 }, { kind: 'gravity', acceleration: [0, -9.81, 0] }]);
});

test('disabled Gravity bypasses; gravity scales with the effect transform and moves particles', () => {
  const off = plan(withForces({ gravityEnabled: false, drag: { coefficient: 0 } }));
  assert.deepEqual(off.systems[0].descriptor.operators, [{ kind: 'drag', coefficient: 0 }]);
  const scaled = plan(withForces({ gravity: { acceleration: [0, -10, 0] }, drag: { coefficient: 0 } }));
  const before = sampleParticlesAtTick(scaled.systems[0].descriptor, 0), after = sampleParticlesAtTick(scaled.systems[0].descriptor, 30);
  if (!before.ok || !after.ok) assert.fail('sample failed');
  assert.ok(after.value.particles[0].position[1] < before.value.particles[0].position[1] - 1, 'particle falls under gravity');
  const big = plan(f01(d => { d.rootTransform.scale = 2; }));
  assert.equal(big.systems.length, 1);
  const two = compileParticlePreview((() => { const d = withForces({ gravity: { acceleration: [0, -3, 0] } }); d.rootTransform.scale = 2; return d; })());
  if (!two.ok) assert.fail(JSON.stringify(two.errors));
  assert.deepEqual(two.value.systems[0].descriptor.operators[0], { kind: 'gravity', acceleration: [0, -6, 0] });
});

test('force Strength: a literal scales the operator; an EffectTimeCurve becomes a per-tick gain; disabled curve falls back', () => {
  const p = plan(withForces({ gravity: { acceleration: [0, -10, 0], strength: 0.5 }, drag: { coefficient: 2, strength: 0.25 } }));
  assert.deepEqual(p.systems[0].descriptor.operators, [{ kind: 'gravity', acceleration: [0, -5, 0] }, { kind: 'drag', coefficient: 0.5 }]);
  const ramp = (enabled: boolean) => (() => {
    const d = withForces({ gravity: { strength: 0.3 } });
    root(d).nodes.push({ ...node('node-ramp', 'EffectTimeCurve', { curve: { domain: 'effectSeconds', interpolation: 'linear', keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } }), enabled });
    root(d).edges.push(edge('e-ramp', 'node-ramp', 'value', 'node-gravity', 'strength'));
    return d;
  })();
  const g = plan(ramp(true)).systems[0].descriptor.operators[0] as { acceleration: number[]; gain?: number[] };
  assert.deepEqual(g.acceleration, [0, -9.81, 0]);
  assert.equal(g.gain!.length, 121);
  assert.deepEqual([g.gain![0], g.gain![30], g.gain![60], g.gain![90]], [0, 0.5, 1, 1]);
  const off = plan(ramp(false)).systems[0].descriptor.operators[0] as { acceleration: number[]; gain?: number[] };
  assert.equal(off.gain, undefined);
  assert.ok(Math.abs(off.acceleration[1] + 9.81 * 0.3) < 1e-12);
});

test('Oscillator waves start at min and drive force Strength as a per-tick gain', () => {
  assert.deepEqual((['sine', 'triangle', 'square', 'saw'] as const).map(w => [0, 0.25, 0.5].map(u => Math.round(waveAt(w, u) * 1e9) / 1e9)), [[0, 0.5, 1], [0, 0.5, 1], [0, 0, 1], [0, 0.25, 0.5]]);
  const d = withForces({});
  root(d).nodes.push(node('node-osc', 'Oscillator', { waveform: 'square', frequency: 1, min: 0.2, max: 0.8 }));
  root(d).edges.push(edge('e-osc', 'node-osc', 'value', 'node-gravity', 'strength'));
  const g = (plan(d).systems[0].descriptor.operators[0] as { gain?: number[] }).gain!;
  assert.deepEqual([g[0], g[29], g[30], g[59], g[60]], [0.2, 0.2, 0.8, 0.8, 0.2]);
});

test('cone emitter with speed range and aim anchor compiles to a shaped, aimed descriptor', () => {
  const p = plan(f01(d => {
    set('node-emitter', { shape: 'cone', coneAngle: 0.2, radius: 0.1, speedMin: 2, speedMax: 3, burst: 50 })(d);
    root(d).edges.push(edge('e-aim', 'node-target', 'out', 'node-emitter', 'aim'));
  }));
  const em = p.systems[0].descriptor.emission!;
  assert.equal(p.systems[0].descriptor.shape, 'cone');
  assert.deepEqual(em.axis.map(v => Math.round(v * 1e9) / 1e9), [0, 0, 1]);
  assert.deepEqual([em.radius, em.coneAngle, em.speed], [0.1, 0.2, { min: 2, max: 3 }]);
  const r = sampleParticlesAtTick(p.systems[0].descriptor, 0);
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  for (const q of r.value.particles) assert.ok(q.velocity[2] > 1.9, 'aimed toward target (+Z)');
});

test('aim pointing at the emitter position itself is an addressed error', () => {
  const errs = errorsOf(compileParticlePreview(f01(d => { root(d).edges.push(edge('e-aim', 'node-source', 'out', 'node-emitter', 'aim')); })));
  assert.ok(errs.some(e => e.nodeId === 'node-emitter' && /coincides/.test(e.message)));
});

test('InitialProperties spin, velocity alignment, stretch, pivot and colour over life flow into the plan', () => {
  const grad = { stops: [{ position: 0, color: { srgb: '#FFFFFF', alpha: 1 } }, { position: 1, color: { srgb: '#FF2000', alpha: 0 } }] };
  const p = plan(f01(d => {
    set('node-initial', { rotationMin: 0, rotationMax: 1, angularVelocityMin: -2, angularVelocityMax: 2 })(d);
    set('node-billboard', { alignment: 'velocity', stretchRatio: 3, pivot: 0.8, colorOverLife: grad })(d);
    set('node-emitter', { burst: 20 })(d);
  }));
  assert.deepEqual(p.systems[0].descriptor.spin, { rotation: { min: 0, max: 1 }, angularVelocity: { min: -2, max: 2 } });
  assert.deepEqual([p.layers[0].alignment, p.layers[0].stretchRatio, p.layers[0].pivot], ['velocity', 3, 0.8]);
  assert.deepEqual(p.layers[0].colorOverLife, grad);
  const r = sampleParticlesAtTick(p.systems[0].descriptor, 0);
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  const rots = r.value.particles.map(q => q.rotation as number), ws = r.value.particles.map(q => q.angularVelocity as number);
  assert.ok(rots.every(v => v >= 0 && v <= 1) && new Set(rots).size > 10, 'rotation sampled per particle');
  assert.ok(ws.every(v => v >= -2 && v <= 2) && ws.some(v => v < 0) && ws.some(v => v > 0), 'angular velocity sampled per particle');
  assert.equal(plan(f01()).systems[0].descriptor.spin, undefined, 'zero spin keeps the plain descriptor');
});

test('GroundCollision compiles to a ground operator; its collision output is an addressed error until ParticleEvents exist', () => {
  const p = plan(f01(d => {
    const g = root(d), into = g.edges.find(e => e.target.nodeId === 'node-billboard' && e.target.port === 'particles')!;
    g.nodes.push(node('node-ground', 'GroundCollision', { mode: 'kill' }));
    g.edges.push(edge('e-g', into.source.nodeId, 'particles', 'node-ground', 'particles'));
    into.source = { nodeId: 'node-ground', port: 'particles' };
  }));
  assert.deepEqual(p.systems[0].descriptor.operators, [{ kind: 'ground', mode: 'kill', restitution: 0.2, friction: 0.5, maxBounces: 2 }]);
});

test('NoiseForce compiles to a seeded noise operator scaled with the effect transform', () => {
  const d = f01(dd => {
    const g = root(dd), into = g.edges.find(e => e.target.nodeId === 'node-billboard' && e.target.port === 'particles')!;
    g.nodes.push(node('node-noise', 'NoiseForce', { amplitude: 2, frequency: 0.5, mode: 'vector' }));
    g.edges.push(edge('e-n', into.source.nodeId, 'particles', 'node-noise', 'particles'));
    into.source = { nodeId: 'node-noise', port: 'particles' };
    dd.rootTransform.scale = 2;
  });
  assert.deepEqual(plan(d).systems[0].descriptor.operators, [{ kind: 'noise', mode: 'vector', amplitude: 4, frequency: 0.25, evolution: 0.5, randomStreamId: 'rs-node-noise' }]);
});

test('SpriteTextured material puts the library sheet and flipbook settings on the layer', () => {
  const p = plan(f01(d => {
    set('node-material', { template: 'SpriteTextured', sprite: 'flame-tongue-b' })(d);
    set('node-billboard', { flipbookMode: 'fps', flipbookFps: 12 })(d);
    set('node-initial', { randomFrameStart: true })(d);
  }));
  const s = p.layers[0].sprite!;
  assert.deepEqual([s.sheet.id, s.sheet.columns, s.sheet.rows, s.mode, s.fps, s.randomStart], ['flame-tongue-b', 4, 4, 'fps', 12, true]);
  assert.equal(plan(f01()).layers[0].sprite, undefined);
});

// Drops fall from the F01 emitter, die on the ground, and a child "splash" emitter bursts at each impact.
function splashDoc(opts: { via: 'collision' | 'death'; probability?: number; maxEvents?: number }) {
  return f01(d => {
    const g = root(d), into = g.edges.find(e => e.target.nodeId === 'node-billboard' && e.target.port === 'particles')!;
    set('node-emitter', { burst: 40, shape: 'cone', coneAngle: 0.8, direction: [0, 1, 0], speedMin: 1, speedMax: 3 })(d);
    g.nodes.push(node('node-grav', 'Gravity'), node('node-ground', 'GroundCollision', { mode: 'kill' }),
      node('node-splash', 'Emitter', { burst: 5, shape: 'sphere', speedMin: 1, speedMax: 1, lifetimeMin: 0.2, lifetimeMax: 0.2, useEventPosition: true }),
      node('node-splash-bb', 'BillboardRenderer'));
    g.edges.push(edge('e-g', into.source.nodeId, 'particles', 'node-grav', 'particles'), edge('e-gr', 'node-grav', 'particles', 'node-ground', 'particles'));
    into.source = { nodeId: 'node-ground', port: 'particles' };
    if (opts.via === 'collision') g.edges.push(edge('e-hit', 'node-ground', 'collision', 'node-splash', 'trigger'));
    else {
      g.nodes.push(node('node-events', 'ParticleEvents', { probability: opts.probability ?? 1, maxEvents: opts.maxEvents ?? 256 }));
      g.edges.push(edge('e-ev', 'node-ground', 'particles', 'node-events', 'particles'), edge('e-hit', 'node-events', 'death', 'node-splash', 'trigger'));
    }
    g.edges.push(edge('e-sp', 'node-splash', 'particles', 'node-splash-bb', 'particles'), edge('e-sm', 'node-material', 'material', 'node-splash-bb', 'material'), edge('e-sv', 'node-splash-bb', 'visual', 'node-output', 'visual', 1));
  });
}

test('GroundCollision collision events trigger a child emitter at each impact position', () => {
  const p = plan(splashDoc({ via: 'collision' }));
  const splash = p.systems.find(s => s.descriptor.emitterId === 'node-splash')!;
  assert.equal(splash.descriptor.bursts.length, 40, 'one burst per drop impact');
  assert.ok(splash.descriptor.bursts.every(b => b.count === 5 && b.position !== undefined && b.position[1] === 0 && b.tick > 0));
  const r = sampleParticlesAtTick(splash.descriptor, splash.descriptor.bursts[0].tick);
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  assert.ok(r.value.particles.length >= 5);
});

test('ParticleEvents death events honour probability and maxEvents deterministically', () => {
  const all = plan(splashDoc({ via: 'death' })).systems.find(s => s.descriptor.emitterId === 'node-splash')!;
  assert.equal(all.descriptor.bursts.length, 40);
  const half = plan(splashDoc({ via: 'death', probability: 0.5 })).systems.find(s => s.descriptor.emitterId === 'node-splash')!;
  assert.ok(half.descriptor.bursts.length > 8 && half.descriptor.bursts.length < 32, `~half (${half.descriptor.bursts.length})`);
  assert.deepEqual(half, plan(splashDoc({ via: 'death', probability: 0.5 })).systems.find(s => s.descriptor.emitterId === 'node-splash'));
  const capped = plan(splashDoc({ via: 'death', maxEvents: 7 })).systems.find(s => s.descriptor.emitterId === 'node-splash')!;
  assert.equal(capped.descriptor.bursts.length, 7);
});

test('ParticleTrail compiles to a trail layer on the chain system (and can be the only sink)', () => {
  const p = plan(f01(d => {
    const g = root(d);
    g.nodes.push(node('node-trail', 'ParticleTrail', { history: 0.25, width: 0.02 }));
    g.edges.push(edge('e-tp', 'node-initial', 'particles', 'node-trail', 'particles'), edge('e-tm', 'node-material', 'material', 'node-trail', 'material'), edge('e-tv', 'node-trail', 'visual', 'node-output', 'visual', 1));
  }));
  assert.equal(p.trails.length, 1);
  assert.deepEqual([p.trails[0].systemId, p.trails[0].historyTicks, p.trails[0].width, p.trails[0].visualOrder], ['node-initial', 15, 0.02, 1]);
  assert.equal(p.systems.length, 1, 'shares the billboard system');
  assert.deepEqual(plan(f01()).trails, []);
});

test('SpriteRenderer compiles to a one-particle system living for its window, with window curves', () => {
  const p = plan(f01(d => {
    const g = root(d);
    g.nodes.push(node('node-flash-win', 'Schedule', { startTicks: 30, durationTicks: 20, mode: 'window' }),
      node('node-flash', 'SpriteRenderer', { size: 1.5, spin: 2, sizeOverWindow: { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 0 }, { x: 1, y: 2 }] } }));
    g.edges.push(edge('e-fa', 'node-target', 'out', 'node-flash', 'anchor'), edge('e-fm', 'node-material', 'material', 'node-flash', 'material'),
      edge('e-fw', 'node-flash-win', 'window', 'node-flash', 'window'), edge('e-fv', 'node-flash', 'visual', 'node-output', 'visual', 1));
  }));
  const sys = p.systems.find(s => s.id === 'node-flash')!.descriptor;
  assert.deepEqual([sys.sourcePosition, sys.bursts[0].tick, sys.bursts[0].count, sys.lifetimeTicks.min, sys.size.min], [[0, 1, 5], 30, 1, 20, 1.5]);
  assert.deepEqual(sys.spin, { rotation: { min: 0, max: 0 }, angularVelocity: { min: 2, max: 2 } });
  const layer = p.layers.find(l => l.nodeId === 'node-flash')!;
  assert.equal(layer.sizeOverLife.keys[1].y, 2);
  const at = (t: number) => { const r = sampleParticlesAtTick(sys, t); if (!r.ok) assert.fail('sample'); return r.value.particles.length; };
  assert.deepEqual([at(29), at(30), at(49), at(50)], [0, 1, 1, 0]);
});

test('PointLight compiles to a light layer at its anchor over its window', () => {
  const p = plan(f01(d => {
    const g = root(d);
    g.nodes.push(node('node-lw', 'Schedule', { startTicks: 5, durationTicks: 40, mode: 'window' }), node('node-light', 'PointLight', { intensity: 30, range: 4, flicker: 0.3 }));
    g.edges.push(edge('e-la', 'node-source', 'out', 'node-light', 'anchor'), edge('e-lw', 'node-lw', 'window', 'node-light', 'window'), edge('e-lv', 'node-light', 'visual', 'node-output', 'visual', 1));
  }));
  const l = p.lights[0];
  assert.deepEqual([l.nodeId, l.position, l.intensity, l.range, l.startTick, l.endTick, l.flicker], ['node-light', [0, 1, 0], 30, 4, 5, 45, 0.3]);
  assert.ok(Number.isInteger(l.seed));
  assert.deepEqual(plan(f01()).lights, []);
});

// Line from Source (0,1,0) to Target (0,1,5) followed over 20 ticks from tick 10; arrival triggers a burst.
function followerDoc(extra?: (d: EffectDocumentV2) => void) {
  return f01(d => {
    const g = root(d);
    g.nodes.push(node('node-line', 'LinePath', { samples: 8 }), node('node-fw', 'Schedule', { startTicks: 10, durationTicks: 40, mode: 'window' }), node('node-follow', 'PathFollower', { durationTicks: 20 }));
    g.edges.push(edge('e-ls', 'node-source', 'out', 'node-line', 'start'), edge('e-le', 'node-target', 'out', 'node-line', 'end'),
      edge('e-fp', 'node-line', 'paths', 'node-follow', 'paths'), edge('e-fw', 'node-fw', 'window', 'node-follow', 'window'));
    extra?.(d);
  });
}

test('PathFollower moves an emitter along its path and fires arrival at start + travel', () => {
  const p = plan(followerDoc(d => {
    const g = root(d);
    g.edges = g.edges.filter(e => e.id !== 'edge-anchor');
    g.edges.push(edge('e-fa', 'node-follow', 'anchor', 'node-emitter', 'anchor'));
    set('node-emitter', { burst: 0, rate: 60 })(d);
    set('node-schedule', { mode: 'window', durationTicks: 60 })(d);
    const trig = g.edges.find(e => e.id === 'edge-trigger')!; trig.source.port = 'window'; trig.target.port = 'window';
  }));
  const t = p.systems[0].descriptor.sourceTrack!;
  assert.equal(t.startTick, 10);
  assert.deepEqual(t.positions[0], [0, 1, 0]);
  assert.ok(Math.abs(t.positions[10][2] - 2.5) < 1e-9, 'halfway at tick 20');
  assert.deepEqual(t.positions[30], [0, 1, 5], 'held at the end after arrival');
  const r = sampleParticlesAtTick(p.systems[0].descriptor, 25);
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  const newest = r.value.particles.at(-1)!;
  assert.ok(Math.abs(newest.position[2] - 3.75) < 1e-9, `newest particle born on the moving source (${newest.position[2]})`);
});

test('PathFollower arrival triggers a burst at the path end', () => {
  const p = plan(followerDoc(d => {
    const g = root(d);
    g.edges = g.edges.filter(e => e.id !== 'edge-anchor' && e.id !== 'edge-trigger');
    g.edges.push(edge('e-arr', 'node-follow', 'arrival', 'node-emitter', 'trigger'));
    set('node-emitter', { burst: 12, useEventPosition: true })(d);
  }));
  const b = p.systems[0].descriptor.bursts;
  assert.equal(b.length, 1);
  assert.deepEqual([b[0].tick, b[0].count, b[0].position], [30, 12, [0, 1, 5]]);
});

test('PathFollower speed mode: travel = path length ÷ speed (rounded ticks), so the arrival burst follows the distance', () => {
  const arrivalTick = (speed: number, target?: [number, number, number]) => plan(followerDoc(d => {
    const g = root(d);
    g.edges = g.edges.filter(e => e.id !== 'edge-anchor' && e.id !== 'edge-trigger');
    g.edges.push(edge('e-arr', 'node-follow', 'arrival', 'node-emitter', 'trigger'));
    set('node-follow', { speed })(d);
    if (target) d.anchors.find(a => a.id === 'target')!.position = target;
  })).systems[0].descriptor.bursts[0].tick;
  assert.equal(arrivalTick(0), 30, 'speed 0 keeps Travel ticks (20)');
  assert.equal(arrivalTick(10), 10 + 30, '5 m at 10 m/s = 30 ticks');
  assert.equal(arrivalTick(10, [0, 1, 10]), 10 + 60, 'twice the distance, same speed: twice the travel');
  assert.equal(arrivalTick(7), 10 + 43, '5/7 s = 42.86 ticks, rounded');
});

test('Emitter rateOverWindow compiles to a rate curve (flat curves stay plain)', () => {
  const win = (d: EffectDocumentV2) => { set('node-emitter', { burst: 0, rate: 30 })(d); set('node-schedule', { mode: 'window', durationTicks: 60 })(d); const t = root(d).edges.find(e => e.id === 'edge-trigger')!; t.source.port = 'window'; t.target.port = 'window'; };
  const p = plan(f01(d => { win(d); set('node-emitter', { rateOverWindow: { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 0 }, { x: 1, y: 2 }] } })(d); }));
  assert.deepEqual(p.systems[0].descriptor.rate!.curve, [{ x: 0, y: 0 }, { x: 1, y: 2 }]);
  assert.equal(plan(f01(win)).systems[0].descriptor.rate!.curve, undefined);
});

test('Material rim reaches mesh layers only when switched on', () => {
  const meshDoc = (rim: number) => f01(d => {
    const g = root(d);
    g.nodes.push(node('node-rocks', 'MeshRenderer', { mesh: 'orb' }));
    g.edges.push(edge('e-mp', 'node-initial', 'particles', 'node-rocks', 'particles'), edge('e-mm', 'node-material', 'material', 'node-rocks', 'material'), edge('e-mv', 'node-rocks', 'visual', 'node-output', 'visual', 1));
    set('node-material', { rim, rimColor: { srgb: '#40E0FF', alpha: 1 }, rimPower: 2 })(d);
  });
  assert.equal(plan(meshDoc(0)).meshes[0].rim, undefined);
  assert.deepEqual(plan(meshDoc(3)).meshes[0].rim, { strength: 3, color: { srgb: '#40E0FF', alpha: 1 }, power: 2 });
});

test('Material UV ops and sprite rim reach billboard layers only when they differ from identity/off', () => {
  assert.equal(plan(f01()).layers[0].uv, undefined);
  assert.equal(plan(f01()).layers[0].rim, undefined);
  const l = plan(f01(set('node-material', { uvTiling: [2, 3], uvRotation: 0.5, uvScroll: [0.1, 0], rim: 2, rimPower: 4 }))).layers[0];
  assert.deepEqual(l.uv, { tiling: [2, 3], offset: [0, 0], rotation: 0.5, scroll: [0.1, 0] });
  assert.deepEqual(l.rim, { strength: 2, color: { srgb: '#FFFFFF', alpha: 1 }, power: 4 });
});

test('MeshRenderer compiles to a mesh layer on the chain system', () => {
  const p = plan(f01(d => {
    const g = root(d);
    g.nodes.push(node('node-rocks', 'MeshRenderer', { mesh: 'shard', scale: 2, orientation: 'velocity' }));
    g.edges.push(edge('e-mp', 'node-initial', 'particles', 'node-rocks', 'particles'), edge('e-mm', 'node-material', 'material', 'node-rocks', 'material'), edge('e-mv', 'node-rocks', 'visual', 'node-output', 'visual', 1));
  }));
  assert.deepEqual([p.meshes[0].systemId, p.meshes[0].mesh, p.meshes[0].scale, p.meshes[0].orientation, p.meshes[0].lit], ['node-initial', 'shard', 2, 'velocity', true]);
  assert.deepEqual(plan(f01()).meshes, []);
});

test('RandomRange drives a parameter with one seeded sample per cast; its unit must match', () => {
  const withRandom = (unit: string, seed = 42) => f01(d => {
    d.seed = seed;
    root(d).nodes.push(node('node-rand', 'RandomRange', { min: 5, max: 9, unit }));
    root(d).edges.push(edge('e-r', 'node-rand', 'value', 'node-emitter', 'burst'));
  });
  const counts = [1, 2, 3, 4, 5, 6].map(s => plan(withRandom('none', s)).systems[0].descriptor.bursts[0].count);
  assert.ok(counts.every(c => Number.isInteger(c) && c >= 5 && c <= 9), JSON.stringify(counts));
  assert.ok(new Set(counts).size > 1, 'different seeds give different casts');
  assert.equal(plan(withRandom('none', 3)).systems[0].descriptor.bursts[0].count, counts[2], 'deterministic');
  const errs = errorsOf(compileParticlePreview(withRandom('meter')));
  assert.ok(errs.some(e => e.code === 'TYPE_MISMATCH'), JSON.stringify(errs.map(e => e.code)));
});

test('Constant and ScalarMath drive a parameter; chains evaluate once per cast; units are checked', () => {
  const withMath = (op: string, unit = 'none', aUnit = 'none') => f01(d => {
    root(d).nodes.push(node('node-c', 'Constant', { value: 3, unit: aUnit }), node('node-m', 'ScalarMath', { operation: op, b: 4, unit }));
    root(d).edges.push(edge('e-c', 'node-c', 'value', 'node-m', 'a'), edge('e-m', 'node-m', 'value', 'node-emitter', 'burst'));
  });
  const count = (op: string) => plan(withMath(op)).systems[0].descriptor.bursts[0].count;
  assert.deepEqual(['add', 'min', 'multiply', 'max'].map(count), [7, 3, 12, 4]);
  assert.ok(errorsOf(compileParticlePreview(withMath('add', 'meter', 'meter'))).some(e => e.code === 'TYPE_MISMATCH'), 'meter output into unitless burst');
  assert.ok(errorsOf(compileParticlePreview(withMath('add', 'none', 'meter'))).some(e => e.code === 'TYPE_MISMATCH'), 'meter constant into unitless a');
});

test('EventDelay shifts trigger ticks; MergeEvents unions streams; disabled delay passes through', () => {
  const base = plan(f01()).systems[0].descriptor.bursts.map(b => b.tick);
  const routed = (delayEnabled = true) => f01(d => {
    const g = root(d);
    g.edges = g.edges.filter(e => e.id !== 'edge-trigger');
    g.nodes.push({ ...node('node-delay', 'EventDelay', { delayTicks: 7 }), enabled: delayEnabled }, node('node-merge', 'MergeEvents', {}));
    g.edges.push(edge('e-d', 'node-schedule', 'start', 'node-delay', 'events'), edge('e-m1', 'node-delay', 'event', 'node-merge', 'events'),
      edge('e-m2', 'node-schedule', 'start', 'node-merge', 'events', 1), edge('e-t', 'node-merge', 'event', 'node-emitter', 'trigger'));
  });
  assert.deepEqual(plan(routed()).systems[0].descriptor.bursts.map(b => b.tick).sort((a, b) => a - b), [...base, ...base.map(t => t + 7)].sort((a, b) => a - b));
  assert.ok(errorsOf(compileParticlePreview(routed(false))).some(e => e.code === 'DUPLICATE_ID'), 'bypassed delay makes the merged streams identical');
});

test('MotionTrail compiles to a trail layer over a one-particle system attached to the follower track', () => {
  const p = plan(followerDoc(d => {
    const g = root(d);
    g.nodes.push(node('node-mt', 'MotionTrail', { history: 0.2, width: 0.3 }));
    g.edges.push(edge('e-ma', 'node-follow', 'anchor', 'node-mt', 'anchor'), edge('e-mm', 'node-material', 'material', 'node-mt', 'material'),
      edge('e-mw', 'node-fw', 'window', 'node-mt', 'window'), edge('e-mv', 'node-mt', 'visual', 'node-output', 'visual', 1));
  }));
  const sys = p.systems.find(s => s.id === 'node-mt')!.descriptor;
  assert.equal(sys.attachToSource, true);
  assert.equal(sys.sourceTrack!.startTick, 10);
  assert.deepEqual([p.trails[0].nodeId, p.trails[0].historyTicks, p.trails[0].width], ['node-mt', 12, 0.3]);
  const r = sampleParticlesAtTick(sys, 20);
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  assert.ok(Math.abs(r.value.particles[0].position[2] - 2.5) < 1e-9, 'the particle rides the follower');
});

test('OffsetAnchor chains add offsets to the emitter source; disabled passes through', () => {
  const src = (enabled: boolean) => plan(f01(d => {
    const g = root(d);
    g.edges = g.edges.filter(e => e.id !== 'edge-anchor');
    g.nodes.push({ ...node('node-off1', 'OffsetAnchor', { offset: [1, 0, 0] }), enabled }, node('node-off2', 'OffsetAnchor', { offset: [0, 0.5, -2] }));
    g.edges.push(edge('e-o1', 'node-source', 'out', 'node-off1', 'anchor'), edge('e-o2', 'node-off1', 'out', 'node-off2', 'anchor'), edge('e-oe', 'node-off2', 'out', 'node-emitter', 'anchor'));
  })).systems[0].descriptor.sourcePosition;
  const base = plan(f01()).systems[0].descriptor.sourcePosition;
  assert.deepEqual(src(true), [base[0] + 1, base[1] + 0.5, base[2] - 2]);
  assert.deepEqual(src(false), [base[0], base[1] + 0.5, base[2] - 2]);
});

test('ParticlePaths: anchor-to-particle lines to a stable selection of live particles, capped by maxCount', () => {
  const d = f01(dd => {
    root(dd).nodes.push(node('node-pp', 'ParticlePaths', { maxCount: 3, samples: 4 }));
    root(dd).edges.push(edge('e-pp', 'node-emitter', 'particles', 'node-pp', 'particles'), edge('e-pa', 'node-source', 'out', 'node-pp', 'anchor'));
  });
  const probe = (tick: number) => { const r = compilePathPreview(d, tick, { probe: { nodeId: 'node-pp', port: 'paths' } }); if (!r.ok) assert.fail(JSON.stringify(r.errors)); return r.value.probe!; };
  const sys = plan(f01()).systems[0].descriptor, alive = sampleParticlesAtTick(sys, 10);
  if (!alive.ok) assert.fail('sample');
  const paths = probe(10);
  assert.equal(paths.length, Math.min(3, alive.value.particles.length));
  for (const p of paths) {
    assert.equal(p.points.length, 4);
    assert.deepEqual(p.points[0], sys.sourcePosition);
    const hit: { position: number[] } | undefined = alive.value.particles.find(q => q.id === p.id);
    assert.ok(hit && p.points[3].every((v, i) => Math.abs(v - hit.position[i]) < 1e-9));
  }
  assert.deepEqual(probe(10).map(p => p.id), paths.map(p => p.id), 'stable selection');
});

test('PublicParameter reads a root numeric control as a value; unit and scope are checked', () => {
  const withPP = (controlId: string, unit = 'none', scope?: string) => f01(d => {
    d.controls.push({ id: 'ctl-count', scopeGraphId: scope ?? d.rootGraphId, label: 'Count', type: 'integer', unit: unit as 'none', value: 33, default: 33, min: 0, max: 500, step: 1, section: 'Main', description: '', editPolicy: 'resample', bindings: [] });
    root(d).nodes.push(node('node-pp', 'PublicParameter', { controlId }));
    root(d).edges.push(edge('e-pp', 'node-pp', 'value', 'node-emitter', 'burst'));
  });
  assert.equal(plan(withPP('ctl-count')).systems[0].descriptor.bursts[0].count, 33);
  assert.ok(errorsOf(compileParticlePreview(withPP('missing'))).some(e => e.code === 'MISSING_REFERENCE'));
  assert.ok(errorsOf(compileParticlePreview(withPP('ctl-count', 'meter'))).some(e => e.code === 'TYPE_MISMATCH'), 'meter control into unitless burst');
});

test('PropMesh: one fixed mesh at its anchor, +Y aimed at the aim anchor, ending at the anchor (pivot end)', () => {
  const p = plan(f01(d => {
    const g = root(d);
    d.anchors.find(a => a.id === 'target')!.position = [4, 1, 0];
    g.nodes.push(node('node-pw', 'Schedule', { startTicks: 0, durationTicks: 60, mode: 'window' }), node('node-prop', 'PropMesh', { mesh: 'cylinder', size: 0.1, length: 0.8 }));
    g.edges.push(edge('e-pa', 'node-source', 'out', 'node-prop', 'anchor'), edge('e-pt', 'node-target', 'out', 'node-prop', 'aim'), edge('e-pm', 'node-material', 'material', 'node-prop', 'material'),
      edge('e-pw', 'node-pw', 'window', 'node-prop', 'window'), edge('e-pv', 'node-prop', 'visual', 'node-output', 'visual', 1));
  }));
  const layer = p.meshes.find(m => m.nodeId === 'node-prop')!;
  assert.equal(layer.orientation, 'fixed');
  assert.deepEqual(layer.direction!.map(v => +v.toFixed(6)), [1, 0, 0]);
  assert.equal(layer.scaleY, 8);
  const sys = p.systems.find(s => s.id === 'node-prop')!.descriptor;
  assert.deepEqual(sys.sourcePosition.map(v => +v.toFixed(6)), [-0.4, 1, 0], 'centre sits half a length behind the anchor');
});

test('PropMesh without Aim points its length along the Direction parameter', () => {
  const p = plan(f01(d => {
    const g = root(d);
    g.nodes.push(node('node-pw', 'Schedule', { startTicks: 0, durationTicks: 60, mode: 'window' }), node('node-bar', 'PropMesh', { mesh: 'box', direction: [0, 0, 0.5], pivot: 'center' }));
    g.edges.push(edge('e-pa', 'node-source', 'out', 'node-bar', 'anchor'), edge('e-pm', 'node-material', 'material', 'node-bar', 'material'),
      edge('e-pw', 'node-pw', 'window', 'node-bar', 'window'), edge('e-pv', 'node-bar', 'visual', 'node-output', 'visual', 1));
  }));
  assert.deepEqual(p.meshes.find(m => m.nodeId === 'node-bar')!.direction, [0, 0, 1]);
});

test('PropMesh pivot start: the mesh begins at the anchor and extends along its direction', () => {
  const p = plan(f01(d => {
    const g = root(d);
    g.nodes.push(node('node-pw', 'Schedule', { startTicks: 0, durationTicks: 60, mode: 'window' }), node('node-leg', 'PropMesh', { mesh: 'box', direction: [0, -1, 0], pivot: 'start', length: 1, size: 0.1 }));
    g.edges.push(edge('e-pa', 'node-source', 'out', 'node-leg', 'anchor'), edge('e-pm', 'node-material', 'material', 'node-leg', 'material'),
      edge('e-pw', 'node-pw', 'window', 'node-leg', 'window'), edge('e-pv', 'node-leg', 'visual', 'node-output', 'visual', 1));
  }));
  assert.deepEqual(p.systems.find(s => s.id === 'node-leg')!.descriptor.sourcePosition.map(v => +v.toFixed(6)), [0, 0.5, 0], 'centre half a metre below the anchor at y 1');
});

test('05 Curve / Gradient nodes drive curve and gradient parameters; disabled = the literal; the receiver still checks its range', () => {
  const shape = { domain: 'normalized' as const, interpolation: 'linear' as const, keys: [{ x: 0, y: 0.2 }, { x: 0.5, y: 1 }, { x: 1, y: 0.4 }] };
  const ramp = { stops: [{ position: 0, color: { srgb: '#FF0000', alpha: 1 } }, { position: 1, color: { srgb: '#0000FF', alpha: 1 } }] };
  const withNodes = (enabled = true, y = 1) => f01(d => {
    root(d).nodes.push(node('node-curve', 'Curve', { curve: { ...shape, keys: shape.keys.map(k => ({ ...k, y: k.y * y })) } }), node('node-grad', 'Gradient', { gradient: ramp }));
    root(d).nodes.find(n => n.id === 'node-curve')!.enabled = enabled;
    root(d).edges.push(edge('e-c', 'node-curve', 'curve', 'node-billboard', 'sizeOverLife'), edge('e-g', 'node-grad', 'gradient', 'node-billboard', 'colorOverLife'));
  });
  const l = plan(withNodes()).layers[0];
  assert.deepEqual(l.sizeOverLife.keys.map(k => k.y), [0.2, 1, 0.4]);
  assert.deepEqual(l.colorOverLife.stops.map(s => s.color.srgb), ['#FF0000', '#0000FF']);
  assert.ok(plan(withNodes(false)).layers[0].sizeOverLife.keys.every(k => k.y === 1), 'a disabled Curve leaves the literal');
  assert.ok(errorsOf(compileParticlePreview(withNodes(true, 50))).length > 0, 'a curve outside the receiver range is an error, never clamped');
});
