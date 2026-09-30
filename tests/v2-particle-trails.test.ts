import test from 'node:test';
import assert from 'node:assert/strict';
import { TrailHistory } from '../src/render/particleTrails.ts';
import type { ParticleState } from '../src/runtime/particles.ts';

const p = (id: string, x: number): ParticleState => ({ id, emission: 'burst', burstIndex: 0, entityOrdinal: 0, eventRandomKey: 'k', parentRandomKey: 'pk', birthTick: 0, lifetimeTicks: 99, ageTicks: 0, size: 0.1, position: [x, 0, 0], velocity: [1, 0, 0] });

test('trail keeps the last historyTicks samples, capped at maxPoints', () => {
  const t = new TrailHistory(4, 32);
  for (let k = 0; k <= 10; k++) t.push(k, [p('a', k)]);
  const [a] = t.paths(10);
  assert.deepEqual(a.points.map(q => q[0]), [6, 7, 8, 9, 10]);
  const c = new TrailHistory(50, 3);
  for (let k = 0; k <= 10; k++) c.push(k, [p('a', k)]);
  assert.deepEqual(c.paths(10)[0].points.map(q => q[0]), [8, 9, 10]);
});

test('live head extends the trail; a dead particle trail recedes and fades, then disappears', () => {
  const t = new TrailHistory(3, 32);
  for (let k = 0; k <= 5; k++) t.push(k, [p('a', k)]);
  assert.equal(t.paths(5, new Map([['a', [5.5, 0, 0]]]))[0].points.at(-1)![0], 5.5);
  t.push(6, []);
  const d = t.paths(6)[0];
  assert.deepEqual(d.points.map(q => q[0]), [3, 4, 5]);
  assert.ok(d.opacityScale < 1 && d.opacityScale > 0);
  t.push(7, []); t.push(8, []);
  assert.ok(t.paths(8).length <= 1);
  t.push(9, []);
  assert.equal(t.size, 0);
});
