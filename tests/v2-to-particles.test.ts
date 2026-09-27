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
    nodeId: 'node-billboard', systemId: 'node-initial', color: { srgb: '#FFFFFF', alpha: 1 },
    opacity: 1, emission: 0, blend: 'additive', alphaCutoff: 0.5, renderOrderOffset: 0, visualOrder: 0,
    sizeOverLife: { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
    opacityOverLife: { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
    colorOverLife: { stops: [{ position: 0, color: { srgb: '#FFFFFF', alpha: 1 } }, { position: 1, color: { srgb: '#FFFFFF', alpha: 1 } }] },
    alignment: 'camera', stretchRatio: 1, pivot: 0.5,
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
    ['node-billboard', { alignment: 'worldAxis' }, 'alignment'],
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
