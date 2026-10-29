// Unity export: the engine-neutral IR (src/export/unreal/fromPlan.ts, also behind the Godot export) converted to
// Unity units and axes (types.ts header): Unreal cm, (x, y=our z, z=our y) -> Unity m, (x, y, -z).
import type { UeColorKey, UeEmitter, UeFloatKey, UeLight, UeParticleTrail, UeRibbon, UnrealEffect, Vec3Width } from '../unreal/types.ts';
import type { UnityEffect, UnityEmitter, UnityLight, UnityReportItem, UnityRibbon } from './types.ts';

const r4 = (x: number) => Math.round(x * 10000) / 10000;
/** Unreal cm (x, our z, our y) -> Unity m (x, y, -z). */
const pos = (p: readonly number[]): number[] => [r4(p[0] / 100), r4(p[2] / 100), r4(-p[1] / 100)];
const dir = (p: readonly number[]): number[] => { const v = [p[0], p[2], -p[1]], l = Math.hypot(v[0], v[1], v[2]) || 1; return v.map(x => r4(x / l)); };
/** Preview light intensity (Three.js, ~candela at metre scale) -> Unity built-in Light.intensity (0..8 typical), and the
 *  range stretch: Unity's built-in falloff reaches zero at the range, three's decays smoothly past it. Measured on the
 *  feature grid light row (pool brightness x1.08, lit area x0.96 vs the editor; 0.1 / x1 gave x0.46 / x0.28), 2026-10-29. */
export const UNITY_LIGHT_SCALE = 0.15;
export const UNITY_LIGHT_RANGE = 1.3;

function emitterFrom(e: UeEmitter, report: UnityReportItem[]): UnityEmitter {
  const s = e.shape, mid = Math.max(1e-6, (e.sizeCmMin + e.sizeCmMax) / 2);
  const bursts = e.bursts.filter(b => b.count > 0);
  const flat = (keys: UeFloatKey[], f: (v: number) => number) => ({ t: keys.map(k => r4(k.t)), v: keys.map(k => r4(f(k.v))) });
  const size = flat(e.sizeOverLife, v => v / mid), alpha = flat(e.opacityOverLife, v => v);
  const colors: UeColorKey[] = e.colorOverLife;
  if (e.vortex) report.push({ level: 'approximated', item: e.name, message: 'Vortex swirl becomes a Unity Particle System Force Field (rotation speed); its turning direction may be mirrored by the Z flip - flip the sign by hand if it spins the wrong way.' });
  if (e.noise) report.push({ level: 'approximated', item: e.name, message: 'Curl noise becomes the Noise module (strength matched roughly; check the look).' });
  if (e.attract) report.push({ level: 'approximated', item: e.name, message: 'Attraction becomes a Particle System Force Field (gravity); particles are not killed on arrival unless the kill radius is set.' });
  // Flat quads: Unity's Horizontal Billboard lies on the ground; other facing axes have no billboard mode.
  const flatQuad = !!e.facingAxis && Math.abs(e.facingAxis[2]) > 0.9;
  if (e.facingAxis && !flatQuad) report.push({ level: 'approximated', item: e.name, message: 'A flat quad facing a sideways axis is drawn facing the camera (Unity billboards lie flat only on the ground).' });
  if (e.groundCollision) report.push({ level: 'approximated', item: e.name, message: 'Ground collision becomes the Collision module against a world plane at the floor height.' });
  return {
    name: e.name, position: pos(e.position), direction: dir(e.direction),
    shape: s.kind === 'cylinder' ? 'sphere' : s.kind,
    radius: r4(('radiusCm' in s ? s.radiusCm : 0) / 100), angleDeg: s.kind === 'cone' ? r4(s.angleDeg) : 0,
    boxSize: s.kind === 'box' ? pos(s.extentsCm).map(v => r4(Math.abs(v) * 2)) : [0, 0, 0],
    rateTicks: e.rateOverTime.map(([t]) => t), rateValues: e.rateOverTime.map(([, v]) => r4(v)),
    burstTicks: bursts.map(b => b.tick), burstCounts: bursts.map(b => b.count),
    burstHasPosition: bursts.map(b => (b.positionCm ? 1 : 0)), burstPositions: bursts.flatMap(b => (b.positionCm ? pos(b.positionCm) : [0, 0, 0])),
    lifetimeMin: r4(e.lifetimeSecMin), lifetimeMax: r4(e.lifetimeSecMax), speedMin: r4(e.speedCmSMin / 100), speedMax: r4(e.speedCmSMax / 100),
    acceleration: pos(e.acceleration), drag: r4(e.drag),
    hasNoise: !!e.noise, noiseAmplitude: r4((e.noise?.amplitudeCmS2 ?? 0) / 100), noiseFrequency: r4(e.noise?.frequency ?? 0),
    hasAttract: !!e.attract, attractPosition: e.attract ? pos(e.attract.positionCm) : [0, 0, 0], attractStrength: r4((e.attract?.strengthCmS2 ?? 0) / 100),
    attractKillRadius: r4((e.attract?.killRadiusCm ?? 0) / 100),
    hasVortex: !!e.vortex, vortexPosition: e.vortex ? pos(e.vortex.positionCm) : [0, 0, 0], vortexAxis: e.vortex ? dir(e.vortex.axis) : [0, 1, 0],
    vortexStrength: r4((e.vortex?.strengthCmS2 ?? 0) / 100), vortexInward: r4((e.vortex?.inwardCmS2 ?? 0) / 100),
    hasCollision: !!e.groundCollision, groundY: r4((e.groundCollision?.groundZCm ?? 0) / 100), restitution: r4(e.groundCollision?.restitution ?? 0),
    collisionMode: e.groundCollision?.mode ?? '',
    sizeMin: r4(e.sizeCmMin / 100), sizeMax: r4(e.sizeCmMax / 100), sizeKeysT: size.t, sizeKeysV: size.v,
    colorKeysT: colors.map(k => r4(k.t)), colorKeysRgb: colors.flatMap(k => [r4(k.r), r4(k.g), r4(k.b)]),
    alphaKeysT: alpha.t, alphaKeysV: alpha.v,
    spinMinDeg: r4(e.spinDegMin), spinMaxDeg: r4(e.spinDegMax), angularVelocityMinDeg: r4(e.angularVelocityDegSMin), angularVelocityMaxDeg: r4(e.angularVelocityDegSMax),
    alignment: flatQuad ? 'flat' : e.facingAxis ? 'camera' : e.alignment === 'worldUpCameraFacing' ? 'worldUp' : e.alignment, stretchRatio: r4(e.stretchRatio), blend: e.blend, emission: r4(e.emission ?? 0),
    texture: e.textureFile ?? '',
    // Variants sheets (soft-glow: dot, ring, ...) are one static cell per particle, never animated (as Godot/Unreal):
    // variantFrame = the editor's cell, -1 = random per particle. Blessing's halo animated from the dot cell instead.
    flipColumns: e.flipbook?.columns ?? 1, flipRows: e.flipbook?.rows ?? 1, flipFps: e.flipbook?.variantFrame !== undefined ? 0 : e.flipbook?.fps ?? 0,
    flipLoop: e.flipbook?.loop ?? false, flipRandomStart: e.flipbook?.randomStartFrame ?? false,
    flipStartFrame: e.flipbook?.variantFrame ?? e.flipbook?.startFrame ?? (e.flipbook?.randomStartFrame === false ? 0 : -1),
    attachToSource: e.attachToSource === true,
    trackTicks: (e.sourceTrack ?? []).map(([t]) => t), trackPositions: (e.sourceTrack ?? []).flatMap(([, p]) => pos(p)),
  };
}

function lightFrom(l: UeLight): UnityLight {
  return {
    name: l.name, color: l.color.map(r4), intensityTicks: l.intensity.map(([t]) => t), intensityValues: l.intensity.map(([, v]) => r4(v * UNITY_LIGHT_SCALE)),
    range: r4(Math.max(0.1, l.radiusCm / 100 * UNITY_LIGHT_RANGE)), position: pos(l.positionCm),
    trackTicks: (l.sourceTrack ?? []).map(([t]) => t), trackPositions: (l.sourceTrack ?? []).flatMap(([, p]) => pos(p)),
  };
}

/** LineRenderer evaluates its alpha gradient (the end fade) and width curve only at the path's vertices: a 2-point path
 *  (Helix core/haze, Pulse rays) got alpha 0 at both of its only vertices and was never drawn (the Unreal importer had
 *  the same bug, a1f8d5b). Short faded paths are resampled to this many evenly spaced points. */
export const MIN_FADE_POINTS = 17;
export function resampleForFade(points: Vec3Width[], endFade: number): Vec3Width[] {
  if (!(endFade > 0) || points.length < 2 || points.length >= MIN_FADE_POINTS) return points;
  const segs = points.length - 1, out: Vec3Width[] = [];
  for (let j = 0; j < MIN_FADE_POINTS; j++) {
    const t = (j / (MIN_FADE_POINTS - 1)) * segs, s = Math.min(segs - 1, Math.floor(t)), f = t - s;
    const a = points[s], b = points[s + 1];
    out.push([0, 1, 2, 3].map(k => a[k] + (b[k] - a[k]) * f) as Vec3Width);
  }
  return out;
}

function ribbonFrom(b: UeRibbon): UnityRibbon {
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const textured = !!b.textureFile, cell = textured ? Math.max(0, b.cell ?? 0) : 0;
  return {
    name: b.name, color: [r4(b.color.r), r4(b.color.g), r4(b.color.b)], additive: b.blend === 'additive', emission: r4(b.emission ?? 0), texture: b.textureFile ?? '', endFade: r4(b.endFade ?? 0),
    grid: textured ? [...(b.sheetGrid ?? [1, 1])] : [1, 1], cell, tile: textured ? r4((b.tileCm ?? 0) / 100) : 0,
    scroll: textured && b.scroll ? [r4(b.scroll[0]), r4(b.scroll[1])] : [0, 0], softness: textured ? 0 : r4(b.softness ?? 0),
    frames: b.frames.map(f => ({
      tick: f.tick,
      paths: (f.paths ?? (f.points.length ? [{ points: f.points, alpha: 1 }] : [])).map(p => ({
        alpha: r4(p.alpha), cell: textured && 'cell' in p && p.cell !== undefined ? Math.max(0, p.cell) : cell,
        points: resampleForFade(p.points, b.endFade ?? 0).flatMap(q => [r3(q[0] / 100), r3(q[2] / 100), r3(-q[1] / 100), r3(q[3] / 100)]),
      })),
    })),
  };
}

/** Linear interpolation of float keys at t (clamped to the end keys; 1 when there are none). */
function keyAt(keys: UeFloatKey[], t: number): number {
  if (!keys.length) return 1;
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 1; i < keys.length; i++) if (t <= keys[i].t) { const a = keys[i - 1], b = keys[i]; return a.v + (b.v - a.v) * ((t - a.t) / Math.max(1e-6, b.t - a.t)); }
  return keys[keys.length - 1].v;
}

/**
 * A moving-head particle trail (Bolt/Needle/Orb streak, Summon/Nova strokes) baked into a ribbon layer, like the
 * Unreal importer builds one ribbon per head: each tick the path is the head's track over the last lifetimeSec, oldest
 * tail first, width = widthCm x widthOverTrail, the tail-only fade as endFade with keepHead. The head lives from its first
 * burst for lifetimeSecMax; after it dies the remaining trail drains away. Trails without a track (many-particle
 * spark/shed trails) return null.
 */
export function trailRibbonFrom(tr: UeParticleTrail, durationTicks: number): UnityRibbon | null {
  const track = tr.emitter.sourceTrack ?? [];
  if (track.length < 2) return null;
  const at = (tick: number): number[] => {
    if (tick <= track[0][0]) return pos(track[0][1]);
    for (let i = 1; i < track.length; i++) if (tick <= track[i][0]) {
      const [t0, a] = track[i - 1], [t1, b] = track[i], f = (tick - t0) / Math.max(1, t1 - t0);
      return pos([0, 1, 2].map(k => a[k] + (b[k] - a[k]) * f));
    }
    return pos(track[track.length - 1][1]);
  };
  const born = tr.emitter.bursts.length ? Math.min(...tr.emitter.bursts.map(b => b.tick)) : track[0][0];
  const dies = tr.emitter.bursts.length ? born + Math.round(tr.emitter.lifetimeSecMax * 60) : durationTicks;
  const history = Math.max(1, Math.round(tr.lifetimeSec * 60));
  const step = Math.max(1, Math.ceil(history / Math.max(2, tr.maxPoints)));
  const peak = Math.max(...tr.opacityOverTrail.map(k => k.v), 0) || 1;
  const frames: UnityRibbon['frames'] = [];
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  for (let tick = born; tick <= Math.min(durationTicks, dies + history + 1); tick++) {
    const from = Math.max(born, tick - history), to = Math.min(tick, dies);
    const pts: number[][] = [];
    for (let k = from; k <= to; k += step) pts.push(at(k));
    if (to > from && (to - from) % step) pts.push(at(to));
    const dedup = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]) > 1e-4);
    const n = dedup.length;
    const points = n < 2 ? [] : dedup.flatMap((p, i) => [r3(p[0]), r3(p[1]), r3(p[2]), r3(tr.widthCm / 100 * keyAt(tr.widthOverTrail, i / (n - 1)))]);
    frames.push({ tick, paths: points.length ? [{ alpha: r4(Math.min(1, peak)), cell: 0, points }] : [] });
  }
  const c = tr.colorOverTrail[tr.colorOverTrail.length - 1] ?? { r: 1, g: 1, b: 1 };
  return {
    name: tr.name, color: [r4(c.r), r4(c.g), r4(c.b)], additive: tr.blend === 'additive', emission: r4(tr.emission ?? 0), texture: tr.textureFile ?? '',
    endFade: r4(Math.min(0.5, tr.endFade)), keepHead: true, grid: [1, 1], cell: 0, tile: 0, scroll: [0, 0], softness: tr.textureFile ? 0 : 1, frames,
  };
}

export function unityEffectFrom(e: UnrealEffect): { effect: UnityEffect; report: UnityReportItem[] } {
  const report: UnityReportItem[] = [];
  const trailRibbons: UnityRibbon[] = [];
  for (const t of e.trails ?? []) {
    const r = trailRibbonFrom(t, e.durationTicks);
    if (r) trailRibbons.push(r);
    else report.push({ level: 'dropped', item: t.name, message: 'Trail left by many particles (sparks/shed) is not exported to Unity yet: only trails behind a moving head are baked (as beam layers).' });
  }
  const effect: UnityEffect = {
    format: 'vfx-studio-unity', version: 1, name: e.name, durationTicks: e.durationTicks, ticksPerSecond: 60, sourceHeight: r4((e.sourceHeightCm ?? 0) / 100),
    emitters: e.emitters.map(x => emitterFrom(x, report)), lights: e.lights.map(lightFrom), ribbons: [...e.ribbons.map(ribbonFrom), ...trailRibbons], textures: e.textures,
  };
  // The shared IR's own notes that still apply (meshes, flashes, keyframes, multi-path...), minus Unreal-specific ones.
  const ueOnly = /Niagara|Unreal|importer|UE 5|Shape Location|template/i;
  for (const r of e.report) {
    if (!ueOnly.test(r.message)) report.push(r);
    // A drop is never hidden just because its wording names Unreal (meshes vanished silently; feature grid 2026-10-29).
    else if (r.level === 'dropped') { const first = r.message.replace(/;.*$/s, '.'); report.push({ ...r, message: ueOnly.test(first) ? `${r.item} is not exported to Unity.` : first }); }
  }
  if (trailRibbons.length) report.push({ level: 'approximated', item: 'trails', message: `${trailRibbons.length} particle trail(s) behind moving heads are baked as beam layers (head track over the trail history, width/fade like the editor; head stays full, tail fades).` });
  if (e.ribbons.length) report.push({ level: 'info', item: 'ribbons', message: `${e.ribbons.length} beam/ribbon layer(s) are drawn by LineRenderers from baked per-frame geometry (camera-facing; one sheet cell per path, tiled or stretched, UV scroll and soft edges like the editor; no distortion).` });
  report.push({ level: 'info', item: 'scale', message: 'Unity uses metres and +Y up; Z is mirrored (Unity is left-handed). The prefab origin is the Source anchor. Light intensity = preview intensity x 0.1 (built-in pipeline scale).' });
  return { effect, report };
}

export function unityReportMarkdown(name: string, report: UnityReportItem[]): string {
  const lines = [`# Unity export: ${name}`, ''];
  for (const [level, title] of [['dropped', 'Left out'], ['approximated', 'Approximated'], ['info', 'Notes']] as const) {
    const items = report.filter(r => r.level === level);
    if (!items.length) continue;
    lines.push(`## ${title}`, '');
    const folded = new Map<string, string[]>();
    for (const r of items) folded.set(r.message, [...(folded.get(r.message) ?? []), r.item]);
    for (const [m, where] of folded) lines.push(`- ${m} (${[...new Set(where)].join(', ')})`);
    lines.push('');
  }
  return lines.join('\n');
}

export function unityReadme(name: string): string {
  return [`# ${name} - Unity export`, '',
    'Unity 6 (6000.x), built-in render pipeline or URP.', '',
    '1. Copy `integrations/unity/VfxStudio` (from the VFX-Tool repo) into your project as `Assets/VfxStudio/` (once per project).',
    `2. Copy this folder into the project, e.g. \`Assets/VfxStudioEffects/${name}/\`.`,
    `3. In Unity: Tools > VFX Studio > Import Effect..., pick \`effect.unity.json\` in that folder. It builds \`${name}.prefab\` next to it`,
    '   (one Particle System per emitter, Lights, a VfxStudioEffect player for timing, bursts, moving sources and beams).',
    '4. Drag the prefab into a scene where the effect should start (its origin is the caster / nozzle; in VFX Studio it stood',
    '   sourceHeight metres above the floor, see effect.unity.json). It plays on enable;',
    '   call `GetComponent<VfxStudio.VfxStudioEffect>().Play()` to fire it again.', '',
    'Command line: `Unity.exe -batchmode -quit -projectPath <project> -executeMethod VfxStudio.EditorTools.VfxStudioImporter.ImportCli -vfxPackage <this folder>`', '',
    'See report.md for what changed versus the VFX Studio preview.', ''].join('\n');
}
