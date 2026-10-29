import test from 'node:test';
import assert from 'node:assert/strict';
import { createF01Document } from '../src/graph/fixtures.ts';
import { unrealEffectFrom } from '../src/export/unreal/fromPlan.ts';

function fixture(onlyTrail = false) {
  const doc = createF01Document(), graph = doc.graphs[0];
  Object.assign(graph.nodes.find(n => n.id === 'node-material')!.params, {
    tint: { srgb: '#00AAFF', alpha: 0.8 }, opacity: 0.5, emission: 2, blend: 'additive',
  });
  graph.nodes.push({ id: 'trail', type: 'ParticleTrail', definitionVersion: 1, label: 'Trail', enabled: true,
    randomStreamId: 'rs-trail', params: { history: 0.25, width: 0.02, endFade: 0.4, maxPoints: 20 } });
  const edge = (id: string, sourceId: string, sourcePort: string, targetPort: string) => ({
    id, source: { nodeId: sourceId, port: sourcePort }, target: { nodeId: 'trail', port: targetPort }, order: 0,
  });
  graph.edges.push(edge('trail-particles', 'node-initial', 'particles', 'particles'), edge('trail-material', 'node-material', 'material', 'material'),
    { id: 'trail-output', source: { nodeId: 'trail', port: 'visual' }, target: { nodeId: 'node-output', port: 'visual' }, order: 1 });
  if (onlyTrail) graph.edges = graph.edges.filter(e => e.source.nodeId !== 'node-billboard');
  return doc;
}

test('particle trail IR retains shared spawning, tail curves and independent material', () => {
  const result = unrealEffectFrom(fixture());
  assert.ok(result.ok);
  const ir = result.value, trail = ir.trails![0];
  assert.equal(ir.trails!.length, 1);
  assert.equal(trail.parentEmitterName, ir.emitters[0].name);
  assert.deepEqual(trail.emitter, ir.emitters[0]);
  assert.equal(trail.lifetimeSec, 0.25);
  assert.equal(trail.widthCm, 2);
  assert.equal(trail.maxPoints, 20);
  assert.equal(trail.blend, 'additive');
  assert.equal(trail.emission, 2);
  assert.deepEqual(trail.colorOverTrail[0], { t: 0, r: 0, g: 0.667, b: 1, a: 1 });
  assert.equal(trail.widthOverTrail[0].v, 0);
  assert.equal(trail.widthOverTrail.at(-1)!.v, 1, 'the live head does not taper');
  assert.equal(trail.opacityOverTrail.at(-1)!.v, 0.4);
});

test('trail-only systems export full spawn data without creating legacy billboard emitters', () => {
  const result = unrealEffectFrom(fixture(true));
  assert.ok(result.ok);
  assert.equal(result.value.emitters.length, 0);
  assert.equal(result.value.trails!.length, 1);
  assert.equal(result.value.trails![0].parentEmitterName, undefined);
  assert.equal(result.value.trails![0].emitter.bursts[0].count, 1);
});

test('effects without trails retain the exact legacy object shape', () => {
  const result = unrealEffectFrom(createF01Document());
  assert.ok(result.ok);
  assert.equal(Object.hasOwn(result.value, 'trails'), false);
});

test('static variant metadata preserves legacy overLife flipbook fields', () => {
  for (const variant of [-1, 2]) {
    const doc = createF01Document(), graph = doc.graphs[0];
    Object.assign(graph.nodes.find(n => n.id === 'node-material')!.params,
      { template: 'SpriteTextured', sprite: 'soft-glow', variant });
    Object.assign(graph.nodes.find(n => n.id === 'node-billboard')!.params, { flipbookMode: 'overLife' });
    const result = unrealEffectFrom(doc);
    assert.ok(result.ok);
    // F01 births one particle, so a random variant (-1) exports the cell the editor draws for it (0..3).
    const fb = result.value.emitters[0].flipbook!;
    assert.deepEqual({ ...fb, variantFrame: undefined }, {
      columns: 2, rows: 2, fps: 4, loop: false, randomStartFrame: false, variantFrame: undefined,
    });
    if (variant >= 0) assert.equal(fb.variantFrame, variant);
    else assert.ok(Number.isInteger(fb.variantFrame) && fb.variantFrame! >= 0 && fb.variantFrame! < 4);
    graph.nodes.find(n => n.id === 'node-material')!.params.sprite = 'lightning-charge';
    const animated = unrealEffectFrom(doc);
    assert.ok(animated.ok);
    assert.equal(Object.hasOwn(animated.value.emitters[0].flipbook!, 'variantFrame'), false);
  }
});
