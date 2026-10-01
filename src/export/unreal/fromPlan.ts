// Unreal exporter, step 1: our compiled effect -> UnrealEffect (types.ts). Reads the same compiled preview plans
// the Roblox exporter reads (compileParticlePreview / compilePathPreview), so an export matches the editor as
// closely as Niagara's stock modules allow. Every approximation or drop goes into `report` (mirrors 16-PORTABILITY).
//
// Scope cut vs the Roblox exporter (documented, not silent): per-emitter KEYFRAMED values (a knob with .keys driving
// e.g. rate or speed mid-effect) are exported at their value at tick 0 and reported as approximated — Niagara has no
// direct "scale this module input over wall-clock time" track without a curve-driven user parameter per property,
// which is out of scope for this pass. Life-curves (size/color/opacity over PARTICLE life, the common case) are
// exported in full.
import type { EffectDocumentV2 } from '../../model/types.ts';
import { TICKS_PER_SECOND } from '../../model/types.ts';
import { compileParticlePreview, multiplyColors, type ParticlePreviewLayer, type PointLightLayer } from '../../graph/toParticles.ts';
import { compilePathPreview, type PathPreviewLayer } from '../../graph/toPaths.ts';
import type { ParticleEmitterDescriptor } from '../../runtime/particles.ts';
import { compileLifeCurve, compileLifeGradient, sampleLifeCurve, sampleLifeGradient } from '../../render/billboardLife.ts';
import { applyGrade, hueRotate, type ColorGrade } from '../../graph/recolor.ts';
import {
  CM_PER_METER, toUe, toUeDir,
  type UeColorKey, type UeEmitter, type UeFloatKey, type UeFlipbook, type UeLight, type UeReportItem, type UeRibbon,
  type UeSpawnShape, type UeStepTrack, type UnrealEffect, type Vec3, type Vec3Width,
} from './types.ts';

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const deg = (rad: number) => (rad * 180) / Math.PI;
const linToSrgb = (l: number) => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);
const safeName = (id: string) => id.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 60);

/** Sample times for a life curve: its own key positions, else evenly spaced 9 points (no 20-key engine cap here). */
function lifeTimes(...sources: (number[] | undefined)[]): number[] {
  const set = new Set<number>([0, 1]);
  for (const s of sources) for (const x of s ?? []) if (x >= 0 && x <= 1) set.add(r3(x));
  return [...set].sort((a, b) => a - b);
}

function colourSequences(layer: Pick<ParticlePreviewLayer, 'color' | 'opacity' | 'colorOverLife' | 'opacityOverLife' | 'grade' | 'hueShift'>, ts: number[]) {
  const grad = compileLifeGradient(layer.colorOverLife), op = compileLifeCurve(layer.opacityOverLife), out = [0, 0, 0, 0];
  const colorOverLife: UeColorKey[] = [], opacityOverLife: UeFloatKey[] = [];
  for (const t of ts) {
    sampleLifeGradient(grad, t, out);
    const life = { srgb: '', alpha: 1 } as const; // placeholder shape not used; compute sRGB directly below
    void life;
    const srgb: [number, number, number] = [linToSrgb(out[0]), linToSrgb(out[1]), linToSrgb(out[2])];
    const asColorValue = { srgb: '#' + srgb.map(c => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase(), alpha: 1 };
    const c = hueRotate(applyGrade(multiplyColors(asColorValue, layer.color), layer.grade), layer.hueShift ?? 0);
    const rgb = [1, 3, 5].map(i => parseInt(c.srgb.slice(i, i + 2), 16) / 255);
    colorOverLife.push({ t, r: r3(rgb[0]), g: r3(rgb[1]), b: r3(rgb[2]), a: 1 });
    const a = layer.opacity * layer.color.alpha * out[3] * sampleLifeCurve(op, t);
    opacityOverLife.push({ t, v: r3(Math.min(1, Math.max(0, a))) });
  }
  return { colorOverLife, opacityOverLife };
}

function flipbookOf(layer: ParticlePreviewLayer, meanLifeSeconds: number, report: UeReportItem[]): { textureFile?: string; flipbook?: UeFlipbook } {
  const sp = layer.sprite;
  if (!sp) return {};
  const { columns, rows, file } = sp.sheet;
  if (columns === 1 && rows === 1) return { textureFile: file };
  const frames = columns * rows;
  if (sp.mode === 'first') return { textureFile: file, flipbook: { columns, rows, fps: 0, loop: false, randomStartFrame: sp.sheet.kind === 'variants' || sp.variant < 0 } };
  if (sp.mode === 'overLife') { const fps = r3(frames / Math.max(0.05, meanLifeSeconds)); return { textureFile: file, flipbook: { columns, rows, fps, loop: false, randomStartFrame: sp.randomStart } }; }
  return { textureFile: file, flipbook: { columns, rows, fps: sp.fps, loop: sp.loop !== false, randomStartFrame: sp.randomStart } };
}

function rateTrack(d: ParticleEmitterDescriptor, duration: number): UeStepTrack {
  const r = d.rate;
  if (!r || r.perSecond <= 0) return [];
  const curve = r.curve;
  const out: UeStepTrack = [];
  let last = -1;
  for (let t = r.startTick; t < Math.min(r.endTick, duration); t++) {
    const u = (t - r.startTick) / Math.max(1, r.endTick - r.startTick);
    let k = 1;
    if (curve?.length) { let i = 1; while (i < curve.length - 1 && curve[i].x < u) i++; const a = curve[i - 1], b = curve[i]; k = u <= a.x ? a.y : u >= b.x ? b.y : a.y + ((b.y - a.y) * (u - a.x)) / (b.x - a.x); }
    const v = Math.round(r.perSecond * k * 10) / 10;
    if (v !== last) { out.push([t, v]); last = v; }
  }
  out.push([Math.min(r.endTick, duration), 0]);
  return out;
}

const shapeOf = (em: NonNullable<ParticleEmitterDescriptor['emission']>, report: UeReportItem[], nodeId: string): UeSpawnShape => {
  const rCm = em.radius * CM_PER_METER;
  switch (em.shape) {
    case 'sphere': return { kind: 'sphere', radiusCm: rCm };
    case 'disc': return { kind: 'disc', radiusCm: rCm };
    case 'cone': return { kind: 'cone', angleDeg: deg(em.coneAngle), radiusCm: rCm };
    case 'path': report.push({ level: 'approximated', item: nodeId, message: 'Emission along a path becomes a point emitter at the path start (Niagara point spawn).' }); return { kind: 'point' };
    default: return { kind: 'point' };
  }
};

function emitterFrom(layer: ParticlePreviewLayer, d: ParticleEmitterDescriptor, origin: readonly number[], duration: number, name: string, report: UeReportItem[]): UeEmitter {
  const relCm = (p: readonly number[]): Vec3 => toUe([p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]]);
  const em = d.emission;
  let direction: Vec3 = [0, 0, 1], speed: [number, number] = [0, 0], shape: UeSpawnShape = { kind: 'point' };
  if (em) {
    const a = em.axis, n = Math.hypot(a[0], a[1], a[2]) || 1;
    direction = toUeDir([a[0] / n, a[1] / n, a[2] / n]);
    speed = [r3(em.speed.min * CM_PER_METER), r3(em.speed.max * CM_PER_METER)];
    shape = shapeOf(em, report, layer.nodeId);
  } else if (d.initialVelocity.kind === 'vector') {
    const v = d.initialVelocity.value, n = Math.hypot(v[0], v[1], v[2]);
    if (n > 1e-9) direction = toUeDir([v[0] / n, v[1] / n, v[2] / n]);
    speed = [r3(n * CM_PER_METER), r3(n * CM_PER_METER)];
  } else speed = [r3(d.initialVelocity.speed * CM_PER_METER), r3(d.initialVelocity.speed * CM_PER_METER)];

  let acceleration: Vec3 = [0, 0, 0], drag = 0;
  let noise: UeEmitter['noise'], attract: UeEmitter['attract'], vortex: UeEmitter['vortex'], groundCollision: UeEmitter['groundCollision'];
  for (const op of d.operators) {
    if (op.kind === 'gravity') { const g = toUe(op.acceleration).map((v, i) => acceleration[i] + v) as Vec3; acceleration = g; }
    else if (op.kind === 'drag') drag += op.coefficient / Math.LN2;
    else if (op.kind === 'noise') { noise = { amplitudeCmS2: r3(op.amplitude * CM_PER_METER), frequency: r3(op.frequency) }; report.push({ level: 'info', item: layer.nodeId, message: `Turbulence exported as Niagara Curl Noise Force (amplitude ${r3(op.amplitude * CM_PER_METER)} cm/s²) — unlike Roblox this is kept, not dropped.` }); }
    else if (op.kind === 'attract') attract = { positionCm: relCm(op.center), strengthCmS2: r3(op.acceleration * CM_PER_METER) };
    else if (op.kind === 'vortex') { vortex = { positionCm: relCm(op.center), axis: toUeDir(op.axis), strengthCmS2: r3(op.tangential * CM_PER_METER) }; report.push({ level: 'approximated', item: layer.nodeId, message: 'Vortex exported as a Niagara Vortex/curl force around the given axis; spin sign kept as authored — flip the axis in Niagara if the swirl direction looks mirrored (axis-swap caveat, see the export README).' }); }
    else if (op.kind === 'ground') groundCollision = { groundZCm: 0, restitution: op.restitution, mode: op.mode === 'slide' ? 'stop' as const : op.mode === 'kill' ? 'kill' as const : 'bounce' as const };
    if ('gain' in op && op.gain?.some(g => g !== 1)) report.push({ level: 'approximated', item: layer.nodeId, message: `A force strength that changes over time (${op.kind}) is exported at full strength (Niagara curve-over-life on the force module can restore this by hand).` });
  }
  const life: [number, number] = [r3(d.lifetimeTicks.min / TICKS_PER_SECOND), r3(d.lifetimeTicks.max / TICKS_PER_SECOND)];
  const sizeCurve = compileLifeCurve(layer.sizeOverLife);
  const ts = lifeTimes(layer.sizeOverLife.keys.map(k => k.x), layer.opacityOverLife.keys.map(k => k.x), layer.colorOverLife.stops.map(s => s.position));
  const mid = ((d.size.min + d.size.max) / 2) * CM_PER_METER, env = ((d.size.max - d.size.min) / 2) * CM_PER_METER;
  const sizeOverLife: UeFloatKey[] = ts.map(t => ({ t, v: r3(mid * sampleLifeCurve(sizeCurve, t)) }));
  const { colorOverLife, opacityOverLife } = colourSequences(layer, ts);
  const velocityAligned = layer.alignment === 'velocity';
  if (layer.alignment === 'worldAxis') report.push({ level: 'info', item: layer.nodeId, message: 'World-facing flat sprites (ground rings) map to Niagara sprite renderer Alignment=CustomFacingVector / facing plane; verify orientation after import.' });
  const stretchRatio = velocityAligned ? Math.max(1, layer.stretchRatio) : 1;
  if (layer.dissolve) report.push({ level: 'dropped', item: layer.nodeId, message: 'Dissolve (burning-edge fade) has no stock Niagara sprite module; would need a custom material (out of scope this pass).' });
  if (layer.rim) report.push({ level: 'dropped', item: layer.nodeId, message: 'Sprite rim glow has no stock Niagara sprite module; would need a custom material (out of scope this pass).' });
  const spin = d.spin;
  const sourceTrack: UeEmitter['sourceTrack'] = d.sourceTrack ? (() => {
    const out: [number, Vec3][] = [];
    let prev = '';
    d.sourceTrack!.positions.forEach((p, i) => { const q = relCm(p), k = q.join(); if (k !== prev) { out.push([d.sourceTrack!.startTick + i, q]); prev = k; } });
    return out;
  })() : undefined;
  for (const t of d.animation ?? []) {
    const p = t.path.join('.');
    if (p === 'rate.perSecond') continue;
    report.push({ level: 'approximated', item: layer.nodeId, message: `The keyframed value ${p} is exported at its tick-0 value (mid-effect Niagara parameter animation is out of scope this pass).` });
  }
  // Confirmed against real UE 5.8 templates (2026-10-01 enumeration via FNiagaraStackGraphUtilities::GetStackFunctionInputs):
  // Fountain always has a SpawnRate module (continuous spawn); SimpleSpriteBurst has SpawnBurst_Instantaneous but no
  // SpawnRate; Minimal has NEITHER (InitializeParticle/ParticleState only) -- it cannot spawn anything on its own, so
  // it is only picked for an emitter with no rate and no bursts (should not occur for a real component; the plugin
  // reports it so it's never a silent empty system).
  // Many bursts (smoke/embers born where flames die: dozens of small events) become a steady stream on the Fountain
  // template (SimpleSpriteBurst holds exactly one burst): same total count spread over the bursts' time span.
  const liveBursts = d.bursts.filter(b => b.count > 0);
  const manyBursts = !d.rate && liveBursts.length > 1;
  const template: UeEmitter['suggestedTemplate'] = manyBursts ? 'Fountain' : !d.rate && liveBursts.length ? 'SimpleSpriteBurst' : (d.rate ? 'Fountain' : 'Minimal');
  let rateOverTime = rateTrack(d, duration);
  if (manyBursts) {
    const first = liveBursts[0].tick, last = liveBursts[liveBursts.length - 1].tick, span = Math.max(1, last - first + 1);
    const total = liveBursts.reduce((n, b) => n + b.count, 0);
    rateOverTime = [[first, Math.round((total / span) * 60 * 10) / 10], [Math.min(duration, last + 1), 0]];
    report.push({ level: 'approximated', item: layer.nodeId, message: `${liveBursts.length} bursts (ticks ${first}-${last}, ${total} particles) become a steady spawn rate over that span; per-event positions are not kept.` });
  }
  if (template === 'Minimal') report.push({ level: 'approximated', item: layer.nodeId, message: 'No continuous rate or burst found; the Minimal template has no spawn module, so this emitter needs a SpawnRate or Burst module added by hand in Niagara.' });
  return {
    name,
    suggestedTemplate: template,
    position: relCm(d.sourceTrack ? d.sourceTrack.positions[0] : d.sourcePosition),
    direction, shape,
    rateOverTime,
    bursts: d.bursts.filter(b => b.count > 0).map(b => ({ tick: b.tick, count: b.count, ...(b.position ? { positionCm: relCm(b.position) } : {}) })),
    lifetimeSecMin: life[0], lifetimeSecMax: life[1],
    speedCmSMin: speed[0], speedCmSMax: speed[1],
    acceleration, drag: r3(drag),
    ...(noise ? { noise } : {}), ...(attract ? { attract } : {}), ...(vortex ? { vortex } : {}), ...(groundCollision ? { groundCollision } : {}),
    sizeCmMin: r3(mid - env), sizeCmMax: r3(mid + env),
    sizeOverLife, colorOverLife, opacityOverLife,
    spinDegMin: spin ? r3(deg(spin.rotation.min)) : 0, spinDegMax: spin ? r3(deg(spin.rotation.max)) : 0,
    angularVelocityDegSMin: spin ? r3(deg(spin.angularVelocity.min)) : 0, angularVelocityDegSMax: spin ? r3(deg(spin.angularVelocity.max)) : 0,
    alignment: velocityAligned ? 'velocity' : layer.alignment === 'worldAxis' ? 'worldUpCameraFacing' : 'camera',
    stretchRatio: r3(stretchRatio),
    blend: layer.blend === 'additive' ? 'additive' : 'translucent',
    ...flipbookOf(layer, (life[0] + life[1]) / 2, report),
    loop: false,
    ...(sourceTrack ? { sourceTrack } : {}),
    attachToSource: d.attachToSource === true,
  };
}

function lightFrom(l: PointLightLayer, origin: readonly number[], duration: number, report: UeReportItem[]): UeLight {
  const relCm = (p: readonly number[]): Vec3 => toUe([p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]]);
  const curve = compileLifeCurve(l.intensityOverWindow);
  const intensity: UeStepTrack = [];
  let last = -1;
  for (let t = 0; t <= Math.min(duration, l.endTick); t++) {
    const inside = t >= l.startTick && t < l.endTick;
    // Niagara Light renderer intensity is roughly candela; keep the preview's own units (unlike Roblox's 0..5 Brightness squeeze).
    const v = inside ? Math.round(l.intensity * sampleLifeCurve(curve, (t - l.startTick) / Math.max(1, l.endTick - l.startTick)) * (1 - l.flicker / 2) * 100) / 100 : 0;
    if (v !== last) { intensity.push([t, v]); last = v; }
  }
  if (l.flicker > 0) report.push({ level: 'approximated', item: l.nodeId, message: 'Light flicker is baked as its average intensity (a Niagara Light renderer could re-add flicker via a noise-driven intensity parameter by hand).' });
  const rgb = [1, 3, 5].map(i => parseInt(l.color.srgb.slice(i, i + 2), 16) / 255) as [number, number, number];
  return {
    name: safeName(l.nodeId), color: rgb, radiusCm: r3(l.range * CM_PER_METER), positionCm: relCm(l.position), intensity,
    ...(l.track ? { sourceTrack: l.track.positions.map((p, i) => [l.track!.startTick + i, relCm(p)] as [number, Vec3]) } : {}),
  };
}

function ribbonsFrom(doc: EffectDocumentV2, origin: readonly number[], report: UeReportItem[]): UeRibbon[] {
  const layers = new Map<string, UeRibbon & { last: string }>();
  for (let tick = 0; tick < doc.durationTicks; tick++) {
    const r = compilePathPreview(doc, tick, { audioHandled: true });
    if (!r.ok) { report.push({ level: 'dropped', item: 'paths', message: `Paths failed to compile at tick ${tick}: ${r.errors[0]?.message}` }); break; }
    for (const l of r.value.layers) {
      let b = layers.get(l.nodeId);
      if (!b) { b = ribbonLayer(l, report); layers.set(l.nodeId, b); }
      const wCurve = compileLifeCurve(l.widthOverPath);
      const first = l.active ? l.paths[0] : undefined;
      const points: Vec3Width[] = first ? first.points.map((q, i, arr) => {
        const u = arr.length > 1 ? i / (arr.length - 1) : 0;
        const p = toUe([q[0] - origin[0], q[1] - origin[1], q[2] - origin[2]]);
        return [p[0], p[1], p[2], r3(l.width * first.widthScale * sampleLifeCurve(wCurve, u) * CM_PER_METER)];
      }) : [];
      const key = JSON.stringify(points);
      if (key === b.last) continue;
      b.last = key;
      b.frames.push({ tick, points });
    }
  }
  const out = [...layers.values()].map(({ last: _l, ...b }) => b);
  if (out.some(b => b.frames.length > 400)) report.push({ level: 'info', item: 'ribbons', message: 'A ribbon layer has a large number of geometry frames; Niagara has no hard limit but consider a NiagaraDataChannel driver instead of per-frame CPU data for production.' });
  return out;
}

function ribbonLayer(l: PathPreviewLayer, report: UeReportItem[]): UeRibbon & { last: string } {
  const c = hueRotate(applyGrade(l.color, l.grade as ColorGrade | undefined), l.hueShift);
  const rgb = [1, 3, 5].map(i => parseInt(c.srgb.slice(i, i + 2), 16) / 255) as [number, number, number];
  if (l.liquid > 0) report.push({ level: 'approximated', item: l.nodeId, message: 'The liquid look (clear core, lit edges) becomes a plain translucent/additive ribbon material.' });
  if (l.uvAnim && l.uvAnim.distort > 0) report.push({ level: 'dropped', item: l.nodeId, message: 'Texture distortion on ribbons has no stock Niagara ribbon module (would need a custom material).' });
  return {
    name: safeName(l.nodeId), color: { t: 0, r: r3(rgb[0]), g: r3(rgb[1]), b: r3(rgb[2]), a: r3(Math.min(1, l.opacity * l.color.alpha)) },
    blend: l.blend === 'additive' ? 'additive' : 'translucent',
    ...(l.sprite ? { textureFile: l.sprite.sheet.file } : {}),
    widthCm: r3(Math.max(0.1, l.uvTileLength * CM_PER_METER)),
    frames: [], last: '',
  };
}

/** Converts a validated document into the Unreal IR. Fails only when the effect itself does not compile. */
export function unrealEffectFrom(doc: EffectDocumentV2): { ok: true; value: UnrealEffect } | { ok: false; message: string } {
  const plan = compileParticlePreview(doc, { ribbonsHandled: true, audioHandled: true });
  if (!plan.ok) return { ok: false, message: plan.errors.map(e => e.message).join(' ') };
  const report: UeReportItem[] = [];
  const src = doc.anchors.find(a => a.id === 'source')?.position ?? [0, 0, 0];
  // The Niagara system's origin is the Source anchor itself (the caster / nozzle): in Unreal you attach the effect
  // there, and emitters that start at Source then need no spawn offset. (Niagara's ShapeLocation Offset /
  // InitializeParticle Position Offset overrides were written by the importer but had no visible effect in UE 5.8
  // captures, so offsets from Source are reported, not relied on.)
  const origin = [src[0], src[1], src[2]];
  const systems = new Map(plan.value.systems.map(s => [s.id, s.descriptor]));
  const usedBy = new Map<string, string>(), names = new Set<string>();
  const unique = (base: string) => { let n = safeName(base), i = 2; while (names.has(n)) n = `${safeName(base)}_${i++}`; names.add(n); return n; };
  const emitters: UeEmitter[] = [];
  for (const layer of plan.value.layers) {
    const d = systems.get(layer.systemId);
    if (!d) continue;
    const shared = usedBy.get(layer.systemId);
    if (shared) report.push({ level: 'approximated', item: layer.nodeId, message: `Shares its particles with ${shared} in the editor; Niagara emits its own particles for each (same timing/look, different random instances).` });
    else usedBy.set(layer.systemId, layer.nodeId);
    emitters.push(emitterFrom(layer, d, origin, plan.value.durationTicks, unique(layer.nodeId), report));
  }
  // A PathFollower over several paths makes one source per path in the editor; the export keeps the first path's route.
  for (const s of plan.value.systems) if (s.descriptor.extraSourceTracks?.length) report.push({ level: 'approximated', item: s.id, message: `Follows ${1 + s.descriptor.extraSourceTracks.length} paths in the editor; exported the first path only.` });
  if (plan.value.trails.length) report.push({ level: 'approximated', item: 'trails', message: `${plan.value.trails.length} trail layer(s) exported as velocity-stretched sprites on the parent emitter (Niagara Ribbon-per-particle trails are a heavier engine feature left for hand-tuning).` });
  if (plan.value.meshes.length) report.push({ level: 'dropped', item: 'meshes', message: `${plan.value.meshes.length} mesh-particle layer(s) are not exported; see report for manual Niagara Mesh Renderer setup (out of scope this pass — "meshes -> report item unless cheap" per spec).` });
  if (plan.value.presentation.flashes.length) report.push({ level: 'dropped', item: 'presentation', message: 'Screen flashes are not exported (add a post-process/camera-shake Blueprint on impact if needed).' });
  if (plan.value.presentation.impulses.length) report.push({ level: 'dropped', item: 'presentation', message: 'Camera shake is not exported (use a UE Camera Shake asset triggered on impact if needed).' });
  const lights = plan.value.lights.map(l => lightFrom(l, origin, plan.value.durationTicks, report));
  if (lights.length > 4) report.push({ level: 'info', item: 'lights', message: `${lights.length} lights exported as Niagara Light renderers; consider capping simultaneous lit particles for mobile/console budgets.` });
  const ribbons = ribbonsFrom(doc, origin, report);
  const textures = [...new Set([...emitters.map(e => e.textureFile), ...ribbons.map(b => b.textureFile)].filter((x): x is string => !!x))];
  report.push({ level: 'info', item: 'scale', message: `1 m = ${CM_PER_METER} cm. Axis mapping: ue.x=src.x*100, ue.y=src.z*100, ue.z=src.y*100 (our +Y up -> Unreal +Z up). The NiagaraSystem's origin is the Source anchor: place or attach the actor at the caster / nozzle.` });
  const offset = emitters.filter(e => Math.hypot(...e.position) > 5);
  if (offset.length) report.push({ level: 'approximated', item: 'positions', message: `${offset.length} emitter(s) start away from Source (${offset.map(e => e.name).join(', ')}); the importer writes their spawn offset, but in UE 5.8 it may not take effect: move those emitters' Shape Location in Niagara if they appear at the Source.` });
  return { ok: true, value: {
    name: safeName(doc.name || 'Effect'), durationTicks: plan.value.durationTicks, ticksPerSecond: 60,
    emitters, ribbons, lights, textures, report,
  } };
}
