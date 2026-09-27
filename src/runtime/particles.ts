// Fixed-step point particle core (plan07 update order, plan22 F01-F04, plan24 random identity).
// Minimal runtime: point/cone/sphere/disc/box emission (24-ALGORITHMS "Particle shapes"), one emitter,
// gravity/drag/noise/ground operators. Path emission, other forces, trails, collisions, local space and child-event graphs are NOT implemented and are
// rejected by validation rather than ignored. Pure data: no DOM, wall clock or global RNG.
import { MAX_DURATION_TICKS, TICKS_PER_SECOND, ID_PATTERN } from '../model/types.ts';
import type { Diagnostic, ValidationResult, Vec3 } from '../model/types.ts';
import { emitterParentRandomKey, randomTupleHash, sampleUnit } from './random.ts';
import { noiseAcceleration, type NoiseFieldSeeds } from './noise.ts';

export const PARTICLE_DT = 1 / TICKS_PER_SECOND;
/** plan15 hard limits. */
export const DEFAULT_MAX_LIVE_PARTICLES = 8192;
export const DEFAULT_MAX_TOTAL_BIRTHS = 65536;
/** Bound on authored burst events per emitter descriptor (implementation limit, not a plan15 figure). */
export const DEFAULT_MAX_BURST_EVENTS = 1024;
export const MAX_DRAG_COEFFICIENT = 100;
export const MAX_RATE_PER_SECOND = 65536;

/** Event random key reserved for rate births; burst keys must be non-empty so they never collide with it. */
export const RATE_EVENT_RANDOM_KEY = '';

/**
 * Stable burst particle ID. JSON-quoting the event key makes the encoding collision-free (emitter IDs
 * match ID_PATTERN and contain no ':'), and it is independent of the burst's sorted position.
 */
export function burstParticleId(emitterId: string, eventRandomKey: string, entityOrdinal: number): string {
  return `${emitterId}:burst:${JSON.stringify(eventRandomKey)}:${entityOrdinal}`;
}

/** Registry-owned random property keys. */
export const PARTICLE_PROPERTY_KEYS = { lifetime: 'lifetime', size: 'size', speed: 'speed', dirU: 'dirU', dirV: 'dirV', posU: 'posU', posV: 'posV', posW: 'posW', rotation: 'rotation', angularVelocity: 'angularVelocity' } as const;

/** Billboard spin sampled once per particle: rotation (radians) and angular velocity (radians/second). */
export type ParticleSpin = { rotation: { min: number; max: number }; angularVelocity: { min: number; max: number } };

export type EmitterShape = 'point' | 'cone' | 'sphere' | 'disc' | 'box';
/**
 * Shaped emission. Directions are relative to the unit world `axis` (the emitter's local +X after rotation
 * or aim). point: along axis. cone: uniform in solid angle within coneAngle of axis, born on a disc of
 * `radius` perpendicular to axis. sphere: uniform direction, position radius*cbrt(w) along it (volume).
 * disc: radial direction in the plane perpendicular to axis, position radius*sqrt(u). box: position uniform
 * in a cube of half-extent `radius`, direction along axis. Speed is sampled uniformly per particle.
 */
export type ParticleEmission = { shape: EmitterShape; axis: Vec3; radius: number; coneAngle: number; speed: { min: number; max: number } };
const SHAPES: readonly EmitterShape[] = ['point', 'cone', 'sphere', 'disc', 'box'];

export type ParticleVelocitySpec =
  | { kind: 'vector'; value: Vec3 }
  /** Point emission direction is the emitter's local +X axis (plan24); no rotation is applied here. */
  | { kind: 'speed'; speed: number };

export type ParticleBurst = {
  tick: number;
  /** Stable random identity of the triggering event, e.g. scheduleEventRandomKey(...). Unique per descriptor. */
  eventRandomKey: string;
  count: number;
  /** Event payload position; overrides emitter source position when present. */
  position?: Vec3;
  /** Event payload velocity; overrides emitter initial velocity when present. */
  velocity?: Vec3;
};

/** Active window startTick <= tick < endTick. */
/** `curve` (optional) scales perSecond over the window's normalized time: keys x ascending in [0,1], y in [0,4], linear. */
export type ParticleRate = { perSecond: number; startTick: number; endTick: number; curve?: { x: number; y: number }[] };

export type GroundMode = 'kill' | 'slide' | 'bounce';
/**
 * Ground plane y=0 (05 GroundCollision), resolved after integration (07). kill: the particle dies on contact.
 * bounce: vertical velocity reflects scaled by restitution and tangential velocity is scaled by (1-friction),
 * up to maxBounces; after that (or in slide mode) the particle rests on the plane and its tangential speed
 * decreases by friction·9.81·dt per tick (Coulomb-style).
 */
export type ParticleOperator =
  | { kind: 'gravity'; acceleration: Vec3 }
  | { kind: 'drag'; coefficient: number }
  | { kind: 'ground'; mode: GroundMode; restitution: number; friction: number; maxBounces: number }
  /** 05 NoiseForce: amplitude m/s², frequency 1/m, evolution 1/s of effect time; fields seeded from randomStreamId. */
  | { kind: 'noise'; mode: 'vector' | 'curl'; amplitude: number; frequency: number; evolution: number; randomStreamId: string }
  /** 05 Attract: toward center, magnitude acceleration·d/sqrt(d²+soft²); particles inside killRadius (>0) die. */
  | { kind: 'attract'; center: Vec3; acceleration: number; softRadius: number; killRadius: number }
  /** 05 Vortex: around the unit axis through center; tangential and inward accelerations scaled by exp(-ρ/falloff). */
  | { kind: 'vortex'; center: Vec3; axis: Vec3; tangential: number; inward: number; falloff: number };

export type ParticleEmitterDescriptor = {
  documentSeed: number;
  durationTicks: number;
  emitterId: string;
  randomStreamId: string;
  shape: EmitterShape;
  sourcePosition: Vec3;
  /** Used when `emission` is absent (point emission with one fixed velocity). */
  initialVelocity: ParticleVelocitySpec;
  /** Required when shape is not 'point'; when present it defines birth position offset and velocity. */
  emission?: ParticleEmission;
  /** When present every particle carries rotation/angularVelocity; the renderer uses rotation + w·age. */
  spin?: ParticleSpin;
  /** Moving source (PathFollower): world position at tick startTick+i; clamps outside the range. Replaces sourcePosition. */
  sourceTrack?: { startTick: number; positions: Vec3[] };
  /** Particles stay attached to the track position (e.g. a projectile core sprite) instead of integrating motion. */
  attachToSource?: boolean;
  bursts: ParticleBurst[];
  rate?: ParticleRate;
  lifetimeTicks: { min: number; max: number };
  size: { min: number; max: number };
  operators: ParticleOperator[];
};

/** 05 ParticleEvents / GroundCollision event: carries position, velocity and stable parent identity. */
export type ParticleEventKind = 'birth' | 'death' | 'collision';
export type ParticleEvent = {
  kind: ParticleEventKind; tick: number; particleId: string; parentRandomKey: string;
  /** Per-particle ordinal of this kind (collision: 0 for the first contact, then per bounce). */
  ordinal: number;
  position: Vec3; velocity: Vec3;
};

export type ParticleLimits = { maxLiveParticles: number; maxTotalBirths: number; maxBurstEvents: number };

export type ParticleState = {
  /** burstParticleId(emitterId, eventRandomKey, index) or `${emitterId}:rate:${index}`. */
  id: string;
  emission: 'burst' | 'rate';
  /** Metadata only (not identity): burst index in sorted (tick,eventRandomKey) order; -1 for rate births. */
  burstIndex: number;
  /** Entity ordinal used in random keys: index within burst, or cumulative rate emission index. */
  entityOrdinal: number;
  eventRandomKey: string;
  parentRandomKey: string;
  birthTick: number;
  lifetimeTicks: number;
  ageTicks: number;
  size: number;
  position: Vec3;
  velocity: Vec3;
  /** Present only when the descriptor has spin. Radians at birth. */
  rotation?: number;
  /** Present only when the descriptor has spin. Radians per second. */
  angularVelocity?: number;
  /** Present once the particle has touched a ground operator's plane. */
  bounces?: number;
  /** Set when the particle came to rest on the ground plane (its resting contact was recorded). */
  grounded?: boolean;
};

export type ParticleTickSnapshot = {
  tick: number;
  /** True at tick >= durationTicks: all outputs are forcibly empty. */
  ended: boolean;
  particles: ParticleState[];
  births: string[];
  deaths: string[];
  totalBirths: number;
  totalDeaths: number;
  /** Fractional rate accumulator remainder after this tick's births, in [0,1). */
  rateRemainder: number;
};

function err(code: Diagnostic['code'], message: string, fieldPath?: string): Diagnostic {
  return fieldPath === undefined ? { code, message, severity: 'error' } : { code, message, fieldPath, severity: 'error' };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isUint32(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// Plain indexed loop: every/forEach skip holes, so sparse arrays must be checked per index.
function isVec3(v: unknown): v is Vec3 {
  if (!Array.isArray(v) || v.length !== 3) return false;
  for (let i = 0; i < 3; i++) if (!(i in v) || !isFiniteNum(v[i])) return false;
  return true;
}

function isTickInt(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

function checkKeys(o: Record<string, unknown>, allowed: string[], path: string, out: Diagnostic[]): void {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) out.push(err('INVALID_VALUE', `Unsupported field "${k}" (not implemented in the point particle core).`, `${path}.${k}`));
  }
}

function resolveLimits(options?: Partial<ParticleLimits>): ValidationResult<ParticleLimits> {
  const limits: ParticleLimits = {
    maxLiveParticles: options?.maxLiveParticles ?? DEFAULT_MAX_LIVE_PARTICLES,
    maxTotalBirths: options?.maxTotalBirths ?? DEFAULT_MAX_TOTAL_BIRTHS,
    maxBurstEvents: options?.maxBurstEvents ?? DEFAULT_MAX_BURST_EVENTS,
  };
  const errors: Diagnostic[] = [];
  if (!isTickInt(limits.maxLiveParticles, 0, DEFAULT_MAX_LIVE_PARTICLES)) errors.push(err('INVALID_VALUE', `maxLiveParticles must be an integer 0..${DEFAULT_MAX_LIVE_PARTICLES}.`, 'options.maxLiveParticles'));
  if (!isTickInt(limits.maxTotalBirths, 0, DEFAULT_MAX_TOTAL_BIRTHS)) errors.push(err('INVALID_VALUE', `maxTotalBirths must be an integer 0..${DEFAULT_MAX_TOTAL_BIRTHS}.`, 'options.maxTotalBirths'));
  if (!isTickInt(limits.maxBurstEvents, 0, DEFAULT_MAX_BURST_EVENTS)) errors.push(err('INVALID_VALUE', `maxBurstEvents must be an integer 0..${DEFAULT_MAX_BURST_EVENTS}.`, 'options.maxBurstEvents'));
  return errors.length ? { ok: false, errors } : { ok: true, value: limits, warnings: [] };
}

function cloneVec(v: Vec3): Vec3 {
  return [v[0], v[1], v[2]];
}

/** Validates and returns a deep-cloned, frozen descriptor. Bursts are sorted by (tick, eventRandomKey). */
export function validateParticleDescriptor(input: unknown, options?: Partial<ParticleLimits>): ValidationResult<ParticleEmitterDescriptor> {
  const lim = resolveLimits(options);
  if (!lim.ok) return lim;
  const limits = lim.value;
  const e: Diagnostic[] = [];
  if (!isObj(input)) return { ok: false, errors: [err('INVALID_VALUE', 'Particle descriptor must be an object.', 'descriptor')] };
  const p = 'descriptor';
  checkKeys(input, ['documentSeed', 'durationTicks', 'emitterId', 'randomStreamId', 'shape', 'sourcePosition', 'initialVelocity', 'emission', 'spin', 'sourceTrack', 'attachToSource', 'bursts', 'rate', 'lifetimeTicks', 'size', 'operators'], p, e);
  if (!isUint32(input.documentSeed)) e.push(err('INVALID_VALUE', 'documentSeed must be uint32.', `${p}.documentSeed`));
  const duration = input.durationTicks;
  const durationOk = isTickInt(duration, 1, MAX_DURATION_TICKS);
  if (!durationOk) e.push(err('INVALID_VALUE', `durationTicks must be an integer 1..${MAX_DURATION_TICKS}.`, `${p}.durationTicks`));
  const maxTick = durationOk ? (duration as number) : MAX_DURATION_TICKS;
  for (const k of ['emitterId', 'randomStreamId'] as const) {
    if (typeof input[k] !== 'string' || !ID_PATTERN.test(input[k] as string)) e.push(err('INVALID_VALUE', `${k} must be a stored identifier.`, `${p}.${k}`));
  }
  if (!SHAPES.includes(input.shape as EmitterShape)) e.push(err('INVALID_VALUE', 'shape must be point, cone, sphere, disc or box (path emission is not implemented).', `${p}.shape`));
  let emission: ParticleEmission | undefined;
  const em = input.emission;
  if (em === undefined) {
    if (input.shape !== 'point') e.push(err('INVALID_VALUE', `shape "${String(input.shape)}" requires an emission block (axis, radius, coneAngle, speed).`, `${p}.shape`));
  } else if (!isObj(em)) e.push(err('INVALID_VALUE', 'emission must be an object.', `${p}.emission`));
  else {
    const ep = `${p}.emission`;
    checkKeys(em, ['shape', 'axis', 'radius', 'coneAngle', 'speed'], ep, e);
    let ok = true;
    if (em.shape !== input.shape) { ok = false; e.push(err('INVALID_VALUE', 'emission.shape must equal descriptor.shape.', `${ep}.shape`)); }
    if (!isVec3(em.axis) || Math.abs(Math.hypot(em.axis[0], em.axis[1], em.axis[2]) - 1) > 1e-6) { ok = false; e.push(err('INVALID_VALUE', 'emission.axis must be a finite unit vec3.', `${ep}.axis`)); }
    if (!isFiniteNum(em.radius) || em.radius < 0 || em.radius > 20) { ok = false; e.push(err('INVALID_VALUE', 'emission.radius must be finite in 0..20.', `${ep}.radius`)); }
    if (!isFiniteNum(em.coneAngle) || em.coneAngle < 0 || em.coneAngle > Math.PI) { ok = false; e.push(err('INVALID_VALUE', 'emission.coneAngle must be finite in 0..π.', `${ep}.coneAngle`)); }
    const sp = em.speed;
    if (!isObj(sp) || !isFiniteNum(sp.min) || !isFiniteNum(sp.max) || sp.min < 0 || sp.max < sp.min || sp.max > 100) { ok = false; e.push(err('INVALID_VALUE', 'emission.speed must be {min,max} with 0 <= min <= max <= 100.', `${ep}.speed`)); }
    else checkKeys(sp, ['min', 'max'], `${ep}.speed`, e);
    if (ok) emission = { shape: em.shape as EmitterShape, axis: cloneVec(em.axis as Vec3), radius: em.radius as number, coneAngle: em.coneAngle as number, speed: { min: (sp as Record<string, number>).min, max: (sp as Record<string, number>).max } };
  }
  if (!isVec3(input.sourcePosition)) e.push(err('INVALID_VALUE', 'sourcePosition must be a finite vec3.', `${p}.sourcePosition`));

  const iv = input.initialVelocity;
  if (!isObj(iv)) e.push(err('INVALID_VALUE', 'initialVelocity must be an object.', `${p}.initialVelocity`));
  else if (iv.kind === 'vector') {
    checkKeys(iv, ['kind', 'value'], `${p}.initialVelocity`, e);
    if (!isVec3(iv.value)) e.push(err('INVALID_VALUE', 'initialVelocity.value must be a finite vec3.', `${p}.initialVelocity.value`));
  } else if (iv.kind === 'speed') {
    checkKeys(iv, ['kind', 'speed'], `${p}.initialVelocity`, e);
    if (!isFiniteNum(iv.speed) || iv.speed < 0) e.push(err('INVALID_VALUE', 'initialVelocity.speed must be finite and >= 0.', `${p}.initialVelocity.speed`));
  } else e.push(err('INVALID_VALUE', 'initialVelocity.kind must be "vector" or "speed".', `${p}.initialVelocity.kind`));

  const bursts: ParticleBurst[] = [];
  if (!Array.isArray(input.bursts)) e.push(err('INVALID_VALUE', 'bursts must be an array.', `${p}.bursts`));
  else {
    if (input.bursts.length > limits.maxBurstEvents) e.push(err('BUDGET_EXCEEDED', `bursts has ${input.bursts.length} events; limit is ${limits.maxBurstEvents}.`, `${p}.bursts`));
    const seen = new Set<string>();
    const arr: unknown[] = input.bursts;
    for (let i = 0; i < arr.length; i++) {
      const bp = `${p}.bursts[${i}]`;
      if (!(i in arr)) { e.push(err('INVALID_VALUE', 'bursts must not be sparse (hole at this index).', bp)); continue; }
      const b = arr[i];
      if (!isObj(b)) { e.push(err('INVALID_VALUE', 'Burst must be an object.', bp)); continue; }
      checkKeys(b, ['tick', 'eventRandomKey', 'count', 'position', 'velocity'], bp, e);
      let ok = true;
      if (!isTickInt(b.tick, 0, maxTick - 1)) { ok = false; e.push(err('INVALID_VALUE', 'Burst tick must be an integer in [0, durationTicks).', `${bp}.tick`)); }
      if (typeof b.eventRandomKey !== 'string') { ok = false; e.push(err('INVALID_VALUE', 'eventRandomKey must be a string.', `${bp}.eventRandomKey`)); }
      else if (b.eventRandomKey === RATE_EVENT_RANDOM_KEY) { ok = false; e.push(err('INVALID_VALUE', 'Burst eventRandomKey must be non-empty; the empty key is reserved for rate births.', `${bp}.eventRandomKey`)); }
      else if (seen.has(b.eventRandomKey)) { ok = false; e.push(err('DUPLICATE_ID', 'Burst eventRandomKey must be unique; a burst spawns once per unique trigger event.', `${bp}.eventRandomKey`)); }
      else seen.add(b.eventRandomKey);
      if (!isTickInt(b.count, 0, limits.maxTotalBirths)) { ok = false; e.push(err('INVALID_VALUE', `Burst count must be an integer 0..${limits.maxTotalBirths}.`, `${bp}.count`)); }
      if (b.position !== undefined && !isVec3(b.position)) { ok = false; e.push(err('INVALID_VALUE', 'Burst position must be a finite vec3.', `${bp}.position`)); }
      if (b.velocity !== undefined && !isVec3(b.velocity)) { ok = false; e.push(err('INVALID_VALUE', 'Burst velocity must be a finite vec3.', `${bp}.velocity`)); }
      if (!ok) continue;
      const out: ParticleBurst = { tick: b.tick as number, eventRandomKey: b.eventRandomKey as string, count: b.count as number };
      if (b.position !== undefined) out.position = cloneVec(b.position as Vec3);
      if (b.velocity !== undefined) out.velocity = cloneVec(b.velocity as Vec3);
      bursts.push(out);
    }
  }

  let rate: ParticleRate | undefined;
  if (input.rate !== undefined) {
    const r = input.rate;
    const rp = `${p}.rate`;
    if (!isObj(r)) e.push(err('INVALID_VALUE', 'rate must be an object.', rp));
    else {
      checkKeys(r, ['perSecond', 'startTick', 'endTick', 'curve'], rp, e);
      if (r.curve !== undefined && (!Array.isArray(r.curve) || r.curve.length < 1 || !r.curve.every((k: unknown, i: number, a: unknown[]) => isObj(k) && isFiniteNum(k.x) && isFiniteNum(k.y) && k.x >= 0 && k.x <= 1 && k.y >= 0 && k.y <= 4 && (i === 0 || (k.x as number) > ((a[i - 1] as Record<string, number>).x))))) { e.push(err('INVALID_VALUE', 'rate.curve must be keys {x in [0,1] ascending, y in [0,4]}.', `${rp}.curve`)); }
      let ok = true;
      if (!isFiniteNum(r.perSecond) || r.perSecond < 0 || r.perSecond > MAX_RATE_PER_SECOND) { ok = false; e.push(err('INVALID_VALUE', `rate.perSecond must be finite in 0..${MAX_RATE_PER_SECOND}.`, `${rp}.perSecond`)); }
      if (!isTickInt(r.startTick, 0, maxTick)) { ok = false; e.push(err('INVALID_VALUE', 'rate.startTick must be an integer in [0, durationTicks].', `${rp}.startTick`)); }
      if (!isTickInt(r.endTick, 0, maxTick)) { ok = false; e.push(err('INVALID_VALUE', 'rate.endTick must be an integer in [0, durationTicks].', `${rp}.endTick`)); }
      else if (ok && (r.endTick as number) < (r.startTick as number)) { ok = false; e.push(err('INVALID_VALUE', 'rate.endTick must be >= startTick (end-exclusive window).', `${rp}.endTick`)); }
      if (ok) rate = { perSecond: r.perSecond as number, startTick: r.startTick as number, endTick: r.endTick as number, ...(Array.isArray(r.curve) ? { curve: (r.curve as { x: number; y: number }[]).map(k => ({ x: k.x, y: k.y })) } : {}) };
    }
  }

  const lt = input.lifetimeTicks;
  if (!isObj(lt)) e.push(err('INVALID_VALUE', 'lifetimeTicks must be {min,max}.', `${p}.lifetimeTicks`));
  else {
    checkKeys(lt, ['min', 'max'], `${p}.lifetimeTicks`, e);
    if (!isTickInt(lt.min, 1, MAX_DURATION_TICKS)) e.push(err('INVALID_VALUE', `lifetimeTicks.min must be an integer 1..${MAX_DURATION_TICKS}.`, `${p}.lifetimeTicks.min`));
    if (!isTickInt(lt.max, 1, MAX_DURATION_TICKS)) e.push(err('INVALID_VALUE', `lifetimeTicks.max must be an integer 1..${MAX_DURATION_TICKS}.`, `${p}.lifetimeTicks.max`));
    else if (isTickInt(lt.min, 1, MAX_DURATION_TICKS) && (lt.max as number) < (lt.min as number)) e.push(err('INVALID_VALUE', 'lifetimeTicks.max must be >= min.', `${p}.lifetimeTicks.max`));
  }
  const sz = input.size;
  if (!isObj(sz)) e.push(err('INVALID_VALUE', 'size must be {min,max}.', `${p}.size`));
  else {
    checkKeys(sz, ['min', 'max'], `${p}.size`, e);
    if (!isFiniteNum(sz.min) || sz.min < 0) e.push(err('INVALID_VALUE', 'size.min must be finite and >= 0.', `${p}.size.min`));
    if (!isFiniteNum(sz.max) || sz.max < 0) e.push(err('INVALID_VALUE', 'size.max must be finite and >= 0.', `${p}.size.max`));
    else if (isFiniteNum(sz.min) && sz.max < sz.min) e.push(err('INVALID_VALUE', 'size.max must be >= min.', `${p}.size.max`));
  }

  let spin: ParticleSpin | undefined;
  if (input.spin !== undefined) {
    const s = input.spin, sp = `${p}.spin`;
    const range = (r: unknown, lo: number, hi: number) => isObj(r) && isFiniteNum(r.min) && isFiniteNum(r.max) && r.min >= lo && r.max <= hi && r.min <= r.max;
    if (!isObj(s)) e.push(err('INVALID_VALUE', 'spin must be an object.', sp));
    else {
      checkKeys(s, ['rotation', 'angularVelocity'], sp, e);
      const okR = range(s.rotation, -2 * Math.PI, 2 * Math.PI), okW = range(s.angularVelocity, -20, 20);
      if (!okR) e.push(err('INVALID_VALUE', 'spin.rotation must be {min,max} within ±2π with min <= max.', `${sp}.rotation`));
      if (!okW) e.push(err('INVALID_VALUE', 'spin.angularVelocity must be {min,max} within ±20 rad/s with min <= max.', `${sp}.angularVelocity`));
      if (okR && okW) {
        const r = s.rotation as Record<string, number>, w = s.angularVelocity as Record<string, number>;
        spin = { rotation: { min: r.min, max: r.max }, angularVelocity: { min: w.min, max: w.max } };
      }
    }
  }

  let sourceTrack: ParticleEmitterDescriptor['sourceTrack'];
  if (input.sourceTrack !== undefined) {
    const st = input.sourceTrack, sp = `${p}.sourceTrack`;
    if (!isObj(st) || !isTickInt(st.startTick, 0, MAX_DURATION_TICKS) || !Array.isArray(st.positions) || st.positions.length < 1 || st.positions.length > MAX_DURATION_TICKS + 1 || !st.positions.every(isVec3)) e.push(err('INVALID_VALUE', 'sourceTrack must be {startTick, positions: 1..601 finite vec3}.', sp));
    else sourceTrack = { startTick: st.startTick as number, positions: (st.positions as Vec3[]).map(cloneVec) };
  }
  if (input.attachToSource !== undefined && typeof input.attachToSource !== 'boolean') e.push(err('INVALID_VALUE', 'attachToSource must be boolean.', `${p}.attachToSource`));

  const operators: ParticleOperator[] = [];
  if (!Array.isArray(input.operators)) e.push(err('INVALID_VALUE', 'operators must be an array.', `${p}.operators`));
  else for (let i = 0, ops: unknown[] = input.operators; i < ops.length; i++) {
    const op = `${p}.operators[${i}]`;
    if (!(i in ops)) { e.push(err('INVALID_VALUE', 'operators must not be sparse (hole at this index).', op)); continue; }
    const o = ops[i];
    if (!isObj(o)) { e.push(err('INVALID_VALUE', 'Operator must be an object.', op)); continue; }
    if (o.kind === 'gravity') {
      checkKeys(o, ['kind', 'acceleration'], op, e);
      if (!isVec3(o.acceleration)) e.push(err('INVALID_VALUE', 'gravity.acceleration must be a finite vec3.', `${op}.acceleration`));
      else operators.push({ kind: 'gravity', acceleration: cloneVec(o.acceleration) });
    } else if (o.kind === 'drag') {
      checkKeys(o, ['kind', 'coefficient'], op, e);
      if (!isFiniteNum(o.coefficient) || o.coefficient < 0 || o.coefficient > MAX_DRAG_COEFFICIENT) e.push(err('INVALID_VALUE', `drag.coefficient must be finite in 0..${MAX_DRAG_COEFFICIENT}.`, `${op}.coefficient`));
      else operators.push({ kind: 'drag', coefficient: o.coefficient });
    } else if (o.kind === 'noise') {
      checkKeys(o, ['kind', 'mode', 'amplitude', 'frequency', 'evolution', 'randomStreamId'], op, e);
      let ok = true;
      if (o.mode !== 'vector' && o.mode !== 'curl') { ok = false; e.push(err('INVALID_VALUE', 'noise.mode must be vector or curl.', `${op}.mode`)); }
      const bounds: [string, number, number][] = [['amplitude', 0, 100], ['frequency', 0.01, 20], ['evolution', 0, 10]];
      for (const [k, lo, hi] of bounds) if (!isFiniteNum(o[k]) || (o[k] as number) < lo || (o[k] as number) > hi) { ok = false; e.push(err('INVALID_VALUE', `noise.${k} must be finite in ${lo}..${hi}.`, `${op}.${k}`)); }
      if (typeof o.randomStreamId !== 'string' || !ID_PATTERN.test(o.randomStreamId)) { ok = false; e.push(err('INVALID_VALUE', 'noise.randomStreamId must be a stored identifier.', `${op}.randomStreamId`)); }
      if (ok) operators.push({ kind: 'noise', mode: o.mode as 'vector' | 'curl', amplitude: o.amplitude as number, frequency: o.frequency as number, evolution: o.evolution as number, randomStreamId: o.randomStreamId as string });
    } else if (o.kind === 'attract' || o.kind === 'vortex') {
      const attract = o.kind === 'attract';
      checkKeys(o, attract ? ['kind', 'center', 'acceleration', 'softRadius', 'killRadius'] : ['kind', 'center', 'axis', 'tangential', 'inward', 'falloff'], op, e);
      let ok = isVec3(o.center);
      if (!ok) e.push(err('INVALID_VALUE', `${o.kind}.center must be a finite vec3.`, `${op}.center`));
      const bounds: [string, number, number][] = attract ? [['acceleration', 0, 100], ['softRadius', 0.01, 10], ['killRadius', 0, 10]] : [['tangential', -100, 100], ['inward', -100, 100], ['falloff', 0.01, 20]];
      for (const [k, lo, hi] of bounds) if (!isFiniteNum(o[k]) || (o[k] as number) < lo || (o[k] as number) > hi) { ok = false; e.push(err('INVALID_VALUE', `${o.kind}.${k} must be finite in ${lo}..${hi}.`, `${op}.${k}`)); }
      if (!attract && (!isVec3(o.axis) || Math.abs(Math.hypot(...(o.axis as Vec3)) - 1) > 1e-6)) { ok = false; e.push(err('INVALID_VALUE', 'vortex.axis must be a unit vec3.', `${op}.axis`)); }
      if (ok) operators.push(attract
        ? { kind: 'attract', center: cloneVec(o.center as Vec3), acceleration: o.acceleration as number, softRadius: o.softRadius as number, killRadius: o.killRadius as number }
        : { kind: 'vortex', center: cloneVec(o.center as Vec3), axis: cloneVec(o.axis as Vec3), tangential: o.tangential as number, inward: o.inward as number, falloff: o.falloff as number });
    } else if (o.kind === 'ground') {
      checkKeys(o, ['kind', 'mode', 'restitution', 'friction', 'maxBounces'], op, e);
      let ok = true;
      if (o.mode !== 'kill' && o.mode !== 'slide' && o.mode !== 'bounce') { ok = false; e.push(err('INVALID_VALUE', 'ground.mode must be kill, slide or bounce.', `${op}.mode`)); }
      for (const k of ['restitution', 'friction'] as const) if (!isFiniteNum(o[k]) || (o[k] as number) < 0 || (o[k] as number) > 1) { ok = false; e.push(err('INVALID_VALUE', `ground.${k} must be finite in 0..1.`, `${op}.${k}`)); }
      if (!isTickInt(o.maxBounces, 0, 8)) { ok = false; e.push(err('INVALID_VALUE', 'ground.maxBounces must be an integer 0..8.', `${op}.maxBounces`)); }
      if (ok) operators.push({ kind: 'ground', mode: o.mode as GroundMode, restitution: o.restitution as number, friction: o.friction as number, maxBounces: o.maxBounces as number });
    } else e.push(err('INVALID_VALUE', 'Only gravity, drag, noise, attract, vortex and ground operators are implemented.', `${op}.kind`));
  }

  if (e.length) return { ok: false, errors: e };
  bursts.sort((a, b) => a.tick - b.tick || (a.eventRandomKey < b.eventRandomKey ? -1 : a.eventRandomKey > b.eventRandomKey ? 1 : 0));
  const velocity: ParticleVelocitySpec = (iv as Record<string, unknown>).kind === 'vector'
    ? { kind: 'vector', value: cloneVec((iv as Record<string, unknown>).value as Vec3) }
    : { kind: 'speed', speed: (iv as Record<string, unknown>).speed as number };
  const d: ParticleEmitterDescriptor = {
    documentSeed: input.documentSeed as number,
    durationTicks: duration as number,
    emitterId: input.emitterId as string,
    randomStreamId: input.randomStreamId as string,
    shape: input.shape as EmitterShape,
    sourcePosition: cloneVec(input.sourcePosition as Vec3),
    initialVelocity: velocity,
    bursts,
    lifetimeTicks: { min: (lt as Record<string, number>).min, max: (lt as Record<string, number>).max },
    size: { min: (sz as Record<string, number>).min, max: (sz as Record<string, number>).max },
    operators,
  };
  if (rate) d.rate = rate;
  if (emission) d.emission = emission;
  if (spin) d.spin = spin;
  if (sourceTrack) d.sourceTrack = sourceTrack;
  if (input.attachToSource === true) d.attachToSource = true;
  return { ok: true, value: deepFreeze(d), warnings: [] };
}

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null) {
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}

/** Two unit vectors perpendicular to unit `a` and to each other; deterministic. */
export function basis(a: Vec3): [Vec3, Vec3] {
  const h: Vec3 = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let x = h[1] * a[2] - h[2] * a[1], y = h[2] * a[0] - h[0] * a[2], z = h[0] * a[1] - h[1] * a[0];
  const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
  return [[x, y, z], [a[1] * z - a[2] * y, a[2] * x - a[0] * z, a[0] * y - a[1] * x]];
}

function cloneParticle(p: ParticleState): ParticleState {
  return { ...p, position: cloneVec(p.position), velocity: cloneVec(p.velocity) };
}

/**
 * One-emitter fixed-step simulation. Create at tick 0 (tick-0 births applied, age 0, no movement),
 * then advance() one tick at a time up to durationTicks. After an error the simulation is stopped.
 */
export class ParticleSimulation {
  readonly descriptor: ParticleEmitterDescriptor;
  readonly limits: ParticleLimits;
  #tick = 0;
  #particles: ParticleState[] = [];
  #births: string[] = [];
  #deaths: string[] = [];
  #totalBirths = 0;
  #totalDeaths = 0;
  #rateEligibleTicks = 0;
  #rateEmitted = 0;
  /** Curved rates integrate rate×curve per tick (flat rates keep the exact integer formula). */
  #rateIntegral = 0;
  #burstCursor = 0;
  #failure: Diagnostic[] | null = null;
  readonly #parentKeys = new Map<string, string>();
  /** Only filled when created with recordEvents (compile-time child emission); the viewport never records. */
  #record = false;
  readonly #events: ParticleEvent[] = [];

  private constructor(descriptor: ParticleEmitterDescriptor, limits: ParticleLimits) {
    this.descriptor = descriptor;
    this.limits = Object.freeze({ ...limits });
  }

  static create(input: unknown, options?: Partial<ParticleLimits>, recordEvents = false): ValidationResult<ParticleSimulation> {
    const lim = resolveLimits(options);
    if (!lim.ok) return lim;
    const v = validateParticleDescriptor(input, lim.value);
    if (!v.ok) return v;
    const sim = new ParticleSimulation(v.value, lim.value);
    sim.#record = recordEvents;
    sim.#spawn(0);
    if (sim.#failure) return { ok: false, errors: sim.#failure.map((d) => ({ ...d })) };
    return { ok: true, value: sim, warnings: [] };
  }

  get tick(): number { return this.#tick; }
  /** Events recorded so far (recordEvents only), in occurrence order. */
  get events(): readonly ParticleEvent[] { return this.#events; }
  #event(kind: ParticleEventKind, tick: number, p: ParticleState, ordinal: number): void {
    if (this.#record) this.#events.push({ kind, tick, particleId: p.id, parentRandomKey: p.parentRandomKey, ordinal, position: cloneVec(p.position), velocity: cloneVec(p.velocity) });
  }
  get failed(): boolean { return this.#failure !== null; }

  /** Deep snapshot of the current tick; never aliases internal state. */
  snapshot(): ParticleTickSnapshot {
    const ended = this.#tick >= this.descriptor.durationTicks;
    const rate = this.descriptor.rate;
    const remainder = !rate ? 0 : rate.curve ? this.#rateIntegral - this.#rateEmitted : (this.#rateEligibleTicks * rate.perSecond) / TICKS_PER_SECOND - this.#rateEmitted;
    return {
      tick: this.#tick,
      ended,
      particles: ended ? [] : this.#particles.map(cloneParticle),
      births: ended ? [] : [...this.#births],
      deaths: ended ? [] : [...this.#deaths],
      totalBirths: this.#totalBirths,
      totalDeaths: this.#totalDeaths,
      rateRemainder: remainder,
    };
  }

  /** Advance exactly one tick: expire, integrate survivors, then births. */
  advance(): ValidationResult<ParticleTickSnapshot> {
    if (this.#failure) return { ok: false, errors: this.#failure.map((d) => ({ ...d })) };
    const d = this.descriptor;
    if (this.#tick >= d.durationTicks) {
      return { ok: false, errors: [err('INVALID_VALUE', `Cannot advance past document end tick ${d.durationTicks}.`, 'tick')] };
    }
    const n = this.#tick + 1;
    this.#tick = n;
    this.#births = [];
    this.#deaths = [];
    if (n >= d.durationTicks) {
      // Document end forcibly empties all outputs; this is not a lifetime death event.
      this.#particles = [];
      return { ok: true, value: this.snapshot(), warnings: [] };
    }
    const survivors: ParticleState[] = [];
    for (const p of this.#particles) {
      if (p.birthTick + p.lifetimeTicks <= n) { this.#deaths.push(p.id); this.#totalDeaths++; this.#event('death', n, p, 0); }
      else survivors.push(p);
    }
    this.#particles = survivors;
    const dt = PARTICLE_DT;
    let ax = 0, ay = 0, az = 0, dragFactor = 1;
    for (const op of d.operators) {
      if (op.kind === 'gravity') { ax += op.acceleration[0]; ay += op.acceleration[1]; az += op.acceleration[2]; }
      else if (op.kind === 'drag') dragFactor *= Math.exp(-op.coefficient * dt);
    }
    const noises = d.operators.flatMap(o => o.kind === 'noise' ? [{ o, seeds: this.#noiseSeeds(o.randomStreamId) }] : []);
    const na: Vec3 = [0, 0, 0];
    const killed = new Set<ParticleState>();
    const fields = d.operators.filter((o): o is Extract<ParticleOperator, { kind: 'attract' | 'vortex' }> => o.kind === 'attract' || o.kind === 'vortex');
    const ground = d.operators.find((o): o is Extract<ParticleOperator, { kind: 'ground' }> => o.kind === 'ground');
    for (const p of survivors) {
      const v = p.velocity, x = p.position;
      let px = ax, py = ay, pz = az;
      for (const { o, seeds } of noises) {
        // Field sampled at the start-of-tick position; time is effect seconds × evolution.
        noiseAcceleration(seeds, o.mode, o.amplitude, o.frequency, (n - 1) * dt * o.evolution, x, na);
        px += na[0]; py += na[1]; pz += na[2];
      }
      for (const f of fields) {
        const rx = x[0] - f.center[0], ry = x[1] - f.center[1], rz = x[2] - f.center[2];
        if (f.kind === 'attract') {
          const dd = Math.hypot(rx, ry, rz);
          if (f.killRadius > 0 && dd < f.killRadius) { killed.add(p); continue; }
          const k = dd > 1e-9 ? -f.acceleration / Math.sqrt(dd * dd + f.softRadius * f.softRadius) : 0;
          px += rx * k; py += ry * k; pz += rz * k;
        } else {
          const a = f.axis, along = rx * a[0] + ry * a[1] + rz * a[2];
          const qx = rx - a[0] * along, qy = ry - a[1] * along, qz = rz - a[2] * along, rho = Math.hypot(qx, qy, qz);
          if (rho < 1e-9) continue;
          const ux = qx / rho, uy = qy / rho, uz = qz / rho, fall = Math.exp(-rho / f.falloff);
          const tx = a[1] * uz - a[2] * uy, ty = a[2] * ux - a[0] * uz, tz = a[0] * uy - a[1] * ux;
          px += fall * (f.tangential * tx - f.inward * ux); py += fall * (f.tangential * ty - f.inward * uy); pz += fall * (f.tangential * tz - f.inward * uz);
        }
      }
      v[0] = (v[0] + px * dt) * dragFactor;
      v[1] = (v[1] + py * dt) * dragFactor;
      v[2] = (v[2] + pz * dt) * dragFactor;
      x[0] += v[0] * dt; x[1] += v[1] * dt; x[2] += v[2] * dt;
      if (d.attachToSource && d.sourceTrack) {
        const a = this.#source(n), b = this.#source(n - 1);
        x[0] = a[0]; x[1] = a[1]; x[2] = a[2];
        v[0] = (a[0] - b[0]) / dt; v[1] = (a[1] - b[1]) / dt; v[2] = (a[2] - b[2]) / dt;
      }
      if (ground && x[1] <= 0 && (v[1] <= 0 || x[1] < 0)) {
        if (ground.mode === 'kill') { x[1] = 0; killed.add(p); this.#event('collision', n, p, 0); this.#event('death', n, p, 0); }
        else {
          const b = p.bounces ?? 0;
          x[1] = 0;
          if (ground.mode === 'bounce' && b < ground.maxBounces && v[1] < -1e-6) {
            this.#event('collision', n, p, b);
            p.bounces = b + 1;
            v[1] = -v[1] * ground.restitution;
            v[0] *= 1 - ground.friction; v[2] *= 1 - ground.friction;
          } else {
            if (!p.grounded) { this.#event('collision', n, p, b); p.grounded = true; }
            p.bounces = b;
            v[1] = Math.max(0, v[1]);
            const h = Math.hypot(v[0], v[2]), k = h > 0 ? Math.max(0, h - ground.friction * 9.81 * dt) / h : 0;
            v[0] *= k; v[2] *= k;
          }
        }
      }
      p.ageTicks = n - p.birthTick;
      if (!v.every(Number.isFinite) || !x.every(Number.isFinite)) {
        this.#failure = [{ ...err('INVALID_VALUE', `Particle ${p.id} reached nonfinite state at tick ${n}; emitter stopped.`), nodeId: d.emitterId }];
        return { ok: false, errors: this.#failure.map((q) => ({ ...q })) };
      }
    }
    if (killed.size) {
      this.#particles = survivors.filter(p => !killed.has(p));
      for (const p of survivors) if (killed.has(p)) { this.#deaths.push(p.id); this.#totalDeaths++; }
    }
    this.#spawn(n);
    if (this.#failure) return { ok: false, errors: (this.#failure as Diagnostic[]).map((q) => ({ ...q })) };
    return { ok: true, value: this.snapshot(), warnings: [] };
  }

  /** Source position at tick n: the track (clamped) or the fixed sourcePosition. */
  #source(n: number): Vec3 {
    const t = this.descriptor.sourceTrack;
    if (!t) return this.descriptor.sourcePosition;
    return t.positions[Math.max(0, Math.min(t.positions.length - 1, n - t.startTick))];
  }

  #noiseSeeds(streamId: string): NoiseFieldSeeds {
    const d = this.descriptor;
    const s = (i: number) => randomTupleHash({ documentSeed: d.documentSeed, randomStreamId: streamId, eventRandomKey: 'noiseField', entityOrdinal: i, propertyKey: 'noise', sampleOrdinal: 0 });
    return [s(0), s(1), s(2)];
  }

  #parentKey(eventRandomKey: string, entityOrdinal: number): string {
    const d = this.descriptor;
    return emitterParentRandomKey({ documentSeed: d.documentSeed, randomStreamId: d.randomStreamId, eventRandomKey, entityOrdinal });
  }

  #sample(eventRandomKey: string, entityOrdinal: number, propertyKey: string): number {
    const d = this.descriptor;
    return sampleUnit({ documentSeed: d.documentSeed, randomStreamId: d.randomStreamId, eventRandomKey, entityOrdinal, propertyKey, sampleOrdinal: 0 });
  }

  /** Shaped birth position/velocity from stable per-particle samples; burst payload velocity wins when given. */
  #kinematics(eventRandomKey: string, entityOrdinal: number, base: Vec3, fixedVelocity: Vec3 | undefined, fallback: Vec3): [Vec3, Vec3] {
    const em = this.descriptor.emission;
    if (!em) return [base, fixedVelocity ?? fallback];
    const s = (k: string) => this.#sample(eventRandomKey, entityOrdinal, k);
    const K = PARTICLE_PROPERTY_KEYS;
    const a = em.axis, [b1, b2] = basis(a);
    const u = s(K.dirU), az = 2 * Math.PI * s(K.dirV);
    const comb = (x: number, y: number, z: number): Vec3 => [a[0] * x + b1[0] * y + b2[0] * z, a[1] * x + b1[1] * y + b2[1] * z, a[2] * x + b1[2] * y + b2[2] * z];
    let dir: Vec3 = a, off: Vec3 = [0, 0, 0];
    if (em.shape === 'cone') {
      const c = 1 + (Math.cos(em.coneAngle) - 1) * u, sn = Math.sqrt(Math.max(0, 1 - c * c));
      dir = comb(c, sn * Math.cos(az), sn * Math.sin(az));
      const r = em.radius * Math.sqrt(s(K.posU)), pa = 2 * Math.PI * s(K.posV);
      off = comb(0, r * Math.cos(pa), r * Math.sin(pa));
    } else if (em.shape === 'sphere') {
      const z = 2 * u - 1, sn = Math.sqrt(Math.max(0, 1 - z * z));
      dir = comb(z, sn * Math.cos(az), sn * Math.sin(az));
      const r = em.radius * Math.cbrt(s(K.posW));
      off = [dir[0] * r, dir[1] * r, dir[2] * r];
    } else if (em.shape === 'disc') {
      dir = comb(0, Math.cos(az), Math.sin(az));
      const r = em.radius * Math.sqrt(s(K.posU));
      off = [dir[0] * r, dir[1] * r, dir[2] * r];
    } else if (em.shape === 'box') {
      off = comb((2 * s(K.posU) - 1) * em.radius, (2 * s(K.posV) - 1) * em.radius, (2 * s(K.posW) - 1) * em.radius);
    }
    const speed = em.speed.min === em.speed.max ? em.speed.min : em.speed.min + s(K.speed) * (em.speed.max - em.speed.min);
    const vel: Vec3 = fixedVelocity ?? [dir[0] * speed, dir[1] * speed, dir[2] * speed];
    return [[base[0] + off[0], base[1] + off[1], base[2] + off[2]], vel];
  }

  #birth(n: number, emission: 'burst' | 'rate', burstIndex: number, eventRandomKey: string, entityOrdinal: number, basePosition: Vec3, fixedVelocity: Vec3 | undefined, fallbackVelocity: Vec3): boolean {
    const d = this.descriptor;
    if (this.#totalBirths >= this.limits.maxTotalBirths) {
      this.#failure = [{ ...err('BUDGET_EXCEEDED', `Emitter exceeded ${this.limits.maxTotalBirths} total births at tick ${n}; emitter stopped (no silent truncation).`), nodeId: d.emitterId }];
      return false;
    }
    if (this.#particles.length >= this.limits.maxLiveParticles) {
      this.#failure = [{ ...err('BUDGET_EXCEEDED', `Emitter exceeded ${this.limits.maxLiveParticles} live particles at tick ${n}; emitter stopped (no silent truncation).`), nodeId: d.emitterId }];
      return false;
    }
    const { min: lmin, max: lmax } = d.lifetimeTicks;
    const lifetime = lmin + Math.min(lmax - lmin, Math.floor(this.#sample(eventRandomKey, entityOrdinal, PARTICLE_PROPERTY_KEYS.lifetime) * (lmax - lmin + 1)));
    const size = d.size.min === d.size.max ? d.size.min
      : d.size.min + this.#sample(eventRandomKey, entityOrdinal, PARTICLE_PROPERTY_KEYS.size) * (d.size.max - d.size.min);
    const [position, velocity] = this.#kinematics(eventRandomKey, entityOrdinal, basePosition, fixedVelocity, fallbackVelocity);
    const id = emission === 'burst' ? burstParticleId(d.emitterId, eventRandomKey, entityOrdinal) : `${d.emitterId}:rate:${entityOrdinal}`;
    this.#particles.push({
      id, emission, burstIndex, entityOrdinal, eventRandomKey,
      parentRandomKey: this.#parentKey(eventRandomKey, entityOrdinal),
      birthTick: n, lifetimeTicks: lifetime, ageTicks: 0, size,
      position: cloneVec(position), velocity: cloneVec(velocity),
    });
    if (d.spin) {
      const p = this.#particles[this.#particles.length - 1], K = PARTICLE_PROPERTY_KEYS;
      const pick = (r: { min: number; max: number }, key: string) => r.min === r.max ? r.min : r.min + this.#sample(eventRandomKey, entityOrdinal, key) * (r.max - r.min);
      p.rotation = pick(d.spin.rotation, K.rotation);
      p.angularVelocity = pick(d.spin.angularVelocity, K.angularVelocity);
    }
    this.#births.push(id);
    this.#totalBirths++;
    this.#event('birth', n, this.#particles[this.#particles.length - 1], 0);
    return true;
  }

  #spawn(n: number): void {
    const d = this.descriptor;
    const iv = d.initialVelocity;
    const baseVelocity: Vec3 = iv.kind === 'vector' ? cloneVec(iv.value) : [iv.speed, 0, 0];
    while (this.#burstCursor < d.bursts.length && d.bursts[this.#burstCursor].tick === n) {
      const bi = this.#burstCursor++;
      const b = d.bursts[bi];
      const pos = b.position ?? this.#source(n);
      for (let i = 0; i < b.count; i++) {
        if (!this.#birth(n, 'burst', bi, b.eventRandomKey, i, pos, b.velocity, baseVelocity)) return;
      }
    }
    const r = d.rate;
    if (r && n >= r.startTick && n < r.endTick) {
      this.#rateEligibleTicks++;
      // floor(eligibleTicks*r/60) equals the r/60 accumulator without float drift for integer rates.
      let due: number;
      if (r.curve) {
        const u = (n - r.startTick) / Math.max(1, r.endTick - r.startTick), c = r.curve;
        let m = c[0].y;
        if (u >= c[c.length - 1].x) m = c[c.length - 1].y;
        else if (u > c[0].x) { let i = 1; while (c[i].x <= u) i++; m = c[i - 1].y + (c[i].y - c[i - 1].y) * ((u - c[i - 1].x) / (c[i].x - c[i - 1].x)); }
        this.#rateIntegral += (r.perSecond * m) / TICKS_PER_SECOND;
        due = Math.floor(this.#rateIntegral + 1e-9);
      } else due = Math.floor((this.#rateEligibleTicks * r.perSecond) / TICKS_PER_SECOND);
      while (this.#rateEmitted < due) {
        const k = this.#rateEmitted;
        if (!this.#birth(n, 'rate', -1, RATE_EVENT_RANDOM_KEY, k, this.#source(n), undefined, baseVelocity)) return;
        this.#rateEmitted++;
      }
    }
  }
}

/** Pure replay from tick 0 to `tick` (0..durationTicks, <= 600). */
export function sampleParticlesAtTick(input: unknown, tick: number, options?: Partial<ParticleLimits>): ValidationResult<ParticleTickSnapshot> {
  const created = ParticleSimulation.create(input, options);
  if (!created.ok) return created;
  const sim = created.value;
  if (!isTickInt(tick, 0, sim.descriptor.durationTicks)) {
    return { ok: false, errors: [err('INVALID_VALUE', `tick must be an integer 0..${sim.descriptor.durationTicks}.`, 'tick')] };
  }
  while (sim.tick < tick) {
    const r = sim.advance();
    if (!r.ok) return r;
  }
  return { ok: true, value: sim.snapshot(), warnings: [] };
}

/** Runs a descriptor to its end and returns every birth/death/collision event (compile-time child emission). */
export function collectParticleEvents(input: unknown, options?: Partial<ParticleLimits>): ValidationResult<ParticleEvent[]> {
  const created = ParticleSimulation.create(input, options, true);
  if (!created.ok) return created;
  const sim = created.value;
  while (sim.tick < sim.descriptor.durationTicks) {
    const r = sim.advance();
    if (!r.ok) return r;
  }
  return { ok: true, value: sim.events.map(e => ({ ...e, position: cloneVec(e.position), velocity: cloneVec(e.velocity) })), warnings: [] };
}
