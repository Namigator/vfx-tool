import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PathPreviewPlan } from '../src/graph/toPaths.ts';
import type { Vec3 } from '../src/model/types.ts';
import { collectTimelineFrameSets, framingSampleTicks } from '../src/render/pathFraming.ts';

function plan(points: Vec3[], active = true): PathPreviewPlan {
  return { durationTicks: 120, effectTick: 0, layers: [{ active, width: 0.2, paths: points.length ? [{ points, widthScale: 1 }] : [] }] } as unknown as PathPreviewPlan;
}

test('framingSampleTicks: bounded, includes 0 and last tick, unique', () => {
  assert.deepEqual(framingSampleTicks(120), [0, 30, 60, 89, 119]);
  assert.deepEqual(framingSampleTicks(1), [0]);
  assert.deepEqual(framingSampleTicks(0), [0]);
  assert.deepEqual(framingSampleTicks(3), [0, 1, 2]);
});

test('collectTimelineFrameSets: late-expanding path is framed, failures and non-finite skipped', () => {
  const calls: number[] = [];
  const sets = collectTimelineFrameSets(plan([]), 120, tick => {
    calls.push(tick);
    if (tick === 30) return { ok: false };
    if (tick === 89) throw new Error('boom');
    const r = tick / 10;
    return { ok: true, value: plan([[-r, 0, 0], [r, 0, 0], [NaN, 0, 0]]) };
  });
  assert.deepEqual(calls, [30, 60, 89, 119]);
  assert.equal(sets.length, 2);
  assert.deepEqual(sets[1]!.points, [[-11.9, 0, 0], [11.9, 0, 0]]);
  assert.equal(sets[1]!.pad, 0.1);
});

test('collectTimelineFrameSets: inactive layers ignored', () => {
  const sets = collectTimelineFrameSets(plan([[0, 0, 0]], false), 1, () => { throw new Error('unused'); });
  assert.equal(sets.length, 0);
});

test('particle frame sets cover the simulated extent across the timeline, padded by size × growth × stretch', async () => {
  const { particleFrameSets } = await import('../src/render/pathFraming.ts');
  const { compileParticlePreview } = await import('../src/graph/toParticles.ts');
  const { createForcesDemoDocument } = await import('../src/graph/fixtures.ts');
  const r = compileParticlePreview(createForcesDemoDocument());
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const sets = particleFrameSets(r.value);
  assert.ok(sets.length >= 3, 'several sample ticks contribute');
  const xs = sets.flatMap(s => s.points.map(p => p[0]));
  assert.ok(Math.min(...xs) < -1.5 && Math.max(...xs) > 0, `jet spans from the source toward the target (${Math.min(...xs)}..${Math.max(...xs)})`);
  assert.ok(sets.every(s => s.pad > 0 && s.points.length <= 512));
});
