// Roblox exporter: mesh particles (rocks, crystals, shards, orbs...) -> Roblox Parts driven by baked trajectories.
// The preview's per-instance transform (PreviewViewport #updateMeshes) is reproduced here on top of the deterministic
// ParticleSimulation, sampled every 2 ticks plus birth and death; the Luau player blends between those frames.
// Roblox has no custom mesh in a plain model, so every kind is approximated by a primitive Part (see KINDS).
import type { ColorValue } from '../../model/types.ts';
import { multiplyColors, type MeshLayer } from '../../graph/toParticles.ts';
import { colorTrackValue, trackValue } from '../../graph/keyframes.ts';
import { ParticleSimulation, PARTICLE_DT, type ParticleEmitterDescriptor, type ParticleState } from '../../runtime/particles.ts';
import { fnv1a32Utf8 } from '../../runtime/random.ts';
import { compileLifeCurve, compileLifeGradient, lifeFraction, sampleLifeCurve, sampleLifeGradient } from '../../render/billboardLife.ts';
import { STUDS_PER_METER, type RbxMeshFrame, type RbxMeshLayer, type RbxMeshPiece, type RbxReportItem, type Vec3 } from './types.ts';

const S = STUDS_PER_METER;
/** Most Parts one export may animate (each is a real Part in the game). */
export const MAX_MESH_PIECES = 300;
/** Frame spacing in ticks (birth and death frames are always kept). */
const FRAME_STEP = 2;

type Q = [number, number, number, number]; // x y z w
type Shape = RbxMeshLayer['shape'];
/**
 * Per mesh kind: the Roblox primitive, and the extents of the built-in geometry at scale 1 (x, y, z, in units of the
 * particle size) so the Part matches the preview's proportions.
 * - rock-a/b/c: Block (a block circumscribes the rock, so 0.85 of the extents), each piece gets its own irregular ratios.
 * - orb: Ball (Roblox balls stay round, so a stretched orb is a round ball of the width).
 * - cylinder: Cylinder (its length axis is turned onto our up axis).
 * - cone, crystal, crystal-b, shard: Wedge (a sloped block with a pointed top edge; the closest pointed primitive).
 * - box / plane: Block (plane is a thin slab).
 * - imported GLB: a 1 m Block (fitted size).
 */
const KINDS: Record<string, { shape: Shape; ext: Vec3; irregular?: boolean }> = {
  'rock-a': { shape: 'Block', ext: [0.85, 0.64, 0.77], irregular: true },
  'rock-b': { shape: 'Block', ext: [0.94, 0.6, 0.72], irregular: true },
  'rock-c': { shape: 'Block', ext: [0.77, 0.68, 0.94], irregular: true },
  orb: { shape: 'Ball', ext: [1, 1, 1] },
  cylinder: { shape: 'Cylinder', ext: [1, 1, 1] },
  cone: { shape: 'Wedge', ext: [0.7, 1, 0.7] },
  crystal: { shape: 'Wedge', ext: [0.6, 1, 0.5] },
  'crystal-b': { shape: 'Wedge', ext: [0.6, 1, 0.48] },
  shard: { shape: 'Wedge', ext: [0.45, 1.3, 0.35] },
  box: { shape: 'Block', ext: [1, 1, 1] },
  plane: { shape: 'Block', ext: [1, 0.03, 1] },
};
const IMPORTED = { shape: 'Block' as Shape, ext: [1, 1, 1] as Vec3 };

// ---------- quaternion helpers (same conventions as three.js, right-handed, +Y up) ----------

const qMul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qAxisAngle = (x: number, y: number, z: number, angle: number): Q => { const s = Math.sin(angle / 2); return [x * s, y * s, z * s, Math.cos(angle / 2)]; };
/** Rotation taking +Y onto the direction v (unit); three.js setFromUnitVectors(up, v). */
function qFromUp(v: Vec3): Q {
  const r = v[1] + 1;
  const q: Q = r < 1e-6 ? [0, 0, 1, 0] : [v[2], 0, -v[0], r];
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
/** Rotation taking +Y onto an arbitrary (non-unit) direction. */
const qFromUpTo = (x: number, y: number, z: number): Q => { const n = Math.hypot(x, y, z) || 1; return qFromUp([x / n, y / n, z / n]); };
const rotate = (q: Q, v: Vec3): Vec3 => {
  // v' = v + 2w(u x v) + 2 u x (u x v)
  const [x, y, z, w] = q;
  const cx = y * v[2] - z * v[1], cy = z * v[0] - x * v[2], cz = x * v[1] - y * v[0];
  return [v[0] + 2 * (w * cx + y * cz - z * cy), v[1] + 2 * (w * cy + z * cx - x * cz), v[2] + 2 * (w * cz + x * cy - y * cx)];
};
/** A Roblox Cylinder's length runs along its local X: turn X onto our Y (rotation +90 degrees about Z). */
const CYLINDER_TURN: Q = [0, 0, Math.SQRT1_2, Math.SQRT1_2];

// ---------- colour ----------

const linToSrgb = (l: number) => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);
const toHex = (rgb: readonly number[]) => `#${rgb.map(x => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).toUpperCase().padStart(2, '0')).join('')}`;
const hex = (c: ColorValue): [number, number, number] => [1, 3, 5].map(i => parseInt(c.srgb.slice(i, i + 2), 16) / 255) as [number, number, number];

/** Layer with its keyframed knobs at `tick` (numbers by path, colours by path). */
function layerAt(layer: MeshLayer, tick: number): MeshLayer {
  const a = layer.animation;
  if (!a) return layer;
  const copy = structuredClone(layer) as MeshLayer & Record<string, unknown>;
  const put = (path: (string | number)[], value: unknown) => {
    let o: Record<string, unknown> = copy;
    for (const k of path.slice(0, -1)) { o = o?.[k as string] as Record<string, unknown>; if (!o) return; }
    o[path[path.length - 1] as string] = value;
  };
  for (const t of a.numbers) put(t.path, trackValue(t.keys, tick));
  for (const t of a.colors) put(t.path, colorTrackValue(t.keys, tick));
  return copy;
}

/** Same average-of-the-curve spin speed the preview uses (PreviewViewport spinAverage): 8 trapezoids over [0,u]. */
function spinAverager(layer: MeshLayer): (u: number) => number {
  if (!layer.spinOverLife) return () => 1;
  const s = compileLifeCurve(layer.spinOverLife);
  return u => {
    if (u <= 1e-6) return sampleLifeCurve(s, 0);
    let acc = 0;
    for (let i = 0; i < 8; i++) acc += (sampleLifeCurve(s, (u * i) / 8) + sampleLifeCurve(s, (u * (i + 1)) / 8)) / 2;
    return acc / 8;
  };
}

function materialOf(m: MeshLayer): RbxMeshLayer['material'] {
  const rough = m.roughness, metal = m.metalness ?? 0;
  if (!m.lit || m.blend === 'additive' || m.emission > 0.5) return 'Neon';
  if (m.mesh === 'crystal' || m.mesh === 'crystal-b' || m.mesh === 'shard' || (rough !== undefined && rough < 0.3 && metal < 0.5)) return 'Ice';
  if (metal > 0.6) return 'Metal';
  if (m.mesh.startsWith('rock') || (rough !== undefined && rough >= 0.6)) return 'Slate';
  return 'SmoothPlastic';
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Is `m` (between a and b in time) within tolerance of the blend the player will make from a to b? */
function blendsTo(a: RbxMeshFrame, m: RbxMeshFrame, b: RbxMeshFrame): boolean {
  const f = (m.tick - a.tick) / (b.tick - a.tick);
  for (let i = 0; i < 3; i++) {
    if (Math.abs(a.pos[i] + (b.pos[i] - a.pos[i]) * f - m.pos[i]) > 0.06) return false;
    if (Math.abs(a.size[i] + (b.size[i] - a.size[i]) * f - m.size[i]) > 0.05 + 0.03 * m.size[i]) return false;
    if (Math.abs(a.color![i] + (b.color![i] - a.color![i]) * f - m.color![i]) > 0.012) return false;
  }
  if (Math.abs(a.transparency! + (b.transparency! - a.transparency!) * f - m.transparency!) > 0.02) return false;
  // Rotation: the halfway blend (normalized lerp) must be within ~1.6 degrees of the baked rotation.
  const sign = a.rot[0] * b.rot[0] + a.rot[1] * b.rot[1] + a.rot[2] * b.rot[2] + a.rot[3] * b.rot[3] < 0 ? -1 : 1;
  const q = a.rot.map((x, i) => x + (sign * b.rot[i] - x) * f);
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return Math.abs(q[0] * m.rot[0] / n + q[1] * m.rot[1] / n + q[2] * m.rot[2] / n + q[3] * m.rot[3] / n) > 0.9999;
}
/** Smooth motion needs fewer frames: drop those the player's blend of the kept neighbours reproduces. */
function thin(frames: RbxMeshFrame[]): RbxMeshFrame[] {
  if (frames.length < 3) return frames;
  const kept = [frames[0]];
  let i = 1;
  while (i < frames.length) {
    let j = i; // candidate end frame; grow while every skipped frame still blends
    while (j + 1 < frames.length && frames.slice(i, j + 1).every(m => blendsTo(kept[kept.length - 1], m, frames[j + 1]))) j++;
    kept.push(frames[j]);
    i = j + 1;
  }
  return kept;
}

type Snapshots = ParticleState[][]; // index = tick

/** Runs the descriptor with the runtime (as the preview does) and keeps every tick's live particles. */
function simulate(d: ParticleEmitterDescriptor, duration: number): Snapshots | { error: string } {
  const created = ParticleSimulation.create(d);
  if (!created.ok) return { error: created.errors[0]?.message ?? 'invalid particle descriptor' };
  const sim = created.value, out: Snapshots = [sim.snapshot().particles];
  while (sim.tick < duration) {
    const r = sim.step();
    if (!r.ok) return { error: r.errors[0]?.message ?? 'particle simulation failed' };
    out.push(sim.tick < duration ? sim.snapshot().particles : []);
  }
  return out;
}

export function bakeMeshes(
  meshes: readonly MeshLayer[], systems: ReadonlyMap<string, ParticleEmitterDescriptor>, origin: Vec3, duration: number,
  nameOf: (base: string) => string, report: RbxReportItem[],
): RbxMeshLayer[] {
  const snaps = new Map<string, Snapshots>();
  const out: RbxMeshLayer[] = [];
  const rel = (p: readonly number[]): Vec3 => [(p[0] - origin[0]) * S, (p[1] - origin[1]) * S, (p[2] - origin[2]) * S];
  for (const layer of meshes) {
    const d = systems.get(layer.systemId);
    if (!d) continue;
    let sn = snaps.get(layer.systemId);
    if (!sn) {
      const r = simulate(d, Math.min(duration, d.durationTicks));
      if ('error' in r) { report.push({ level: 'dropped', item: layer.nodeId, message: `Mesh particles could not be simulated for export: ${r.error}` }); continue; }
      sn = r; snaps.set(layer.systemId, r);
    }
    const kind = layer.meshAsset ? IMPORTED : KINDS[layer.mesh] ?? IMPORTED;
    if (layer.meshAsset) report.push({ level: 'approximated', item: layer.nodeId, message: 'Imported 3D models become a plain Roblox block of the same size (custom mesh shapes are not exported).' });
    else report.push({ level: 'approximated', item: layer.nodeId, message: 'Rocks, crystals and other meshes become simple Roblox parts moved along the previewed paths; no custom mesh shape.' });
    if (kind.shape === 'Ball' && (layer.scaleY ?? 1) !== 1) report.push({ level: 'approximated', item: layer.nodeId, message: 'Stretched orbs stay round: a Roblox ball cannot be squashed.' });
    if (layer.surface && (layer.surface.reflection > 0 || layer.surface.detail > 0)) report.push({ level: 'dropped', item: layer.nodeId, message: 'Mesh surface reflection and grain detail are not exported.' });
    if (layer.rim && layer.rim.strength > 0) report.push({ level: 'dropped', item: layer.nodeId, message: 'Mesh rim glow is not exported.' });
    if (layer.refraction) report.push({ level: 'dropped', item: layer.nodeId, message: 'Mesh refraction is not exported.' });

    const sizeCurve = compileLifeCurve(layer.sizeOverLife), spin = spinAverager(layer);
    const cache = new Map<number, { layer: MeshLayer; grad: ReturnType<typeof compileLifeGradient> }>();
    const gradAt = (tick: number) => {
      const key = layer.animation ? tick : 0;
      let c = cache.get(key);
      if (!c) { const l = layerAt(layer, tick); c = { layer: l, grad: compileLifeGradient(l.colorOverLife) }; cache.set(key, c); }
      return c;
    };
    const rgba = [0, 0, 0, 0];
    const variation = layer.surface?.variation ?? 0;

    const frameOf = (pt: ParticleState, tick: number, alpha: number): RbxMeshFrame => {
      const L = layer.animation ? gradAt(tick).layer : layer, grad = gradAt(tick).grad;
      const u = lifeFraction(pt.ageTicks, pt.lifetimeTicks, alpha), h = fnv1a32Utf8(pt.parentRandomKey), step = alpha * PARTICLE_DT;
      const p: Vec3 = [pt.position[0] + pt.velocity[0] * step, pt.position[1] + pt.velocity[1] * step, pt.position[2] + pt.velocity[2] * step];
      let q: Q;
      if (layer.orientation === 'fixed') { const dv = layer.direction ?? [0, 1, 0]; q = qFromUpTo(dv[0], dv[1], dv[2]); }
      else if (layer.orientation === 'upright') {
        const yaw = (h & 1023) / 1023 * Math.PI * 2, lean = ((h >>> 10) & 1023) / 1023 * (layer.tilt ?? 0.2), dir = ((h >>> 20) & 1023) / 1023 * Math.PI * 2;
        q = qMul(qAxisAngle(Math.cos(dir), 0, Math.sin(dir), lean), qAxisAngle(0, 1, 0, yaw));
      } else if (layer.orientation === 'velocity' && Math.hypot(pt.velocity[0], pt.velocity[1], pt.velocity[2]) > 1e-6) q = qFromUpTo(pt.velocity[0], pt.velocity[1], pt.velocity[2]);
      else {
        const a = (h & 1023) / 1023 * Math.PI * 2, b = ((h >>> 10) & 1023) / 1023 * 2 - 1, r = Math.sqrt(1 - b * b);
        const angle = (pt.rotation ?? (h >>> 20) / 4096 * Math.PI * 2) + (pt.angularVelocity ?? 0) * (pt.ageTicks + alpha) * PARTICLE_DT * spin(u);
        q = qAxisAngle(r * Math.cos(a), b, r * Math.sin(a), angle);
      }
      const k = pt.size * layer.scale * sampleLifeCurve(sizeCurve, u);
      const ky = k * (layer.scaleY ?? 1);
      // The preview size box (k, ky, k) times the kind's extents; rocks get a stable irregular ratio per piece.
      let ex = kind.ext[0], ey = kind.ext[1], ez = kind.ext[2];
      if ('irregular' in kind && kind.irregular) { ex *= 0.85 + 0.3 * (((h >>> 3) & 255) / 255); ey *= 0.85 + 0.3 * (((h >>> 11) & 255) / 255); ez *= 0.85 + 0.3 * (((h >>> 19) & 255) / 255); }
      let size: Vec3 = [k * ex, ky * ey, k * ez];
      // Base pivot: the mesh stands on its position, so the Part (centred) sits half a height up its own up axis.
      const up = rotate(q, [0, 1, 0]);
      const centre: Vec3 = layer.pivot === 'base' ? [p[0] + up[0] * size[1] / 2, p[1] + up[1] * size[1] / 2, p[2] + up[2] * size[1] / 2] : p;
      let rot = q;
      if (kind.shape === 'Cylinder') { rot = qMul(q, CYLINDER_TURN); size = [size[1], size[0], size[2]]; }
      else if (kind.shape === 'Ball') { const d = Math.max(size[0], size[2]); size = [d, d, d]; }
      if (rot[3] < 0) rot = [-rot[0], -rot[1], -rot[2], -rot[3]];
      sampleLifeGradient(grad, u, rgba);
      const life: ColorValue = { srgb: toHex([linToSrgb(rgba[0]), linToSrgb(rgba[1]), linToSrgb(rgba[2])]), alpha: 1 };
      const c = hex(multiplyColors(life, L.color));
      if (variation > 0) {
        const shade = 1 + variation * 0.4 * ((((h >>> 3) & 255) / 255) * 2 - 1), hue = variation * 0.12 * ((((h >>> 11) & 255) / 255) * 2 - 1);
        c[0] *= shade * (1 + hue); c[1] *= shade; c[2] *= shade * (1 - hue);
      }
      const a = L.opacity * L.color.alpha * rgba[3];
      const c2 = rel(centre);
      return {
        tick: tick + alpha, pos: [r2(c2[0]), r2(c2[1]), r2(c2[2])], rot: [r3(rot[0]), r3(rot[1]), r3(rot[2]), r3(rot[3])],
        size: [r2(size[0] * S), r2(size[1] * S), r2(size[2] * S)],
        color: c.map(x => r3(Math.min(1, Math.max(0, x)))) as [number, number, number], transparency: r2(1 - Math.min(1, Math.max(0, a))),
      };
    };

    // Follow each particle across ticks, then keep every FRAME_STEP-th frame plus the death frame.
    const live = new Map<string, { birth: number; frames: RbxMeshFrame[]; last: ParticleState; lastTick: number }>();
    const pieces: RbxMeshPiece[] = [];
    const close = (id: string) => {
      const e = live.get(id)!;
      live.delete(id);
      const death = e.lastTick + 1;
      const frames = e.frames;
      frames.push(frameOf(e.last, e.lastTick, 1));
      if (frames.length >= 2) pieces.push({ birthTick: e.birth, deathTick: death, frames: thin(frames) });
    };
    for (let tick = 0; tick < sn.length; tick++) {
      const seen = new Set<string>();
      for (const pt of sn[tick]) {
        seen.add(pt.id);
        let e = live.get(pt.id);
        if (!e) { e = { birth: tick, frames: [], last: pt, lastTick: tick }; live.set(pt.id, e); }
        e.last = pt; e.lastTick = tick;
        if ((tick - e.birth) % FRAME_STEP === 0) e.frames.push(frameOf(pt, tick, 0));
      }
      for (const id of [...live.keys()]) if (!seen.has(id)) close(id);
    }
    for (const id of [...live.keys()]) close(id);
    pieces.sort((a, b) => a.birthTick - b.birthTick);
    if (!pieces.length) continue;

    const first = pieces[0].frames[0];
    const differs = pieces.some(pc => pc.frames.some(f =>
      Math.abs(f.transparency! - first.transparency!) > 0.01 || f.color!.some((x, i) => Math.abs(x - first.color![i]) > 1 / 255)));
    out.push({
      name: nameOf(layer.nodeId), shape: kind.shape, material: materialOf(layer), source: layer.meshAsset ? 'imported model' : layer.mesh,
      color: first.color!, transparency: first.transparency!, reflectance: r3(Math.min(1, Math.max(0, layer.metalness ?? 0)) * 0.5),
      castShadow: layer.lit, colorVaries: differs, pieces,
    });
  }
  // Cap: keep an even spread of pieces per layer (each Part is a real instance in the game).
  const total = out.reduce((n, l) => n + l.pieces.length, 0);
  if (total > MAX_MESH_PIECES) {
    const ratio = MAX_MESH_PIECES / total;
    for (const l of out) {
      const keep = Math.max(1, Math.floor(l.pieces.length * ratio));
      l.pieces = Array.from({ length: keep }, (_, i) => l.pieces[Math.floor((i * l.pieces.length) / keep)]);
    }
    report.push({ level: 'approximated', item: 'meshes', message: `The effect has ${total} mesh pieces; only ${out.reduce((n, l) => n + l.pieces.length, 0)} (an even sample) are exported to keep Roblox fast (limit ${MAX_MESH_PIECES}).` });
  } else if (total > 0) report.push({ level: 'info', item: 'meshes', message: `${total} mesh pieces are animated as Parts (limit ${MAX_MESH_PIECES}).` });
  return out;
}
