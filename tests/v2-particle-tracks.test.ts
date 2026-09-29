import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSimulation, validateParticleDescriptor, type DescriptorTrack, type ParticleEmitterDescriptor, type ParticleTickSnapshot } from '../src/runtime/particles.ts';

const base = (over: Partial<ParticleEmitterDescriptor> = {}): ParticleEmitterDescriptor => ({
  documentSeed: 99,
  durationTicks: 120,
  emitterId: 'emitter_1',
  randomStreamId: 'stream_emitter',
  shape: 'cone',
  sourcePosition: [0, 5, 0],
  initialVelocity: { kind: 'speed', speed: 0 },
  emission: { shape: 'cone', axis: [1, 0, 0], radius: 0.1, coneAngle: 0.5, speed: { min: 1, max: 2 } },
  bursts: [],
  rate: { perSecond: 60, startTick: 0, endTick: 120 },
  lifetimeTicks: { min: 200, max: 200 },
  size: { min: 0.1, max: 0.1 },
  operators: [],
  ...over,
});

function run(d: unknown, upTo?: number): ParticleTickSnapshot[] {
  const c = ParticleSimulation.create(d);
  assert.ok(c.ok, c.ok ? '' : JSON.stringify(c.errors));
  const sim = c.value;
  const out = [sim.snapshot()];
  while (sim.tick < (upTo ?? sim.descriptor.durationTicks - 1)) {
    const r = sim.advance();
    assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.errors));
    out.push(r.value);
  }
  return out;
}

const track = (path: (string | number)[], keys: [number, number][]): DescriptorTrack => ({ path, keys });
const errPaths = (d: unknown): string[] => {
  const r = validateParticleDescriptor(d);
  assert.equal(r.ok, false);
  return r.ok ? [] : r.errors.map(e => e.fieldPath ?? '');
};

test('T01: absent or empty animation gives identical snapshots', () => {
  const a = run(base());
  const b = run(base({ animation: [] }));
  assert.deepEqual(b, a);
  assert.ok(a[a.length - 1].totalBirths > 0);
});

test('T02: size track: late births are larger than early ones', () => {
  const s = run(base({ animation: [track(['size', 'min'], [[0, 0.1], [100, 1]]), track(['size', 'max'], [[0, 0.1], [100, 1]])] }));
  const last = s[s.length - 1].particles;
  const early = last.find(p => p.birthTick <= 2)!, late = last.find(p => p.birthTick >= 100)!;
  assert.ok(Math.abs(early.size - 0.1) < 0.02, `early ${early.size}`);
  assert.ok(late.size > 0.95, `late ${late.size}`);
  // Size is fixed at birth: an early particle never grows afterwards.
  const mid = s[50].particles.find(p => p.birthTick <= 2)!;
  assert.equal(mid.size, early.size);
});

test('T03: rate.perSecond 0 -> high ramps emission between the constant extremes', () => {
  const total = (d: ParticleEmitterDescriptor) => { const s = run(d, 119); return s[s.length - 1].totalBirths; };
  const lo = total(base({ rate: { perSecond: 0, startTick: 0, endTick: 120 } }));
  const hi = total(base({ rate: { perSecond: 120, startTick: 0, endTick: 120 } }));
  const anim = base({ rate: { perSecond: 0, startTick: 0, endTick: 120 }, animation: [track(['rate', 'perSecond'], [[0, 0], [119, 120]])] });
  const s = run(anim, 119);
  const at = (t: number) => s[t].totalBirths;
  const ramp = at(119);
  assert.equal(lo, 0);
  assert.ok(ramp > lo && ramp < hi, `ramp ${ramp} hi ${hi}`);
  assert.ok(at(30) < 10, `early births ${at(30)}`);
  assert.ok(at(119) - at(89) > at(30), 'late window emits more than the early window');
  // remainder stays a fraction in [0,1)
  for (const x of s) assert.ok(x.rateRemainder >= -1e-6 && x.rateRemainder < 1 + 1e-6, `remainder ${x.rateRemainder}`);
});

test('T04: operator strength track changes motion only after its key', () => {
  const g = (y: number): ParticleEmitterDescriptor['operators'] => [{ kind: 'gravity', acceleration: [0, y, 0] }];
  const still = run(base({ rate: undefined, bursts: [{ tick: 0, eventRandomKey: 'k', count: 3 }], operators: g(0) }), 100);
  const anim = run(base({ rate: undefined, bursts: [{ tick: 0, eventRandomKey: 'k', count: 3 }], operators: g(0), animation: [track(['operators', 0, 'acceleration', 1], [[50, 0], [51, -9.8]])] }), 100);
  for (let t = 0; t <= 50; t++) assert.deepEqual(anim[t].particles, still[t].particles, `tick ${t}`);
  assert.notDeepEqual(anim[60].particles[0].position, still[60].particles[0].position);
  assert.ok(anim[100].particles[0].position[1] < still[100].particles[0].position[1]);
});

test('T05: a clone advanced N ticks equals the original advanced N ticks', () => {
  const d = base({
    bursts: [{ tick: 10, eventRandomKey: 'k', count: 4 }],
    operators: [{ kind: 'drag', coefficient: 0.1 }, { kind: 'gravity', acceleration: [0, -1, 0] }],
    animation: [track(['size', 'min'], [[0, 0.1], [100, 0.5]]), track(['size', 'max'], [[0, 0.2], [100, 0.9]]), track(['rate', 'perSecond'], [[0, 10], [120, 90]]), track(['operators', 0, 'coefficient'], [[30, 0.1], [90, 2]]), track(['lifetimeTicks', 'min'], [[0, 50], [100, 90]]), track(['lifetimeTicks', 'max'], [[0, 60], [100, 100]])],
  });
  const c = ParticleSimulation.create(d);
  assert.ok(c.ok);
  const sim = c.ok ? c.value : (null as never);
  while (sim.tick < 40) assert.ok(sim.advance().ok);
  const copy = sim.clone();
  while (sim.tick < 80) assert.ok(sim.advance().ok);
  while (copy.tick < 80) assert.ok(copy.advance().ok);
  assert.deepEqual(copy.snapshot(), sim.snapshot());
  assert.ok(sim.snapshot().totalBirths > 10);
  // and it matches a straight run
  assert.deepEqual(run(d, 80)[80], sim.snapshot());
  // integer fields stay integers
  for (const p of sim.snapshot().particles) assert.ok(Number.isInteger(p.lifetimeTicks));
});

test('T06: validation errors', () => {
  const ok = base({ animation: [track(['size', 'max'], [[0, 0.1], [10, 0.2]])] });
  const v = validateParticleDescriptor(ok);
  assert.ok(v.ok);
  assert.ok(v.ok && Object.isFrozen(v.value.animation) && v.value.animation!.length === 1);
  // forbidden and unknown paths
  assert.deepEqual(errPaths(base({ animation: [track(['durationTicks'], [[0, 60]])] })), ['descriptor.animation[0].path']);
  assert.deepEqual(errPaths(base({ animation: [track(['documentSeed'], [[0, 1]])] })), ['descriptor.animation[0].path']);
  assert.deepEqual(errPaths(base({ animation: [track(['rate', 'startTick'], [[0, 1]])] })), ['descriptor.animation[0].path']);
  assert.deepEqual(errPaths(base({ bursts: [{ tick: 3, eventRandomKey: 'k', count: 1 }], animation: [track(['bursts', 0, 'tick'], [[0, 1]])] })), ['descriptor.animation[0].path']);
  assert.deepEqual(errPaths(base({ animation: [track(['nope', 'x'], [[0, 1]])] })), ['descriptor.animation[0].path']);
  assert.deepEqual(errPaths(base({ animation: [track(['emitterId'], [[0, 1]])] })), ['descriptor.animation[0].path']);
  assert.deepEqual(errPaths(base({ animation: [track(['sourcePosition'], [[0, 1]])] })), ['descriptor.animation[0].path']);
  // key problems
  assert.deepEqual(errPaths(base({ animation: [track(['size', 'max'], [[10, 0.2], [5, 0.3]])] })), ['descriptor.animation[0].keys']);
  assert.deepEqual(errPaths(base({ animation: [track(['size', 'max'], [[0, 0.2], [0, 0.3]])] })), ['descriptor.animation[0].keys']);
  assert.deepEqual(errPaths(base({ animation: [track(['size', 'max'], [[0, 0.2], [121, 0.3]])] })), ['descriptor.animation[0].keys']);
  assert.deepEqual(errPaths(base({ animation: [track(['size', 'max'], [])] })), ['descriptor.animation[0].keys']);
  assert.deepEqual(errPaths(base({ animation: [track(['size', 'max'], [[0, Infinity]])] })), ['descriptor.animation[0].keys']);
  // duplicate path
  assert.ok(errPaths(base({ animation: [track(['size', 'max'], [[0, 0.2]]), track(['size', 'max'], [[0, 0.3]])] })).includes('descriptor.animation[1].path'));
  // size.min > size.max at a key
  assert.deepEqual(errPaths(base({ animation: [track(['size', 'min'], [[0, 0.05], [60, 0.5]])] })), ['descriptor.animation[0].keys']);
  // too many tracks
  const many = Array.from({ length: 65 }, (_, i) => track(['size', 'max'], [[i, 1]]));
  assert.ok(errPaths(base({ animation: many })).includes('descriptor.animation'));
  // both size ends animated consistently is fine
  assert.ok(validateParticleDescriptor(base({ animation: [track(['size', 'min'], [[0, 0.05], [60, 0.5]]), track(['size', 'max'], [[0, 0.1], [60, 0.6]])] })).ok);
});
