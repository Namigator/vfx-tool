// emission.followMotion: on a moving source, each birth's emit axis is the source's motion that tick (reversed for
// "backward"), so a projectile's trail follows its curved path (Fireball: simulated). Owner request 2026-10-21.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSimulation, validateParticleDescriptor, type ParticleEmitterDescriptor } from '../src/runtime/particles.ts';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';

// Source moves a quarter circle (radius 5) in the XY plane over 60 ticks: heading turns from +Y to -X.
const arc = Array.from({ length: 61 }, (_, i) => { const a = (i / 60) * Math.PI / 2; return [5 * Math.cos(a), 5 * Math.sin(a), 0] as [number, number, number]; });
const desc = (followMotion?: 'forward' | 'backward'): ParticleEmitterDescriptor => ({
  documentSeed: 7, durationTicks: 61, emitterId: 'trail', randomStreamId: 'trail', shape: 'cone',
  sourcePosition: arc[0], initialVelocity: { kind: 'speed', speed: 0 },
  emission: { shape: 'cone', axis: [1, 0, 0], radius: 0, coneAngle: 0, speed: { min: 2, max: 2 }, ...(followMotion ? { followMotion } : {}) },
  sourceTrack: { startTick: 0, positions: arc },
  bursts: [], rate: { perSecond: 60, startTick: 0, endTick: 61 }, lifetimeTicks: { min: 1, max: 1 }, size: { min: 0.1, max: 0.1 }, operators: [],
});

/** Velocity of the particle born at tick n, and the source motion over that tick. */
function bornAt(d: ParticleEmitterDescriptor, n: number) {
  const c = ParticleSimulation.create(d);
  assert.ok(c.ok, c.ok ? '' : JSON.stringify(c.errors));
  let snap = c.value.snapshot();
  while (snap.tick < n) { const r = c.value.advance(); assert.ok(r.ok); snap = r.value; }
  const p = snap.particles.find(q => q.birthTick === n);
  assert.ok(p, `a particle born at tick ${n}`);
  const m = [arc[n][0] - arc[n - 1][0], arc[n][1] - arc[n - 1][1], 0];
  const ml = Math.hypot(m[0], m[1]);
  return { v: p.velocity, motion: [m[0] / ml, m[1] / ml, 0] };
}
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('followMotion backward: every birth leaves opposite to the source motion along a curve', () => {
  for (const n of [5, 30, 55]) {
    const { v, motion } = bornAt(desc('backward'), n);
    const s = Math.hypot(v[0], v[1], v[2]);
    assert.ok(Math.abs(s - 2) < 1e-6, `speed kept (${s})`);
    assert.ok(dot(v, motion) / s < -0.999, `tick ${n}: velocity ${v.map(x => x.toFixed(2))} is opposite the motion ${motion.map(x => x.toFixed(2))}`);
  }
});

test('followMotion forward points along the motion; without it the fixed axis is used', () => {
  const f = bornAt(desc('forward'), 30);
  assert.ok(dot(f.v, f.motion) / 2 > 0.999);
  const fixed = bornAt(desc(), 30);
  assert.deepEqual(fixed.v.map(x => +x.toFixed(6)), [2, 0, 0]);
});

test('followMotion is validated', () => {
  const bad = { ...desc(), emission: { ...desc().emission!, followMotion: 'sideways' } };
  const r = validateParticleDescriptor(bad);
  assert.ok(!r.ok && r.errors.some(e => /followMotion/.test(e.message)));
});

test('Fireball: simulated compiles its trail with followMotion backward', () => {
  const { doc } = insertComponent(createBlankDocument(), 'fireball-sim', undefined, { group: true });
  const trail = doc.graphs.flatMap(g => g.nodes).find(n => n.id.endsWith('trailem'));
  assert.equal(trail?.params?.axisMode, 'motionBackward');
});
