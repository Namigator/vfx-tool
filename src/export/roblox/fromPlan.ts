// Roblox exporter, step 1: our compiled effect → RobloxEffect (types.ts). Reads the same plans the preview draws
// (compileParticlePreview + compilePathPreview per tick), so an export matches what the editor shows as closely as
// Roblox's native ParticleEmitter / Beam / PointLight allow. Every approximation or loss goes into `report`.
import type { ColorValue, CurveValue, EffectDocumentV2, GradientValue } from '../../model/types.ts';
import { TICKS_PER_SECOND } from '../../model/types.ts';
import { compileParticlePreview, multiplyColors, type ParticlePreviewLayer, type PointLightLayer } from '../../graph/toParticles.ts';
import { compilePathPreview, type PathPreviewLayer } from '../../graph/toPaths.ts';
import type { ParticleEmitterDescriptor } from '../../runtime/particles.ts';
import { compileLifeCurve, compileLifeGradient, sampleLifeCurve, sampleLifeGradient } from '../../render/billboardLife.ts';
import { applyGrade, hueRotate, type ColorGrade } from '../../graph/recolor.ts';
import { trackValue, type LayerAnimation } from '../../graph/keyframes.ts';
import {
  MAX_SEQUENCE_KEYS, STUDS_PER_METER,
  type RbxBeamLayer, type RbxColorKey, type RbxEmitter, type RbxFlipbook, type RbxLight, type RbxNumberKey, type RbxReportItem, type RbxStepTrack, type RobloxEffect, type Vec3,
} from './types.ts';

const S = STUDS_PER_METER;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r2 = (x: number) => Math.round(x * 100) / 100;
const deg = (rad: number) => (rad * 180) / Math.PI;
const hex = (c: ColorValue): [number, number, number] => [1, 3, 5].map(i => parseInt(c.srgb.slice(i, i + 2), 16) / 255) as [number, number, number];
const linToSrgb = (l: number) => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);
const toHex = (rgb: readonly number[]) => `#${rgb.map(x => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).toUpperCase().padStart(2, '0')).join('')}`;
const safeName = (id: string) => id.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 60);

/** Sample times for a life sequence: the curve's own key positions (≤20), else evenly spaced. */
function lifeTimes(...sources: (number[] | undefined)[]): number[] {
  const set = new Set<number>([0, 1]);
  for (const s of sources) for (const x of s ?? []) if (x >= 0 && x <= 1) set.add(r3(x));
  let ts = [...set].sort((a, b) => a - b);
  if (ts.length > MAX_SEQUENCE_KEYS) ts = Array.from({ length: MAX_SEQUENCE_KEYS }, (_, i) => i / (MAX_SEQUENCE_KEYS - 1));
  return ts;
}

/** Colour + transparency sequences of a billboard layer (life colour × layer colour, then part grade and colour shift). */
function colourSequences(layer: Pick<ParticlePreviewLayer, 'color' | 'opacity' | 'colorOverLife' | 'opacityOverLife' | 'grade' | 'hueShift'>, ts: number[]) {
  const grad = compileLifeGradient(layer.colorOverLife), op = compileLifeCurve(layer.opacityOverLife), out = [0, 0, 0, 0];
  const color: RbxColorKey[] = [], transparency: RbxNumberKey[] = [];
  for (const t of ts) {
    sampleLifeGradient(grad, t, out);
    const life: ColorValue = { srgb: toHex([linToSrgb(out[0]), linToSrgb(out[1]), linToSrgb(out[2])]), alpha: 1 };
    const c = hueRotate(applyGrade(multiplyColors(life, layer.color), layer.grade), layer.hueShift ?? 0);
    color.push({ t, c: hex(c).map(r3) as [number, number, number] });
    const a = layer.opacity * layer.color.alpha * out[3] * sampleLifeCurve(op, t);
    transparency.push({ t, v: r3(1 - Math.min(1, Math.max(0, a))), e: 0 });
  }
  return { color, transparency };
}

/** Layer values at `tick` with its keyframed tracks applied (opacity / emission / hueShift / colour). */
function layerAt<T extends { animation?: LayerAnimation }>(layer: T, tick: number): T {
  const a = layer.animation;
  if (!a) return layer;
  const copy = structuredClone(layer) as T & Record<string, unknown>;
  for (const t of a.numbers) {
    let o: Record<string, unknown> = copy;
    for (const k of t.path.slice(0, -1)) o = o[k as string] as Record<string, unknown>;
    o[t.path[t.path.length - 1] as string] = trackValue(t.keys, tick);
  }
  return copy;
}

const shapeOf = (s: string): Pick<RbxEmitter, 'shape' | 'shapeStyle' | 'shapeInOut'> =>
  s === 'sphere' ? { shape: 'Sphere', shapeStyle: 'Volume', shapeInOut: 'Outward' }
    : s === 'disc' ? { shape: 'Disc', shapeStyle: 'Volume', shapeInOut: 'Outward' }
      : { shape: 'Box', shapeStyle: 'Volume', shapeInOut: 'Outward' };

function flipbookOf(layer: ParticlePreviewLayer, meanLifeSeconds: number, report: RbxReportItem[]): { textureKey?: string; flipbook?: RbxFlipbook } {
  const sp = layer.sprite;
  if (!sp) return {};
  const { columns, rows, file } = sp.sheet;
  if (columns === 1 && rows === 1) return { textureKey: file };
  const layout = columns === rows && [2, 4, 8].includes(columns) ? (`Grid${columns}x${rows}` as RbxFlipbook['layout']) : undefined;
  if (!layout) { report.push({ level: 'approximated', item: layer.nodeId, message: `Sprite sheet ${file} is ${columns}×${rows}; Roblox flipbooks are 2×2, 4×4 or 8×8, so it plays as a single image.` }); return { textureKey: file }; }
  const frames = columns * rows;
  // 'first' holds one cell: a random static cell when the sheet is a variant set (variant < 0), else cell 0.
  if (sp.mode === 'first') return { textureKey: file, flipbook: { layout, mode: 'Loop', framerate: [0, 0], startRandom: sp.sheet.kind === 'variants' || sp.variant < 0 } };
  if (sp.mode === 'overLife') { const fps = r3(frames / Math.max(0.05, meanLifeSeconds)); return { textureKey: file, flipbook: { layout, mode: 'OneShot', framerate: [fps, fps], startRandom: sp.randomStart } }; }
  return { textureKey: file, flipbook: { layout, mode: sp.loop === false ? 'OneShot' : 'Loop', framerate: [sp.fps, sp.fps], startRandom: sp.randomStart } };
}

/** Rate over the effect: perSecond × window curve × keyframed perSecond, as a sparse step track. */
function rateTrack(d: ParticleEmitterDescriptor, duration: number): RbxStepTrack {
  const r = d.rate;
  if (!r || r.perSecond <= 0) return [];
  const keyed = d.animation?.find(t => t.path.length === 2 && t.path[0] === 'rate' && t.path[1] === 'perSecond');
  const curve = r.curve;
  const out: RbxStepTrack = [];
  let last = -1;
  for (let t = r.startTick; t < Math.min(r.endTick, duration); t++) {
    const u = (t - r.startTick) / Math.max(1, r.endTick - r.startTick);
    let k = 1;
    if (curve?.length) { let i = 1; while (i < curve.length - 1 && curve[i].x < u) i++; const a = curve[i - 1], b = curve[i]; k = u <= a.x ? a.y : u >= b.x ? b.y : a.y + ((b.y - a.y) * (u - a.x)) / (b.x - a.x); }
    const v = Math.round((keyed ? trackValue(keyed.keys, t) : r.perSecond) * k * 10) / 10;
    if (v !== last) { out.push([t, v]); last = v; }
  }
  out.push([Math.min(r.endTick, duration), 0]);
  return out;
}

function emitterFrom(layer: ParticlePreviewLayer, d: ParticleEmitterDescriptor, origin: Vec3, duration: number, name: string, report: RbxReportItem[]): RbxEmitter {
  const rel = (p: readonly number[]): Vec3 => [r3((p[0] - origin[0]) * S), r3((p[1] - origin[1]) * S), r3((p[2] - origin[2]) * S)];
  const em = d.emission;
  let direction: Vec3 = [0, 1, 0], speed: [number, number] = [0, 0], spread = 0, partSize: Vec3 = [0.2, 0.2, 0.2];
  if (em) {
    const a = em.axis, n = Math.hypot(a[0], a[1], a[2]) || 1;
    direction = [a[0] / n, a[1] / n, a[2] / n];
    speed = [r3(em.speed.min * S), r3(em.speed.max * S)];
    spread = em.shape === 'cone' ? deg(em.coneAngle) : em.shape === 'sphere' ? 180 : 0;
    const rr = Math.max(0.05, em.radius * S * 2);
    partSize = em.shape === 'cone' || em.shape === 'disc' ? [rr, 0.05, rr] : [rr, rr, rr];
    if (em.shape === 'disc') report.push({ level: 'approximated', item: layer.nodeId, message: 'Disc emission (outward in a plane) becomes a Roblox Disc shape emitting along its normal.' });
    if (em.shape === 'path') report.push({ level: 'approximated', item: layer.nodeId, message: 'Emission along a path becomes a point emitter at the path start.' });
  } else if (d.initialVelocity.kind === 'vector') {
    const v = d.initialVelocity.value, n = Math.hypot(v[0], v[1], v[2]);
    if (n > 1e-9) direction = [v[0] / n, v[1] / n, v[2] / n];
    speed = [r3(n * S), r3(n * S)];
  } else speed = [r3(d.initialVelocity.speed * S), r3(d.initialVelocity.speed * S)];
  let acceleration: Vec3 = [0, 0, 0], drag = 0;
  for (const op of d.operators) {
    if (op.kind === 'gravity') acceleration = [acceleration[0] + op.acceleration[0] * S, acceleration[1] + op.acceleration[1] * S, acceleration[2] + op.acceleration[2] * S];
    else if (op.kind === 'drag') drag += op.coefficient / Math.LN2;
    else if (op.kind === 'noise') report.push({ level: 'dropped', item: layer.nodeId, message: `Turbulence (noise ${op.amplitude} m/s²) has no Roblox equivalent; particles fly straighter.` });
    else if (op.kind === 'attract') report.push({ level: 'dropped', item: layer.nodeId, message: 'Attraction toward a point has no Roblox equivalent.' });
    else if (op.kind === 'vortex') report.push({ level: 'dropped', item: layer.nodeId, message: 'Vortex swirl has no Roblox equivalent.' });
    else if (op.kind === 'ground') report.push({ level: 'dropped', item: layer.nodeId, message: `Ground ${op.mode} is dropped: Roblox particles pass through the floor.` });
    if ('gain' in op && op.gain?.some(g => g !== 1)) report.push({ level: 'approximated', item: layer.nodeId, message: `A force strength that changes over time (${op.kind}) is exported at full strength.` });
  }
  const life: [number, number] = [r3(d.lifetimeTicks.min / TICKS_PER_SECOND), r3(d.lifetimeTicks.max / TICKS_PER_SECOND)];
  const sizeCurve = compileLifeCurve(layer.sizeOverLife);
  const ts = lifeTimes(layer.sizeOverLife.keys.map(k => k.x), layer.opacityOverLife.keys.map(k => k.x), layer.colorOverLife.stops.map(s => s.position));
  const mid = ((d.size.min + d.size.max) / 2) * S, env = ((d.size.max - d.size.min) / 2) * S;
  const size: RbxNumberKey[] = ts.map(t => { const k = sampleLifeCurve(sizeCurve, t); return { t, v: r3(mid * k), e: r3(env * k) }; });
  const { color, transparency } = colourSequences(layer, ts);
  const velocityAligned = layer.alignment === 'velocity';
  if (layer.alignment === 'worldAxis') report.push({ level: 'approximated', item: layer.nodeId, message: 'Flat world-facing sprites (ground rings) face the camera in Roblox.' });
  const squash = velocityAligned && layer.stretchRatio > 1.05 ? (() => { const s = r3(Math.min(3, Math.log2(layer.stretchRatio))); return [{ t: 0, v: s, e: 0 }, { t: 1, v: s, e: 0 }]; })() : undefined;
  if (squash) report.push({ level: 'approximated', item: layer.nodeId, message: `Velocity stretch ×${layer.stretchRatio} becomes Roblox Squash ${squash[0].v}.` });
  if (layer.dissolve) report.push({ level: 'dropped', item: layer.nodeId, message: 'Dissolve (burning-edge fade) is not available on Roblox particles.' });
  if (layer.rim) report.push({ level: 'dropped', item: layer.nodeId, message: 'Sprite rim glow is not available on Roblox particles.' });
  const spin = d.spin;
  const path: [number, Vec3][] | undefined = d.sourceTrack ? (() => {
    const out: [number, Vec3][] = [];
    let prev = '';
    d.sourceTrack!.positions.forEach((p, i) => { const q = rel(p), k = q.join(); if (k !== prev) { out.push([d.sourceTrack!.startTick + i, q]); prev = k; } });
    return out;
  })() : undefined;
  // Keyframed emitter fields → player tracks (scale relative to the exported value).
  const tracks: NonNullable<RbxEmitter['tracks']> = [];
  for (const t of d.animation ?? []) {
    const p = t.path.join('.'), base = t.keys[0][1] || 1;
    if (p === 'rate.perSecond') continue; // In the rate track.
    if (p === 'emission.speed.max' || p === 'initialVelocity.value.0') tracks.push({ property: 'SpeedScale', keys: t.keys.map(([k, v]) => [k, r3(v / base)]) });
    else if (p === 'size.max') tracks.push({ property: 'SizeScale', keys: t.keys.map(([k, v]) => [k, r3(v / base)]) });
    else if (p === 'lifetimeTicks.max') tracks.push({ property: 'LifetimeScale', keys: t.keys.map(([k, v]) => [k, r3(v / base)]) });
    else if (/^operators\.\d+\.coefficient$/.test(p)) tracks.push({ property: 'Drag', keys: t.keys.map(([k, v]) => [k, r3(v / Math.LN2)]) });
    else if (/^operators\.\d+\.acceleration\.1$/.test(p)) tracks.push({ property: 'AccelerationY', keys: t.keys.map(([k, v]) => [k, r3(v * S)]) });
    else if (!/^(emission\.speed\.min|size\.min|lifetimeTicks\.min|initialVelocity\.value\.[12])$/.test(p)) report.push({ level: 'dropped', item: layer.nodeId, message: `The keyframed value ${p} is not animated in Roblox (exported at its first key).` });
  }
  const keyTicks = [...new Set((layer.animation ? [...layer.animation.numbers, ...layer.animation.colors] : []).flatMap(t => t.keys.map(k => k[0])))].sort((a, b) => a - b);
  const colorFrames = keyTicks.length ? keyTicks.map(tick => ({ tick, ...colourSequences(layerAt(layer, tick), ts) })) : undefined;
  return {
    name,
    position: rel(d.sourceTrack ? d.sourceTrack.positions[0] : d.sourcePosition),
    direction: direction.map(r3) as Vec3,
    partSize: partSize.map(r3) as Vec3,
    ...shapeOf(em?.shape ?? 'point'),
    spreadAngle: [r3(spread), r3(spread)],
    speed, lifetime: life,
    acceleration: acceleration.map(r3) as Vec3,
    drag: r3(drag),
    size, transparency, color,
    ...(squash ? { squash } : {}),
    lightEmission: layer.blend === 'additive' ? 1 : 0,
    lightInfluence: 0,
    brightness: r3(1 + layer.emission),
    ...flipbookOf(layer, (life[0] + life[1]) / 2, report),
    orientation: velocityAligned ? 'VelocityParallel' : 'FacingCamera',
    rotation: spin ? [r3(deg(spin.rotation.min)), r3(deg(spin.rotation.max))] : [0, 360],
    rotSpeed: spin ? [r3(deg(spin.angularVelocity.min)), r3(deg(spin.angularVelocity.max))] : [0, 0],
    zOffset: 0,
    lockedToPart: d.attachToSource === true,
    rate: rateTrack(d, duration),
    bursts: d.bursts.filter(b => b.count > 0).map(b => ({ tick: b.tick, count: b.count, ...(b.position ? { position: rel(b.position) } : {}) })),
    ...(path ? { path } : {}),
    ...(tracks.length ? { tracks } : {}),
    ...(colorFrames ? { colorFrames } : {}),
  };
}

function lightFrom(l: PointLightLayer, origin: Vec3, duration: number, report: RbxReportItem[]): RbxLight {
  const rel = (p: readonly number[]): Vec3 => [r3((p[0] - origin[0]) * S), r3((p[1] - origin[1]) * S), r3((p[2] - origin[2]) * S)];
  const curve = compileLifeCurve(l.intensityOverWindow);
  const brightness: RbxStepTrack = [];
  let last = -1;
  for (let t = 0; t <= Math.min(duration, l.endTick); t++) {
    const inside = t >= l.startTick && t < l.endTick;
    const intensity = l.animation ? (layerAt(l, t).intensity) : l.intensity;
    // Preview intensity (candela-like, ~20 typical) → Roblox Brightness (~0..5); flicker is baked as its average.
    const v = inside ? Math.round(intensity * 0.15 * sampleLifeCurve(curve, (t - l.startTick) / Math.max(1, l.endTick - l.startTick)) * (1 - l.flicker / 2) * 20) / 20 : 0;
    if (v !== last) { brightness.push([t, v]); last = v; }
  }
  if (l.flicker > 0) report.push({ level: 'approximated', item: l.nodeId, message: 'Light flicker is baked as its average brightness.' });
  const range = l.range * S;
  if (range > 60) report.push({ level: 'approximated', item: l.nodeId, message: `Light range ${r3(range)} studs is capped at Roblox's 60.` });
  return {
    name: safeName(l.nodeId), color: hex(l.color).map(r3) as [number, number, number], range: r3(Math.min(60, range)), position: rel(l.position), brightness,
    ...(l.track ? { path: l.track.positions.map((p, i) => [l.track!.startTick + i, rel(p)] as [number, Vec3]) } : {}),
  };
}

function beamsFrom(doc: EffectDocumentV2, origin: Vec3, report: RbxReportItem[]): RbxBeamLayer[] {
  const layers = new Map<string, RbxBeamLayer & { last: string; fullFrame?: NonNullable<RbxBeamLayer['frames'][number]['paths']> }>();
  for (let tick = 0; tick < doc.durationTicks; tick++) {
    const r = compilePathPreview(doc, tick, { audioHandled: true });
    if (!r.ok) { report.push({ level: 'dropped', item: 'paths', message: `Paths failed to compile at tick ${tick}: ${r.errors[0]?.message}` }); break; }
    for (const l of r.value.layers) {
      let b = layers.get(l.nodeId);
      if (!b) { b = beamLayer(l, report); layers.set(l.nodeId, b); }
      const wCurve = compileLifeCurve(l.widthOverPath);
      const paths = (l.active ? l.paths : []).filter(p => p.points.length >= 2).map(p => {
        const n = p.points.length;
        return { alpha: r3(p.opacityScale), points: p.points.map((q, i) => {
          const u = n > 1 ? i / (n - 1) : 0, fade = l.endFade > 0 ? Math.min(1, Math.min(u, 1 - u) / l.endFade) : 1;
          return [r2((q[0] - origin[0]) * S), r2((q[1] - origin[1]) * S), r2((q[2] - origin[2]) * S), r3(l.width * p.widthScale * sampleLifeCurve(wCurve, u) * fade * S)] as [number, number, number, number];
        }) };
      });
      const key = JSON.stringify(paths);
      if (key === b.last) continue;
      b.last = key;
      // Same shape as the last full frame with proportionally scaled widths → a width-only frame.
      const full = b.fullFrame;
      if (full && full.length === paths.length && full.every((p, i) => p.alpha === paths[i].alpha && p.points.length === paths[i].points.length && p.points.every((q, k) => q[0] === paths[i].points[k][0] && q[1] === paths[i].points[k][1] && q[2] === paths[i].points[k][2]))) {
        const ratio = widthRatio({ frames: [{ tick, paths: full }] } as RbxBeamLayer, { frames: [{ tick, paths }] } as RbxBeamLayer);
        if (ratio !== undefined) { b.frames.push({ tick, widthScale: r3(ratio) }); continue; }
      }
      b.fullFrame = paths;
      b.frames.push({ tick, paths });
      b.maxSegments = Math.max(b.maxSegments, paths.reduce((n, p) => n + p.points.length - 1, 0));
          }
  }
  const out: RbxBeamLayer[] = [...layers.values()].map(({ last: _, fullFrame: __, ...b }) => b);
  for (const b of out) simplifyInTime(b);
  // Layers drawing the same paths at a constant width ratio (MergePaths passes) keep one copy of the geometry.
  // Each group points at its first member (never at a layer that itself points elsewhere).
  out.forEach((b, i) => {
    let a: RbxBeamLayer | undefined, ratio: number | undefined;
    for (const x of out.slice(0, i)) {
      if (x.sameGeometryAs || !x.frames.length || !sameGeometry(x, b)) continue;
      ratio = widthRatio(x, b);
      if (ratio !== undefined) { a = x; break; }
    }
    if (!a || ratio === undefined) return;
    b.sameGeometryAs = a.name; b.widthRatio = r3(ratio); b.frames = [];
  });
  const total = out.reduce((s, b) => s + b.maxSegments, 0);
  if (total > 1500) report.push({ level: 'info', item: 'beams', message: `Paths need up to ${total} Beam segments at once; heavy for mobile.` });
  return out;
}

type Frame = RbxBeamLayer['frames'][number];
const sameShape = (a: Frame, b: Frame) => !!a.paths && !!b.paths && a.paths.length === b.paths.length && a.paths.every((p, i) => p.points.length === b.paths![i].points.length);
/** Is `m` within tolerance of the linear blend of `a` and `b` at its tick (0.05 studs, 5 % width, 0.02 alpha)? */
function blends(a: Frame, m: Frame, b: Frame): boolean {
  if (!sameShape(a, m) || !sameShape(a, b)) return false;
  const u = (m.tick - a.tick) / (b.tick - a.tick);
  return m.paths!.every((p, i) => {
    const pa = a.paths![i], pb = b.paths![i];
    if (Math.abs(pa.alpha + (pb.alpha - pa.alpha) * u - p.alpha) > 0.02) return false;
    return p.points.every((q, k) => {
      const qa = pa.points[k], qb = pb.points[k];
      for (let c = 0; c < 3; c++) if (Math.abs(qa[c] + (qb[c] - qa[c]) * u - q[c]) > 0.05) return false;
      const w = qa[3] + (qb[3] - qa[3]) * u;
      return Math.abs(w - q[3]) <= 0.05 * Math.max(q[3], 0.02);
    });
  });
}
/**
 * Smooth motion (a growing ripple ring): drop full frames the player can rebuild by blending the kept neighbours;
 * the layer is then marked `interpolate` (the player blends consecutive frames of the same shape).
 */
function simplifyInTime(b: RbxBeamLayer): void {
  const f = b.frames;
  if (f.length < 3) return;
  const kept: Frame[] = [f[0]];
  let i = 1;
  while (i < f.length) {
    // Extend from the last kept frame as far as every skipped frame still blends.
    let j = i;
    while (j + 1 < f.length && f.slice(i, j + 1).every(m => blends(kept[kept.length - 1], m, f[j + 1]))) j++;
    if (j > i) { kept.push(f[j]); i = j + 1; } else { kept.push(f[i]); i++; }
  }
  if (kept.length < f.length) { b.frames = kept; b.interpolate = true; }
}

const sameGeometry = (a: RbxBeamLayer, b: RbxBeamLayer) => a.frames.length === b.frames.length && a.frames.every((f, i) => {
  const g = b.frames[i];
  if (!f.paths || !g.paths) return f.tick === g.tick && !f.paths && !g.paths && f.widthScale === g.widthScale;
  return f.tick === g.tick && f.paths.length === g.paths.length && f.paths.every((p, j) => p.alpha === g.paths![j].alpha && p.points.length === g.paths![j].points.length && p.points.every((q, k) => q[0] === g.paths![j].points[k][0] && q[1] === g.paths![j].points[k][1] && q[2] === g.paths![j].points[k][2]));
});
/** b's widths / a's widths when that ratio is the same (±1%) for every point, else undefined. */
function widthRatio(a: RbxBeamLayer, b: RbxBeamLayer): number | undefined {
  let ratio: number | undefined;
  for (let i = 0; i < a.frames.length; i++) {
    const pa = a.frames[i].paths, pb = b.frames[i].paths;
    if (!pa || !pb) continue;
    for (let j = 0; j < pa.length; j++) for (let k = 0; k < pa[j].points.length; k++) {
    const wa = pa[j].points[k][3], wb = pb[j].points[k][3];
    if (wa < 1e-3 && wb < 1e-3) continue;
    if (wa < 1e-3) return undefined;
    ratio ??= wb / wa;
    if (Math.abs(wb / wa - ratio) > 0.01 * ratio + 2e-3 / wa) return undefined;
    }
  }
  return ratio ?? 1;
}

function beamLayer(l: PathPreviewLayer, report: RbxReportItem[]): RbxBeamLayer & { last: string } {
  const c = hueRotate(applyGrade(l.color, l.grade as ColorGrade | undefined), l.hueShift);
  if (l.liquid > 0) report.push({ level: 'approximated', item: l.nodeId, message: 'The liquid look (clear core, lit edges) becomes a plain translucent Beam.' });
  if (l.uvAnim && l.uvAnim.distort > 0) report.push({ level: 'dropped', item: l.nodeId, message: 'Texture distortion on ribbons is not available on Roblox Beams.' });
  return {
    name: safeName(l.nodeId), color: hex(c).map(r3) as [number, number, number], transparency: r3(1 - Math.min(1, l.opacity * l.color.alpha)),
    lightEmission: l.blend === 'additive' ? 1 : 0, brightness: r3(1 + l.emission),
    ...(l.sprite ? { textureKey: l.sprite.sheet.file } : {}),
    textureMode: l.uvMode === 'tile' ? 'Wrap' : 'Stretch', textureLength: r3(Math.max(0.1, l.uvTileLength * S)), textureSpeed: r3(l.uvAnim?.scroll[0] ?? 0),
    zOffset: 0, frames: [], maxSegments: 0, last: '',
  };
}

/** Converts a validated document into the Roblox IR. Fails only when the effect itself does not compile. */
export function robloxEffectFrom(doc: EffectDocumentV2): { ok: true; value: RobloxEffect } | { ok: false; message: string } {
  const plan = compileParticlePreview(doc, { ribbonsHandled: true, audioHandled: true });
  if (!plan.ok) return { ok: false, message: plan.errors.map(e => e.message).join(' ') };
  const report: RbxReportItem[] = [];
  const src = doc.anchors.find(a => a.id === 'source')?.position ?? [0, 0, 0];
  const origin: Vec3 = [src[0], 0, src[2]]; // Source anchor over the floor: Roblox origin = where the effect stands.
  const systems = new Map(plan.value.systems.map(s => [s.id, s.descriptor]));
  const usedBy = new Map<string, string>(), names = new Set<string>();
  const unique = (base: string) => { let n = safeName(base), i = 2; while (names.has(n)) n = `${safeName(base)}_${i++}`; names.add(n); return n; };
  const emitters: RbxEmitter[] = [];
  for (const layer of plan.value.layers) {
    const d = systems.get(layer.systemId);
    if (!d) continue;
    const shared = usedBy.get(layer.systemId);
    if (shared) report.push({ level: 'approximated', item: layer.nodeId, message: `Shares its particles with ${shared} in the editor; in Roblox it emits its own (same timing and look, different random particles).` });
    else usedBy.set(layer.systemId, layer.nodeId);
    emitters.push(emitterFrom(layer, d, origin, plan.value.durationTicks, unique(layer.nodeId), report));
  }
  for (const t of plan.value.trails) report.push({ level: 'dropped', item: t.nodeId, message: 'Per-particle trails are not exported yet (Roblox Trails need one attachment pair per particle).' });
  for (const m of plan.value.meshes) report.push({ level: 'dropped', item: m.nodeId, message: `Mesh particles (${m.meshAsset ? 'imported model' : m.mesh}) are not exported yet.` });
  if (plan.value.presentation.flashes.length) report.push({ level: 'dropped', item: 'presentation', message: 'Screen flashes are not exported (a client-side ScreenGui flash can be added later).' });
  if (plan.value.presentation.impulses.length) report.push({ level: 'dropped', item: 'presentation', message: 'Camera shake is not exported.' });
  const lights = plan.value.lights.map(l => lightFrom(l, origin, plan.value.durationTicks, report));
  const beams = beamsFrom(doc, origin, report);
  report.push({ level: 'info', item: 'scale', message: `1 m = ${r3(S)} studs; the effect origin (model pivot) is the floor point under the Source anchor, so the effect starts ${r3(src[1] * S)} studs above it. Target positions are baked (moving the target in Roblox does not re-aim the effect).` });
  const textures = [...new Set([...emitters.map(e => e.textureKey), ...beams.map(b => b.textureKey)].filter((x): x is string => !!x))];
  const rel = (p: readonly number[]): Vec3 => [r3((p[0] - origin[0]) * S), r3((p[1] - origin[1]) * S), r3((p[2] - origin[2]) * S)];
  const tgt = doc.anchors.find(a => a.id === 'target')?.position ?? src;
  const flight = [...plan.value.followers].sort((a, b) => b.travelTicks - a.travelTicks)[0];
  report.push({ level: 'info', item: 'targeting', message: 'Aim it in Roblox with EffectPlayer.play(model, nil, { source = casterPosition, target = hitPosition, speed = studsPerSecond }): the effect stretches from the caster to the target and the flight is retimed to that speed.' });
  return { ok: true, value: {
    name: safeName(doc.name || 'Effect'), durationTicks: plan.value.durationTicks, studsPerMeter: r3(S), emitters, beams, lights,
    anchors: { source: rel(src), target: rel(tgt) },
    ...(flight ? { travel: { startTick: flight.startTick, travelTicks: flight.travelTicks } } : {}),
    textures, report,
  } };
}

export type { GradientValue, CurveValue };
