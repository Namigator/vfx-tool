import test from 'node:test';
import assert from 'node:assert/strict';
import { latticeValue, noiseAcceleration, valueNoise4 } from '../src/runtime/noise.ts';
import { sampleParticlesAtTick, type ParticleEmitterDescriptor } from '../src/runtime/particles.ts';

test('value noise is deterministic, bounded, continuous and seed-dependent', () => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 2000; i++) { const v = valueNoise4(7, i * 0.137, i * 0.071, i * 0.053, i * 0.011); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(lo >= -1 && hi <= 1 && hi - lo > 1, `range ${lo}..${hi}`);
  assert.equal(valueNoise4(7, 1.3, 2.1, 0.4, 0.2), valueNoise4(7, 1.3, 2.1, 0.4, 0.2));
  assert.notEqual(valueNoise4(7, 1.3, 2.1, 0.4, 0.2), valueNoise4(8, 1.3, 2.1, 0.4, 0.2));
  assert.ok(Math.abs(valueNoise4(7, 1.3, 2.1, 0.4, 0.2) - valueNoise4(7, 1.3001, 2.1, 0.4, 0.2)) < 1e-3, 'continuous');
  assert.equal(valueNoise4(7, 2, 3, 4, 5), latticeValue(7, 2, 3, 4, 5), 'interpolates through lattice values');
});

test('curl noise returns a direction scaled to exactly the amplitude', () => {
  const s: [number, number, number] = [11, 22, 33], o: [number, number, number] = [0, 0, 0];
  const a = noiseAcceleration(s, 'curl', 3, 0.8, 0.5, [0.3, 1.2, -0.7], o);
  assert.ok(Math.abs(Math.hypot(...a) - 3) < 1e-9);
  assert.deepEqual(noiseAcceleration(s, 'curl', 3, 0.8, 0.5, [0.3, 1.2, -0.7], [0, 0, 0]), a, 'deterministic');
});

test('noise operator makes identical particles diverge deterministically', () => {
  const d = (noise: boolean): ParticleEmitterDescriptor => ({
    documentSeed: 5, durationTicks: 90, emitterId: 'em', randomStreamId: 'rs', shape: 'box', sourcePosition: [0, 1, 0],
    initialVelocity: { kind: 'speed', speed: 0 }, emission: { shape: 'box', axis: [1, 0, 0], radius: 1, coneAngle: 0, speed: { min: 0, max: 0 } },
    bursts: [{ tick: 0, eventRandomKey: 'k', count: 30 }], lifetimeTicks: { min: 89, max: 89 }, size: { min: 0.1, max: 0.1 },
    operators: noise ? [{ kind: 'noise', mode: 'curl', amplitude: 4, frequency: 1, evolution: 0.5, randomStreamId: 'rs-noise' }] : [],
  });
  const still = sampleParticlesAtTick(d(false), 60), moved = sampleParticlesAtTick(d(true), 60), again = sampleParticlesAtTick(d(true), 60);
  if (!still.ok || !moved.ok || !again.ok) assert.fail('sample failed');
  const dirs = moved.value.particles.map(p => Math.atan2(p.velocity[2], p.velocity[0]));
  assert.ok(moved.value.particles.every((p, i) => Math.hypot(...p.velocity) > 0.5 && Math.hypot(p.position[0] - still.value.particles[i].position[0], p.position[1] - still.value.particles[i].position[1]) > 0.1), 'noise moves particles');
  assert.ok(Math.max(...dirs) - Math.min(...dirs) > 1, 'different places get different directions (coherent field, not uniform push)');
  assert.deepEqual(moved.value, again.value, 'deterministic');
});
