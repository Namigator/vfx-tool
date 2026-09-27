import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ParticleSimulation, sampleParticlesAtTick, validateParticleDescriptor, burstParticleId,
  type ParticleEmitterDescriptor, type ParticleTickSnapshot,
} from '../src/runtime/particles.ts';
import { scheduleEventRandomKey } from '../src/runtime/random.ts';

const base = (over: Partial<ParticleEmitterDescriptor> = {}): ParticleEmitterDescriptor => ({
  documentSeed: 1234,
  durationTicks: 60,
  emitterId: 'emitter_1',
  randomStreamId: 'stream_emitter',
  shape: 'point',
  sourcePosition: [0, 0, 0],
  initialVelocity: { kind: 'speed', speed: 0 },
  bursts: [],
  lifetimeTicks: { min: 60, max: 60 },
  size: { min: 0.1, max: 0.1 },
  operators: [],
  ...over,
});

function run(d: unknown, opts?: Parameters<typeof ParticleSimulation.create>[1]): ParticleTickSnapshot[] {
  const c = ParticleSimulation.create(d, opts);
  assert.ok(c.ok, c.ok ? '' : JSON.stringify(c.errors));
  const sim = c.value;
  const out = [sim.snapshot()];
  while (sim.tick < sim.descriptor.durationTicks) {
    const r = sim.advance();
    assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.errors));
    out.push(r.value);
  }
  return out;
}

test('F01: one stationary birth/death, empty at tick 60', () => {
  const src: [number, number, number] = [1.25, 0.5, -3];
  const key = scheduleEventRandomKey('sched', 0, 0);
  const pid = burstParticleId('emitter_1', key, 0);
  const d = base({ sourcePosition: src, bursts: [{ tick: 0, eventRandomKey: key, count: 1 }] });
  const s = run(d);
  assert.equal(s[0].particles.length, 1);
  assert.deepEqual(s[0].births, [pid]);
  assert.equal(s[0].particles[0].ageTicks, 0);
  for (const t of [0, 1, 30, 59]) {
    assert.equal(s[t].particles.length, 1);
    assert.deepEqual(s[t].particles[0].position, src);
    assert.equal(s[t].particles[0].size, 0.1);
  }
  assert.equal(s[60].particles.length, 0);
  assert.equal(s[60].ended, true);
  // Lifetime 60 with duration 70: exactly one death at tick 60, one birth total.
  const s2 = run({ ...d, durationTicks: 70 });
  assert.deepEqual(s2[60].deaths, [pid]);
  assert.equal(s2[69].totalBirths, 1);
  assert.equal(s2[69].totalDeaths, 1);
  assert.equal(s2.reduce((n, x) => n + x.births.length, 0), 1);
  assert.equal(s2.slice(61).every((x) => x.particles.length === 0), true);
});

test('F02: rate 30/s in [0,60) births at 1,3,...,59', () => {
  const s = run(base({ durationTicks: 180, rate: { perSecond: 30, startTick: 0, endTick: 60 }, lifetimeTicks: { min: 120, max: 120 } }));
  const birthTicks = s.flatMap((x) => x.births.map(() => x.tick));
  assert.deepEqual(birthTicks, Array.from({ length: 30 }, (_, i) => 2 * i + 1));
  assert.deepEqual([0, 1, 59, 60].map((t) => s[t].particles.length), [0, 1, 30, 30]);
  assert.equal(s[0].rateRemainder, 0.5);
  // Each dies at birth+120.
  const deathTicks = s.flatMap((x) => x.deaths.map(() => x.tick));
  assert.deepEqual(deathTicks, Array.from({ length: 30 }, (_, i) => 2 * i + 121));
});

test('F03: semi-implicit Euler gravity formula', () => {
  const d = base({
    durationTicks: 120, sourcePosition: [0, 1, 0], initialVelocity: { kind: 'vector', value: [1, 0, 0] },
    bursts: [{ tick: 0, eventRandomKey: 'e0', count: 1 }], lifetimeTicks: { min: 600, max: 600 },
    operators: [{ kind: 'gravity', acceleration: [0, -9.81, 0] }],
  });
  const s = run(d);
  for (let n = 0; n < 120; n++) {
    const [x, y, z] = s[n].particles[0].position;
    assert.ok(Math.abs(x - n / 60) <= 1e-6, `x@${n}`);
    assert.ok(Math.abs(y - (1 - 9.81 * (1 / 60) ** 2 * n * (n + 1) / 2)) <= 1e-6, `y@${n}`);
    assert.equal(z, 0);
  }
});

test('F04: emission shutoff and lifetime/document endpoint', () => {
  const s = run(base({ durationTicks: 90, rate: { perSecond: 30, startTick: 12, endTick: 42 }, lifetimeTicks: { min: 30, max: 30 } }));
  const birthTicks = s.flatMap((x) => x.births.map(() => x.tick));
  assert.deepEqual(birthTicks, Array.from({ length: 15 }, (_, i) => 13 + 2 * i));
  const lastDeath = Math.max(...s.flatMap((x) => x.deaths.map(() => x.tick)));
  assert.equal(lastDeath, 71);
  assert.equal(s[71].particles.length, 0);
  for (let t = 72; t <= 90; t++) assert.equal(s[t].particles.length, 0);
  assert.equal(s[89].totalBirths, birthTicks.length);
  assert.equal(s[90].ended, true);
  assert.deepEqual([s[90].particles, s[90].births, s[90].deaths], [[], [], []]);
  // Long lifetime still forced empty at document end; advance past end is rejected.
  const c = ParticleSimulation.create(base({ durationTicks: 5, bursts: [{ tick: 0, eventRandomKey: 'k', count: 3 }] }));
  assert.ok(c.ok);
  for (let i = 0; i < 5; i++) assert.ok(c.value.advance().ok);
  assert.equal(c.value.snapshot().particles.length, 0);
  assert.equal(c.value.advance().ok, false);
});

test('seeded replay/seek equals incremental advance; ranges independent of traversal', () => {
  const d = base({
    durationTicks: 120, rate: { perSecond: 45, startTick: 0, endTick: 100 },
    bursts: [{ tick: 10, eventRandomKey: 'b', count: 4 }, { tick: 3, eventRandomKey: 'a', count: 2, velocity: [0, 2, 0] }],
    lifetimeTicks: { min: 10, max: 50 }, size: { min: 0.05, max: 0.5 },
    initialVelocity: { kind: 'vector', value: [0.5, 1, 0] },
    operators: [{ kind: 'gravity', acceleration: [0, -9.81, 0] }, { kind: 'drag', coefficient: 0.7 }],
  });
  const s = run(d);
  for (const t of [0, 1, 37, 99, 119, 120]) {
    const r = sampleParticlesAtTick(d, t);
    assert.ok(r.ok);
    assert.deepEqual(r.value, s[t]);
  }
  // Lifetimes/sizes actually vary and are in range.
  const all = s.flatMap((x) => x.particles);
  assert.ok(new Set(all.map((p) => p.lifetimeTicks)).size > 1);
  assert.ok(all.every((p) => p.lifetimeTicks >= 10 && p.lifetimeTicks <= 50 && p.size >= 0.05 && p.size <= 0.5));
  // Burst declaration order does not change identities or samples.
  const swapped = run({ ...d, bursts: [d.bursts[1], d.bursts[0]] });
  assert.deepEqual(swapped, s);
  // Adding an unrelated burst does not change rate particle samples.
  const extra = run({ ...d, bursts: [...d.bursts, { tick: 50, eventRandomKey: 'z', count: 3 }] });
  const pick = (x: ParticleTickSnapshot[]) => x[40].particles.filter((p) => p.emission === 'rate').map((p) => [p.id, p.lifetimeTicks, p.size]);
  assert.deepEqual(pick(extra), pick(s));
  // Different seed changes samples.
  const other = run({ ...d, documentSeed: 99 });
  assert.notDeepEqual(other[40].particles.map((p) => p.size), s[40].particles.map((p) => p.size));
});

test('snapshot and input mutation isolation', () => {
  const d = base({ bursts: [{ tick: 0, eventRandomKey: 'e', count: 1 }], initialVelocity: { kind: 'vector', value: [1, 0, 0] } });
  const c = ParticleSimulation.create(d);
  assert.ok(c.ok);
  const sim = c.value;
  (d.initialVelocity as { value: number[] }).value[0] = 999;
  d.sourcePosition[0] = 999;
  d.bursts.push({ tick: 1, eventRandomKey: 'late', count: 5 });
  const snap = sim.snapshot();
  snap.particles[0].position[0] = -50;
  snap.particles[0].velocity[0] = -50;
  snap.births.push('x');
  const r = sim.advance();
  assert.ok(r.ok);
  assert.equal(r.value.particles.length, 1);
  assert.equal(r.value.particles[0].position[0], 1 / 60);
  assert.deepEqual(sim.snapshot().births, []);
  assert.throws(() => { (sim.descriptor.sourcePosition as number[])[0] = 5; });
});

test('drag is exponential and applied after gravity velocity update', () => {
  const c = 0.9, dt = 1 / 60;
  const d = base({
    durationTicks: 10, bursts: [{ tick: 0, eventRandomKey: 'e', count: 1 }], initialVelocity: { kind: 'vector', value: [2, 0, 0] },
    operators: [{ kind: 'drag', coefficient: c }, { kind: 'gravity', acceleration: [0, -10, 0] }],
  });
  const s = run(d);
  let vx = 2, vy = 0, x = 0, y = 0;
  for (let n = 1; n < 10; n++) {
    vx = vx * Math.exp(-c * dt);
    vy = (vy - 10 * dt) * Math.exp(-c * dt);
    x += vx * dt; y += vy * dt;
    const p = s[n].particles[0];
    assert.ok(Math.abs(p.velocity[0] - vx) <= 1e-12 && Math.abs(p.velocity[1] - vy) <= 1e-12, `v@${n}`);
    assert.ok(Math.abs(p.position[0] - x) <= 1e-12 && Math.abs(p.position[1] - y) <= 1e-12, `x@${n}`);
  }
});

test('invalid descriptors are rejected with field paths', () => {
  const bad: [unknown, string][] = [
    [{ ...base(), shape: 'cone' }, 'descriptor.shape'],
    [{ ...base(), localSpace: true }, 'descriptor.localSpace'],
    [base({ operators: [{ kind: 'magnet' } as never] }), 'descriptor.operators[0].kind'],
    [base({ lifetimeTicks: { min: 0, max: 5 } }), 'descriptor.lifetimeTicks.min'],
    [base({ lifetimeTicks: { min: 9, max: 5 } }), 'descriptor.lifetimeTicks.max'],
    [base({ rate: { perSecond: 10, startTick: 20, endTick: 10 } }), 'descriptor.rate.endTick'],
    [base({ bursts: [{ tick: 60, eventRandomKey: 'k', count: 1 }] }), 'descriptor.bursts[0].tick'],
    [base({ bursts: [{ tick: 0, eventRandomKey: 'k', count: 1 }, { tick: 2, eventRandomKey: 'k', count: 1 }] }), 'descriptor.bursts[1].eventRandomKey'],
    [base({ sourcePosition: [0, Number.NaN, 0] }), 'descriptor.sourcePosition'],
    [base({ durationTicks: 601 }), 'descriptor.durationTicks'],
    [base({ emitterId: 'bad id' }), 'descriptor.emitterId'],
    [base({ bursts: [{ tick: 0, eventRandomKey: 'k', count: 1, collision: true } as never] }), 'descriptor.bursts[0].collision'],
    // Sparse arrays: holes must be rejected, not skipped.
    [base({ sourcePosition: [0, , 0] as never }), 'descriptor.sourcePosition'],
    [base({ initialVelocity: { kind: 'vector', value: [, 1, 0] as never } }), 'descriptor.initialVelocity.value'],
    [base({ operators: [{ kind: 'gravity', acceleration: [0, , 0] as never }] }), 'descriptor.operators[0].acceleration'],
    [base({ bursts: [{ tick: 0, eventRandomKey: 'k', count: 1, position: [, , 0] as never }] }), 'descriptor.bursts[0].position'],
    [base({ bursts: [, { tick: 0, eventRandomKey: 'k', count: 1 }] as never }), 'descriptor.bursts[0]'],
    [base({ operators: [, { kind: 'drag', coefficient: 1 }] as never }), 'descriptor.operators[0]'],
    // Empty event key is reserved for rate births.
    [base({ bursts: [{ tick: 0, eventRandomKey: '', count: 1 }] }), 'descriptor.bursts[0].eventRandomKey'],
  ];
  for (const [d, path] of bad) {
    const r = validateParticleDescriptor(d);
    assert.equal(r.ok, false, path);
    if (!r.ok) assert.ok(r.errors.some((e) => e.fieldPath === path), `${path}: ${JSON.stringify(r.errors)}`);
    assert.equal(ParticleSimulation.create(d).ok, false);
  }
  assert.equal(validateParticleDescriptor(null).ok, false);
  const s = sampleParticlesAtTick(base(), 61);
  assert.equal(s.ok, false);
});

test('hard limits report BUDGET_EXCEEDED, never truncate', () => {
  const live = ParticleSimulation.create(base({ bursts: [{ tick: 0, eventRandomKey: 'k', count: 11 }] }), { maxLiveParticles: 10 });
  assert.equal(live.ok, false);
  if (!live.ok) assert.equal(live.errors[0].code, 'BUDGET_EXCEEDED');

  const c = ParticleSimulation.create(base({ lifetimeTicks: { min: 1, max: 1 }, rate: { perSecond: 60, startTick: 0, endTick: 60 } }), { maxTotalBirths: 5 });
  assert.ok(c.ok);
  let failed: ReturnType<ParticleSimulation['advance']> | undefined;
  for (let i = 0; i < 10; i++) { const r = c.value.advance(); if (!r.ok) { failed = r; break; } }
  assert.ok(failed && !failed.ok && failed.errors[0].code === 'BUDGET_EXCEEDED');
  assert.equal(c.value.failed, true);
  assert.equal(c.value.advance().ok, false);

  const events = validateParticleDescriptor(base({ bursts: [{ tick: 0, eventRandomKey: 'a', count: 1 }, { tick: 0, eventRandomKey: 'b', count: 1 }] }), { maxBurstEvents: 1 });
  assert.ok(!events.ok && events.errors.some((e) => e.code === 'BUDGET_EXCEEDED'));
  assert.equal(ParticleSimulation.create(base(), { maxLiveParticles: 9000 }).ok, false);
});

test('hard limits: burst+rate share budget on the same tick; exact boundary is allowed', () => {
  const long = { lifetimeTicks: { min: 600, max: 600 } };
  // Exactly at limit: burst 10 with limit 10.
  const exact = ParticleSimulation.create(base({ ...long, bursts: [{ tick: 0, eventRandomKey: 'k', count: 10 }] }), { maxLiveParticles: 10 });
  assert.ok(exact.ok);
  assert.equal(exact.value.snapshot().particles.length, 10);
  // Tick 0: burst 9 + rate 1 (60/s) = 10 == limit; tick 1 rate adds the 11th.
  const mixed = base({ ...long, bursts: [{ tick: 0, eventRandomKey: 'k', count: 9 }], rate: { perSecond: 60, startTick: 0, endTick: 60 } });
  const c = ParticleSimulation.create(mixed, { maxLiveParticles: 10 });
  assert.ok(c.ok);
  const s0 = c.value.snapshot();
  assert.equal(s0.particles.length, 10);
  assert.deepEqual(s0.particles.map((p) => p.emission), [...Array(9).fill('burst'), 'rate']);
  const r = c.value.advance();
  assert.ok(!r.ok && r.errors[0].code === 'BUDGET_EXCEEDED');
  // Same tick over budget: burst 10 + rate 1 at tick 0 with limit 10.
  const over = ParticleSimulation.create({ ...mixed, bursts: [{ tick: 0, eventRandomKey: 'k', count: 10 }] }, { maxLiveParticles: 10 });
  assert.ok(!over.ok && over.errors[0].code === 'BUDGET_EXCEEDED');
  // Total births boundary: exactly 10 allowed, 11th fails.
  assert.ok(ParticleSimulation.create(mixed, { maxTotalBirths: 10 }).ok);
  assert.equal(ParticleSimulation.create({ ...mixed, bursts: [{ tick: 0, eventRandomKey: 'k', count: 10 }] }, { maxTotalBirths: 10 }).ok, false);
});

test('fractional rate 7.5/s births at every 8th eligible tick without drift', () => {
  const s = run(base({ rate: { perSecond: 7.5, startTick: 0, endTick: 60 } }));
  const birthTicks = s.flatMap((x) => x.births.map(() => x.tick));
  assert.deepEqual(birthTicks, [7, 15, 23, 31, 39, 47, 55]);
  assert.equal(s[0].rateRemainder, 0.125);
});

test('rate and burst random identities never collide (empty key reserved for rate)', () => {
  const d = base({ bursts: [{ tick: 0, eventRandomKey: 'k', count: 1 }], rate: { perSecond: 60, startTick: 0, endTick: 60 } });
  const s0 = run(d)[0];
  assert.equal(s0.particles.length, 2);
  const [b, r] = s0.particles;
  assert.equal(r.eventRandomKey, '');
  assert.notEqual(b.parentRandomKey, r.parentRandomKey);
  assert.notEqual(b.id, r.id);
});

test('inserting an earlier unrelated burst preserves existing burst particle IDs and samples', () => {
  const d = base({
    durationTicks: 60, lifetimeTicks: { min: 20, max: 40 }, size: { min: 0.05, max: 0.5 },
    bursts: [{ tick: 10, eventRandomKey: 'b', count: 4 }],
  });
  const withEarlier = { ...d, bursts: [{ tick: 3, eventRandomKey: 'a0', count: 2 }, ...d.bursts] };
  const pick = (x: ParticleTickSnapshot[]) => x[15].particles.filter((p) => p.eventRandomKey === 'b')
    .map((p) => [p.id, p.parentRandomKey, p.lifetimeTicks, p.size, p.entityOrdinal]);
  const a = run(d), b = run(withEarlier);
  assert.equal(pick(a).length, 4);
  assert.deepEqual(pick(b), pick(a));
  // burstIndex is metadata only and does shift.
  assert.equal(b[15].particles.find((p) => p.eventRandomKey === 'b')!.burstIndex, 1);
  // ID encoding is collision-free for keys containing the separator.
  assert.notEqual(burstParticleId('e', 'x:1', 0), burstParticleId('e', 'x', 10));
  assert.notEqual(burstParticleId('e', 'a"', 0), burstParticleId('e', 'a', 0));
});

test('sim.limits is frozen', () => {
  const c = ParticleSimulation.create(base(), { maxLiveParticles: 5 });
  assert.ok(c.ok);
  assert.ok(Object.isFrozen(c.value.limits));
  assert.throws(() => { (c.value.limits as { maxLiveParticles: number }).maxLiveParticles = 8000; });
  assert.equal(c.value.limits.maxLiveParticles, 5);
});

const shaped = (shape: 'cone' | 'sphere' | 'disc' | 'box', extra: Partial<NonNullable<ParticleEmitterDescriptor['emission']>> = {}) =>
  base({ shape, emission: { shape, axis: [0, 1, 0], radius: 0.5, coneAngle: Math.PI / 6, speed: { min: 2, max: 4 }, ...extra }, bursts: [{ tick: 0, eventRandomKey: 'k', count: 400 }] });
const born = (d: ParticleEmitterDescriptor) => { const r = sampleParticlesAtTick(d, 0); if (!r.ok) assert.fail(JSON.stringify(r.errors)); return r.value.particles; };
const len = (v: number[]) => Math.hypot(v[0], v[1], v[2]);

test('cone emission stays inside the cone, spreads in speed range and born on the base disc', () => {
  const ps = born(shaped('cone'));
  let minS = Infinity, maxS = 0, sideways = 0;
  for (const p of ps) {
    const s = len(p.velocity); minS = Math.min(minS, s); maxS = Math.max(maxS, s);
    assert.ok(p.velocity[1] / s >= Math.cos(Math.PI / 6) - 1e-9, 'within cone');
    assert.ok(Math.abs(p.position[1]) < 1e-12 && Math.hypot(p.position[0], p.position[2]) <= 0.5 + 1e-12, 'on base disc');
    sideways += p.velocity[0];
  }
  assert.ok(minS >= 2 - 1e-9 && maxS <= 4 + 1e-9 && maxS - minS > 1.5, `speed spread ${minS}..${maxS}`);
  assert.ok(Math.abs(sideways / ps.length) < 0.2, 'no lateral bias');
});

test('sphere, disc and box emission follow their geometry and are deterministic', () => {
  for (const p of born(shaped('sphere'))) { assert.ok(len(p.position) <= 0.5 + 1e-12); if (len(p.position) > 1e-6) { const c = (p.position[0] * p.velocity[0] + p.position[1] * p.velocity[1] + p.position[2] * p.velocity[2]) / (len(p.position) * len(p.velocity)); assert.ok(c > 1 - 1e-9, 'radial'); } }
  const up = born(shaped('sphere')).filter(p => p.velocity[1] > 0).length;
  assert.ok(up > 150 && up < 250, `sphere is isotropic (${up}/400 upward)`);
  for (const p of born(shaped('disc'))) { assert.ok(Math.abs(p.velocity[1]) < 1e-9 && Math.abs(p.position[1]) < 1e-12); }
  for (const p of born(shaped('box'))) { assert.ok(p.position.every(c => Math.abs(c) <= 0.5 + 1e-12)); assert.ok(Math.abs(p.velocity[0]) < 1e-9 && p.velocity[1] > 0); }
  assert.deepEqual(born(shaped('cone')), born(shaped('cone')));
});

test('shaped descriptors are validated', () => {
  const bad: [unknown, string][] = [
    [{ ...shaped('cone'), emission: { ...shaped('cone').emission!, axis: [0, 2, 0] } }, 'descriptor.emission.axis'],
    [{ ...shaped('cone'), emission: { ...shaped('cone').emission!, speed: { min: 3, max: 1 } } }, 'descriptor.emission.speed'],
    [{ ...shaped('cone'), emission: { ...shaped('cone').emission!, shape: 'disc' } }, 'descriptor.emission.shape'],
    [{ ...base(), shape: 'path' }, 'descriptor.shape'],
  ];
  for (const [d, path] of bad) {
    const r = validateParticleDescriptor(d);
    assert.ok(!r.ok && r.errors.some(e => e.fieldPath === path), path);
  }
});

const dropper = (ground: Record<string, unknown>) => base({
  sourcePosition: [0, 1, 0], initialVelocity: { kind: 'vector', value: [2, 0, 0] }, durationTicks: 200,
  lifetimeTicks: { min: 199, max: 199 }, bursts: [{ tick: 0, eventRandomKey: 'k', count: 1 }],
  operators: [{ kind: 'gravity', acceleration: [0, -9.81, 0] }, ground as never],
});
const at = (d: ParticleEmitterDescriptor, tick: number) => { const r = sampleParticlesAtTick(d, tick); if (!r.ok) assert.fail(JSON.stringify(r.errors)); return r.value; };

test('ground collision: kill removes on contact, bounce reflects with restitution then slides, never below y=0', () => {
  const kill = dropper({ kind: 'ground', mode: 'kill', restitution: 0.2, friction: 0.5, maxBounces: 2 });
  assert.equal(at(kill, 20).particles.length, 1);
  assert.equal(at(kill, 40).particles.length, 0, 'killed after reaching the floor (~27 ticks)');
  assert.equal(at(kill, 40).totalDeaths, 1);
  const bounce = dropper({ kind: 'ground', mode: 'bounce', restitution: 0.5, friction: 0.2, maxBounces: 2 });
  let minY = Infinity, sawUp = false;
  for (let t = 1; t < 199; t++) { const p = at(bounce, t).particles[0]; minY = Math.min(minY, p.position[1]); if (p.position[1] <= 1e-9 && p.velocity[1] > 0.5) sawUp = true; }
  assert.ok(minY >= 0, 'never below the plane');
  assert.ok(sawUp, 'bounced upward');
  const late = at(bounce, 198).particles[0];
  assert.equal(late.bounces, 2);
  assert.ok(late.position[1] === 0 && late.velocity[1] === 0, 'resting after max bounces');
  assert.ok(Math.abs(late.velocity[0]) < 1e-9, 'slide friction stopped it');
  const slide = dropper({ kind: 'ground', mode: 'slide', restitution: 0.5, friction: 0, maxBounces: 2 });
  const s = at(slide, 100).particles[0];
  assert.ok(s.position[1] === 0 && Math.abs(s.velocity[0] - 2) < 1e-9, 'frictionless slide keeps horizontal speed');
});

test('collectParticleEvents records births, lifetime deaths and ground contacts with positions', async () => {
  const { collectParticleEvents } = await import('../src/runtime/particles.ts');
  const d = base({ durationTicks: 120, sourcePosition: [0, 1, 0], initialVelocity: { kind: 'vector', value: [1, 0, 0] }, lifetimeTicks: { min: 100, max: 100 },
    bursts: [{ tick: 0, eventRandomKey: 'k', count: 3 }], operators: [{ kind: 'gravity', acceleration: [0, -9.81, 0] }, { kind: 'ground', mode: 'bounce', restitution: 0.5, friction: 0.1, maxBounces: 1 }] });
  const r = collectParticleEvents(d);
  if (!r.ok) assert.fail(JSON.stringify(r.errors));
  const by = (k: string) => r.value.filter(e => e.kind === k);
  assert.equal(by('birth').length, 3);
  assert.equal(by('death').length, 3, 'lifetime deaths at tick 100');
  assert.ok(by('death').every(e => e.tick === 100));
  const hits = by('collision');
  assert.equal(hits.length, 6, 'one bounce + one resting contact per particle');
  assert.ok(hits.every(e => Math.abs(e.position[1]) < 1e-9 && e.position[0] > 0.3));
  assert.deepEqual(hits.filter(e => e.particleId === hits[0].particleId).map(e => e.ordinal), [0, 1]);
  const again = collectParticleEvents(d);
  assert.deepEqual(again.ok && again.value, r.value, 'deterministic');
});

test('rate curve ramps emission over the window and integrates to the expected total', () => {
  const d = (curve?: { x: number; y: number }[]) => base({ durationTicks: 130, lifetimeTicks: { min: 200, max: 200 }, rate: { perSecond: 120, startTick: 0, endTick: 120, ...(curve ? { curve } : {}) } });
  const births = (desc: ParticleEmitterDescriptor, t: number) => { const r = sampleParticlesAtTick(desc, t); if (!r.ok) assert.fail(JSON.stringify(r.errors)); return r.value.totalBirths; };
  const ramp = d([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  const firstHalf = births(ramp, 60), total = births(ramp, 120);
  assert.ok(firstHalf < total - firstHalf, `ramp: ${firstHalf} early vs ${total - firstHalf} late`);
  assert.ok(Math.abs(total - 120) <= 2, `integrates to ~average 0.5 × 240 = 120 (got ${total})`);
  assert.equal(births(d(), 120), 240, 'flat rate unchanged');
  assert.equal(births(d([{ x: 0, y: 1 }, { x: 0.5, y: 1 }, { x: 0.51, y: 0 }]), 120), births(d([{ x: 0, y: 1 }, { x: 0.5, y: 1 }, { x: 0.51, y: 0 }]), 62), 'cut off after the curve drops to 0');
});

test('attract pulls particles in and kills them at the kill radius; vortex swirls around its axis', () => {
  const ring = (ops: ParticleEmitterDescriptor['operators']) => base({ shape: 'disc', durationTicks: 200, lifetimeTicks: { min: 199, max: 199 }, sourcePosition: [0, 1, 0],
    emission: { shape: 'disc', axis: [0, 1, 0], radius: 2, coneAngle: 0, speed: { min: 0, max: 0 } }, bursts: [{ tick: 0, eventRandomKey: 'k', count: 50 }], operators: ops });
  const at = (d: ParticleEmitterDescriptor, t: number) => { const r = sampleParticlesAtTick(d, t); if (!r.ok) assert.fail(JSON.stringify(r.errors)); return r.value; };
  const pull = ring([{ kind: 'attract', center: [0, 1, 0], acceleration: 8, softRadius: 0.1, killRadius: 0.15 }, { kind: 'drag', coefficient: 1 }]);
  const r0 = at(pull, 0).particles.map(p => Math.hypot(p.position[0], p.position[2]));
  const r1 = at(pull, 30).particles.map(p => Math.hypot(p.position[0], p.position[2]));
  assert.ok(Math.max(...r1) < Math.max(...r0), 'pulled inward');
  assert.ok(at(pull, 199).particles.length < 50, 'some absorbed at the kill radius');
  const swirl = ring([{ kind: 'vortex', center: [0, 1, 0], axis: [0, 1, 0], tangential: 4, inward: 0, falloff: 5 }]);
  const s = at(swirl, 20).particles;
  const tangential = s.every(p => { const rx = p.position[0], rz = p.position[2], vx = p.velocity[0], vz = p.velocity[2]; return Math.abs(rx * vx + rz * vz) < 0.35 * Math.hypot(rx, rz) * Math.hypot(vx, vz) + 1e-6 && Math.hypot(vx, vz) > 0.1; });
  assert.ok(tangential, 'velocity mostly perpendicular to the radius (swirl)');
  const cross = s.map(p => p.position[0] * p.velocity[2] - p.position[2] * p.velocity[0]);
  assert.ok(cross.every(c => c < 0) || cross.every(c => c > 0), 'all swirl the same way');
});

test('burst addVelocity (inherited parent velocity) is added to every sampled birth velocity', () => {
  const plain = born(shaped('sphere'));
  const d = shaped('sphere');
  d.bursts[0].addVelocity = [3, 0, -1];
  const moved = born(d);
  assert.equal(moved.length, plain.length);
  for (let i = 0; i < plain.length; i++) {
    assert.ok(Math.abs(moved[i].velocity[0] - plain[i].velocity[0] - 3) < 1e-9);
    assert.ok(Math.abs(moved[i].velocity[2] - plain[i].velocity[2] + 1) < 1e-9);
  }
  assert.equal(validateParticleDescriptor({ ...d, bursts: [{ ...d.bursts[0], addVelocity: [NaN, 0, 0] }] }).ok, false);
});
