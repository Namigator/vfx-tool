// Keyframed knobs (user order 2026-09-29: timeline → keyframed knobs → engine export). A number knob can carry keys
// ({tick, value}); its value at any effect tick is linear between keys and held before the first / after the last.
//
// Most node parameters are compile-time constants, so instead of teaching every parameter to vary over time the
// document is compiled once per key tick (every keyed knob set to its value there) and the compiled plans are
// compared: each number that differs becomes a per-tick track (linear between the key ticks). Particle descriptors
// carry their tracks into the runtime (ParticleSimulation applies them each tick); preview layers carry theirs to the
// viewport (material/light uniforms). Paths are compiled per tick already, so they simply read the knobs at that tick.
// Knobs that change structure or timing (counts of systems, burst ticks, windows) cannot be animated this way and are
// reported as errors naming the knob.
import type { ControlKey, Diagnostic, EffectDocumentV2, PublicControl, ValidationResult } from '../model/types.ts';
import type { DescriptorTrack } from '../runtime/particles.ts';

/** Colour track: [tick, "#RRGGBB"] keys, interpolated in RGB by the viewport. */
export type ColorTrack = { path: (string | number)[]; keys: [number, string][] };
export type LayerAnimation = { numbers: DescriptorTrack[]; colors: ColorTrack[] };

export function controlValueAt(c: Pick<PublicControl, 'value' | 'keys' | 'type'>, tick: number): PublicControl['value'] {
  const keys = c.keys;
  if (!keys?.length) return c.value;
  if (tick <= keys[0].tick) return keys[0].value;
  const last = keys[keys.length - 1];
  if (tick >= last.tick) return last.value;
  let i = 1;
  while (keys[i].tick < tick) i++;
  const a = keys[i - 1], b = keys[i], u = (tick - a.tick) / (b.tick - a.tick);
  const v = a.value + (b.value - a.value) * u;
  return c.type === 'integer' ? Math.round(v) : v;
}

type KeyedDoc = { controls?: { keys?: ControlKey[] }[]; durationTicks?: number };
/** Cheap check on an unvalidated input: does any knob carry keys? */
export function hasKeyframes(input: unknown): boolean {
  const cs = (input as KeyedDoc | null)?.controls;
  return Array.isArray(cs) && cs.some(c => Array.isArray(c?.keys) && c.keys.length > 0);
}

/** The document with every keyed knob set to its value at `tick` (keys kept; unkeyed knobs untouched). */
export function docAtTick<T>(input: T, tick: number): T {
  if (!hasKeyframes(input)) return input;
  const d = input as unknown as EffectDocumentV2;
  return { ...d, controls: d.controls.map(c => (c.keys?.length ? { ...c, value: controlValueAt(c, tick) } : c)) } as unknown as T;
}

/** Sorted distinct key ticks inside [0, durationTicks]. */
export function keyTicks(input: unknown): number[] {
  const d = input as KeyedDoc;
  const dur = typeof d.durationTicks === 'number' ? d.durationTicks : Infinity;
  return [...new Set((d.controls ?? []).flatMap(c => (c.keys ?? []).map(k => Math.min(dur, Math.max(0, k.tick)))))].sort((a, b) => a - b);
}

const FORBIDDEN = new Set(['durationTicks', 'documentSeed', 'emitterId', 'randomStreamId']);
const MAX_TRACKS_PER_ITEM = 64;
/** Layer values the viewport can animate (uniforms / light properties). */
export const LAYER_ANIMATABLE = new Set(['opacity', 'emission', 'hueShift', 'color', 'grade', 'intensity', 'range', 'colorOverLife']);

type Diff = { numbers: DescriptorTrack[]; colors: ColorTrack[]; problems: string[] };
const isColour = (v: unknown): v is { srgb: string } => !!v && typeof v === 'object' && typeof (v as { srgb?: unknown }).srgb === 'string';

/** Walks value[0] and compares every variant; numbers that differ become tracks, other differences are problems. */
function diffValues(values: unknown[], ticks: number[], path: (string | number)[], out: Diff, skip: (path: (string | number)[]) => boolean): void {
  if (skip(path)) return;
  const v0 = values[0];
  if (typeof v0 === 'number') {
    if (values.every(v => v === v0)) return;
    if (!values.every(v => typeof v === 'number')) { out.problems.push(path.join('.')); return; }
    if (FORBIDDEN.has(String(path[path.length - 1])) || (path[0] === 'rate' && (path[1] === 'startTick' || path[1] === 'endTick'))) { out.problems.push(path.join('.')); return; }
    out.numbers.push({ path: [...path], keys: ticks.map((t, i) => [t, values[i] as number]) });
    return;
  }
  if (isColour(v0) && values.every(isColour)) {
    const cs = values.map(v => (v as { srgb: string }).srgb.toUpperCase());
    if (cs.some(c => c !== cs[0])) out.colors.push({ path: [...path, 'srgb'], keys: ticks.map((t, i) => [t, cs[i]]) });
    diffValues(values.map(v => (v as { alpha?: unknown }).alpha), ticks, [...path, 'alpha'], out, skip);
    return;
  }
  if (Array.isArray(v0)) {
    if (!values.every(v => Array.isArray(v) && v.length === v0.length)) { out.problems.push(path.join('.') || '(list)'); return; }
    v0.forEach((_, i) => diffValues(values.map(v => (v as unknown[])[i]), ticks, [...path, i], out, skip));
    return;
  }
  if (v0 && typeof v0 === 'object') {
    const keys = new Set(values.flatMap(v => (v && typeof v === 'object' ? Object.keys(v) : [])));
    for (const k of keys) diffValues(values.map(v => (v as Record<string, unknown> | undefined)?.[k]), ticks, [...path, k], out, skip);
    return;
  }
  if (!values.every(v => v === v0)) out.problems.push(path.join('.'));
}

type Item = { id: string };
/** Pairs items by id across variants; returns per-id diffs (missing ids are problems). */
function diffItems<T extends Item>(lists: T[][], ticks: number[], label: string, skip: (item: T, path: (string | number)[]) => boolean, problems: string[]): Map<string, Diff> {
  const out = new Map<string, Diff>();
  const ids = lists[0].map(x => x.id);
  if (lists.some(l => l.length !== ids.length || l.some(x => !ids.includes(x.id)))) { problems.push(`${label} appear or disappear`); return out; }
  for (const item of lists[0]) {
    const values = lists.map(l => l.find(x => x.id === item.id)!);
    const diff: Diff = { numbers: [], colors: [], problems: [] };
    diffValues(values, ticks, [], diff, p => skip(item, p));
    if (diff.numbers.length + diff.colors.length > MAX_TRACKS_PER_ITEM) diff.problems.push(`${item.id} (too many animated values)`);
    problems.push(...diff.problems.map(p => `${item.id}.${p}`));
    if (diff.numbers.length || diff.colors.length) out.set(item.id, diff);
  }
  return out;
}

/** Plan shapes this module needs (kept structural so it does not import the compiler). */
type Desc = { emitterId: string; bursts: { tick: number; count: number; position?: unknown }[]; animation?: unknown };
type PlanLike = {
  systems: { id: string; descriptor: Desc }[];
  layers: { nodeId: string; animation?: LayerAnimation }[];
  trails: { nodeId: string; animation?: LayerAnimation }[];
  meshes: { nodeId: string; animation?: LayerAnimation }[];
  lights: { nodeId: string; animation?: LayerAnimation }[];
};
export type StaticCompile<P extends PlanLike, O> = (input: unknown, options: O & { descriptorTracks?: ReadonlyMap<string, DescriptorTrack[]>; nodeParamTracks?: ReadonlyMap<string, [number, number][]> }) => ValidationResult<P>;

/** Node parameters driven by keyed knobs (value × scale + offset per binding, as controls.ts applies them): `nodeId|param` → keys. */
function nodeParamTracks(input: unknown, ticks: number[]): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  for (const c of (input as EffectDocumentV2).controls ?? []) {
    if (!c.keys?.length) continue;
    for (const b of c.bindings) {
      if (b.axis !== undefined) continue;
      out.set(`${b.nodeId}|${b.parameter}`, ticks.map(t => [t, (controlValueAt(c, t) as number) * (b.scale ?? 1) + (b.offset ?? 0)]));
    }
  }
  return out;
}

/** Which knobs have keys (for error messages). */
const keyedLabels = (input: unknown) => ((input as EffectDocumentV2).controls ?? []).filter(c => c.keys?.length).map(c => `"${c.label}"`).join(', ');

/**
 * compileParticlePreview for a document with keyed knobs: one compile per key tick, numbers that differ become
 * tracks, then a final compile of the first-key document with the descriptor tracks attached (so compile-time child
 * emission runs the animated parent), and layer tracks copied onto the final plan's layers.
 */
export function compileKeyframed<P extends PlanLike, O extends object>(input: unknown, options: O, compile: StaticCompile<P, O>): ValidationResult<P> {
  const ticks = keyTicks(input);
  if (ticks.length <= 1) return compile(docAtTick(input, ticks[0] ?? 0), options);
  const variants: P[] = [];
  for (const t of ticks) {
    const r = compile(docAtTick(input, t), options);
    if (!r.ok) return r;
    variants.push(r.value);
  }
  const problems: string[] = [];
  // Descriptors, keyed by emitter. Bursts: counts may animate when every variant has the same schedule-driven bursts;
  // event-driven bursts (positions, or ticks that move) are regenerated from the animated parent by the final compile.
  const systems = diffItems(variants.map(v => v.systems.map(s => ({ ...s.descriptor, id: s.descriptor.emitterId }))), ticks, 'particle systems',
    (item, p) => {
      if (p[0] === 'animation') return true;
      if (p[0] !== 'bursts') return false;
      const lists = variants.map(v => v.systems.find(s => s.descriptor.emitterId === item.id)!.descriptor.bursts);
      const fixed = lists.every(l => l.length === lists[0].length && l.every((b, i) => b.tick === lists[0][i].tick && b.position === undefined));
      return !fixed || (p.length >= 3 && p[2] !== 'count');
    }, problems);
  const descriptorTracks = new Map([...systems].map(([id, d]) => [id, d.numbers] as const));
  const layerDiffs = (pick: (v: P) => { nodeId: string }[], label: string) => diffItems(variants.map(v => pick(v).map(l => ({ ...l, id: l.nodeId }))), ticks, label, (_, p) => p[0] === 'animation' || p[0] === 'track' || p[0] === 'startTick' || p[0] === 'endTick', problems);
  // The viewport animates these layer values (material/light uniforms); anything else changing is reported.
  const layers = layerDiffs(v => v.layers, 'sprite layers'), trails = layerDiffs(v => v.trails, 'trails'), meshes = layerDiffs(v => v.meshes, 'meshes'), lights = layerDiffs(v => v.lights, 'lights');
  for (const diffs of [layers, trails, meshes, lights]) for (const [id, d] of diffs) {
    const bad = [...d.numbers.map(t => t.path), ...d.colors.map(t => t.path)].filter(p => !LAYER_ANIMATABLE.has(String(p[0])));
    problems.push(...bad.map(p => `${id}.${p.join('.')}`));
  }
  if (problems.length) {
    const d: Diagnostic = {
      code: 'INVALID_VALUE', severity: 'error', fieldPath: 'controls',
      message: `Keyframed knob(s) ${keyedLabels(input)} change the effect's structure or timing over time (${problems.slice(0, 4).join(', ')}${problems.length > 4 ? ', …' : ''}), which cannot be animated. Remove the keys from knobs that set counts, start times or lengths.`,
    };
    return { ok: false, errors: [d] };
  }
  const final = compile(docAtTick(input, ticks[0]), { ...options, descriptorTracks, nodeParamTracks: nodeParamTracks(input, ticks) });
  if (!final.ok) return final;
  const attach = (list: { nodeId: string; animation?: LayerAnimation }[], diffs: Map<string, Diff>) => {
    for (const l of list) { const d = diffs.get(l.nodeId); if (d) l.animation = { numbers: d.numbers, colors: d.colors }; }
  };
  attach(final.value.layers, layers); attach(final.value.trails, trails); attach(final.value.meshes, meshes); attach(final.value.lights, lights);
  return final;
}

/** Value of a numeric track at `tick` (linear between keys, held outside). */
export function trackValue(keys: readonly (readonly [number, number])[], tick: number): number {
  if (tick <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (tick >= last[0]) return last[1];
  let i = 1;
  while (keys[i][0] < tick) i++;
  const [ta, a] = keys[i - 1], [tb, b] = keys[i];
  return a + ((b - a) * (tick - ta)) / (tb - ta);
}

/** Colour track at `tick`, interpolated per sRGB channel. */
export function colorTrackValue(keys: readonly (readonly [number, string])[], tick: number): string {
  const n = keys.map(([t, c]) => [t, [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))] as const);
  const ch = (i: number) => Math.round(trackValue(n.map(([t, rgb]) => [t, rgb[i]] as const), tick));
  return `#${[0, 1, 2].map(i => ch(i).toString(16).toUpperCase().padStart(2, '0')).join('')}`;
}

/** Keys with `value` at `tick` (replacing a key already there), ascending. */
export function setKeyAt(keys: readonly ControlKey[] | undefined, tick: number, value: number): ControlKey[] {
  return [...(keys ?? []).filter(k => k.tick !== tick), { tick, value }].sort((a, b) => a.tick - b.tick);
}
/** Keys without the one at `tick`. */
export const removeKeyAt = (keys: readonly ControlKey[] | undefined, tick: number): ControlKey[] => (keys ?? []).filter(k => k.tick !== tick);
/** Knobs that cannot be keyframed: timing knobs (Start at, Burn time, Travel...) change structure, not values. */
export const canKeyframe = (c: Pick<PublicControl, 'type' | 'unit'>): boolean => (c.type === 'number' || c.type === 'integer') && c.unit !== 'tick';
