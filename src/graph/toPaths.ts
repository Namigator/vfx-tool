// Graph-to-path preview adapter (WP03-PATH-ADAPTER.md, claude-model). Pure compiler:
// createRegistry → analyzeGraph → expandGroups → per-tick RibbonRenderer layers with PathData geometry.
// No DOM, React or Three. The input is never mutated (analysis works on a clone).
//
// Scope: reachable RibbonRenderer sinks at the root EffectOutput.visual, fed by LinePath/BezierPath
// (or RadialPath) generators through JaggedPath/BranchPath/RevealPath modifiers, with an optional Schedule window.
// BillboardRenderer sinks are skipped here (owned by compileParticlePreview); any other reachable node
// in a ribbon chain returns an addressed error instead of being ignored or approximated.
//
// Decisions:
// - Semantic path IDs (plan24 Amendment A1): a generator names its paths "p<generationIndex>" (Line and
//   Bezier emit one path, "p0"); Jagged/Reveal/trunk keep the ID; branches are "<parentId>/b<ordinal>".
//   Node IDs never enter a path ID or a random key, so renamed/moved/Preserve-pattern copies keep
//   identical geometry; only randomStreamId changes the pattern.
// - JaggedPath pathOrdinal is the path's index in its input set; regeneration time is effect time
//   effectTick / TICKS_PER_SECOND (the canonical tick clock).
// - Geometry is evaluated in effect-local space (document anchors, Bezier handle offsets, jagged
//   amplitude, branch lengths and groundY are all effect-local), then the root transform is applied once
//   to every output point. Ribbon width and UV tile length are scaled by the uniform root scale.
// - Each path node output is evaluated once per compile even when shared by several ribbons.
// - Any non-empty connection into a parameter port, and any exposed-control driver, is rejected until
//   expression evaluation exists. Exceptions: RevealPath.fraction, RingPath.radiusScale and
//   Material.opacity may be driven by EffectTimeCurve.value (curve sampled at effect seconds; disabled driver falls back to the literal). Disabled nodes are not parameter-checked (they contribute no values).
// - Validation does not depend on effectTick: geometry is always evaluated; a layer outside its window
//   (or at/after the document end) is inactive and carries no paths.
import { BUILTIN_SPRITES } from '../assets/builtinSprites.generated.ts';
import type { SpriteSheet } from '../assets/spriteLibrary.ts';
import type { ColorValue, CurveValue, Diagnostic, ErrorCode, ParameterValue, Quaternion, Transform, ValidationResult, Vec3 } from '../model/types.ts';
import { TICKS_PER_SECOND } from '../model/types.ts';
import { registryKey } from '../model/controls.ts';
import { bezierPath, jaggedPath, linePath, revealPath, type PathData, helixPath, transformPath, type HelixTaper } from '../runtime/paths.ts';
import { branchPaths, type BranchCountMode } from '../runtime/branches.ts';
import { radialPaths, type RadialMode } from '../runtime/radial.ts';
import { ringPath } from '../runtime/ring.ts';
import { evaluateCurve } from '../runtime/curves.ts';
import { EFFECT_TIME_NODES } from './effectTime.ts';
import { evalSignal, isTimeVarying, SignalError, type SignalContext } from './signals.ts';
import { analyzeGraph } from './analyze.ts';
import { expandGroups, type ExpandedConnection, type ExpandedGraph, type ExpandedNode, type ExpandedSource } from './expand.ts';
import { createRegistry } from './registry.ts';
import { scheduleStart, TimingError, type TimingContext } from './eventTiming.ts';
import { materialSheet } from './materialSprite.ts';
import { compileParticlePreview } from './toParticles.ts';
import { ParticleSimulation, type ParticleEmitterDescriptor, type ParticleState } from '../runtime/particles.ts';
import { fnv1a32Utf8 } from '../runtime/random.ts';

/**
 * ParticlePaths simulation cache: per compiled descriptor, pristine checkpoints every 30 ticks, so
 * per-tick path compiles do not replay the particle system from tick 0 (bounded to 16 descriptors).
 */
const particleCheckpoints = new Map<string, ParticleSimulation[]>();
let particleProbeDepth = 0;
/** The ParticlePaths source compile is tick-independent: cached per input object (while its JSON is unchanged) and probed node. */
const particleProbeCache = new WeakMap<object, { text: string; byNode: Map<string, ReturnType<typeof compileParticlePreview>> }>();
function probeParticleSystem(input: unknown, nodeId: string): ReturnType<typeof compileParticlePreview> {
  const compile = () => compileParticlePreview(input, { audioHandled: true, ribbonsHandled: true, probeParticles: nodeId });
  const text = typeof input === 'object' && input !== null ? sameInputText(input) : undefined;
  if (text === undefined) return compile();
  let entry = particleProbeCache.get(input as object);
  if (!entry || entry.text !== text) particleProbeCache.set(input as object, entry = { text, byNode: new Map() });
  let r = entry.byNode.get(nodeId);
  if (!r) entry.byNode.set(nodeId, r = compile());
  return r;
}
function particlesAtTick(desc: ParticleEmitterDescriptor, tick: number): ParticleState[] | string {
  const key = JSON.stringify(desc);
  let cps = particleCheckpoints.get(key);
  if (!cps) {
    const c = ParticleSimulation.create(desc);
    if (!c.ok) return c.errors.map(e => e.message).join(' ');
    cps = [c.value];
    particleCheckpoints.set(key, cps);
    if (particleCheckpoints.size > 16) particleCheckpoints.delete(particleCheckpoints.keys().next().value as string);
  }
  const end = Math.min(tick, desc.durationTicks);
  let base = cps[0];
  for (const c of cps) if (c.tick <= end && c.tick > base.tick) base = c;
  const sim = base.clone();
  while (sim.tick < end) {
    const r = sim.advance();
    if (!r.ok) return r.errors.map(e => e.message).join(' ');
    if (sim.tick % 30 === 0 && !cps.some(c => c.tick === sim.tick)) cps.push(sim.clone());
  }
  return sim.snapshot().particles;
}

export type PathPreviewLayer = {
  /** RibbonRenderer node ID. */
  nodeId: string;
  /** Visible tick range [startTick, endTick); null when the window Schedule is disabled. */
  window: { startTick: number; endTick: number } | null;
  active: boolean;
  /** World-space paths at effectTick; empty when inactive. Consumers skip paths with < 2 points. */
  paths: PathData[];
  /** Meters, root scale applied. Per-path PathData.widthScale multiplies it. */
  width: number;
  widthOverPath: CurveValue;
  /** Fraction (0..0.5) of each path's arc length over which both ends taper and fade. */
  endFade: number;
  uvMode: 'stretch' | 'tile';
  /** SpriteTextured material: library sheet mapped along the ribbon (u = arc, v = across); cell per path. */
  sprite?: { sheet: SpriteSheet; variant: number };
  /** 09 UV animation for textured ribbons: scroll (UV/s) and noise distortion amplitude. */
  uvAnim?: { scroll: [number, number]; distort: number };
  uvTileLength: number;
  orientation: 'camera' | 'parallelTransport';
  renderOrderOffset: number;
  /** Index of this sink's first connection among root EffectOutput.visual connections (shared with particle layers). */
  visualOrder: number;
  /** Material.tint as encoded sRGB. */
  color: ColorValue;
  opacity: number;
  emission: number;
  blend: 'normal' | 'additive' | 'cutout';
  alphaCutoff: number;
  /** 09 liquid (0..1): clear core, lit edges and flowing highlights; 0 = solid. */
  liquid: number;
  /** Material Colour shift in degrees (0 = unchanged). */
  hueShift: number;
};
export type PathPreviewPlan = {
  durationTicks: number;
  effectTick: number;
  /** Set only for a `probe` compile. */
  probe?: PathData[];
  /** In root EffectOutput.visual connection order. */
  layers: PathPreviewLayer[];
};

/**
 * Work budget of one compile (plan15-style caps). Paths/points are counted over evaluated path node
 * outputs; points are also counted separately over the world-space copies emitted by active layers.
 */
export const MAX_PREVIEW_PATHS = 4096;
export const MAX_PREVIEW_POINTS = 262144;

const RIBBON_PORTS = ['paths', 'material', 'window'];
const ENDPOINT_PORTS = ['start', 'end'];
const MODIFIER_PORTS = ['paths'];
const RADIAL_PORTS = ['center', 'window'];

type NodeOutputs = Map<string, PathData[]>;

class Fail extends Error {}

export type PathPreviewOptions = {
  /**
   * Set only when the caller has separately compiled and validated the root EffectOutput.audio graph
   * (e.g. with the audio compiler) and will act on its result. The visual compile then ignores the
   * root audio edge instead of reporting it; it never validates audio itself. Default false.
   * Presentation connections are errors regardless.
   */
  audioHandled?: boolean;
  /** Evaluate only this node output (world space) and return it as `probe`; sinks are not compiled. */
  probe?: { nodeId: string; port: string };
};

let lengthProbeDepth = 0;
/**
 * World-space arc length of the first path of `nodeId.port` at `tick` (PathFollower speed mode). Throws
 * TimingError when the path cannot be evaluated or depends on its own follower (probe nesting > 4).
 */
export function probePathLength(input: unknown, nodeId: string, port: string, tick: number): number {
  if (lengthProbeDepth > 4) throw new TimingError(`Path "${nodeId}" depends on its own follower's timing.`, nodeId);
  lengthProbeDepth++;
  try {
    const r = compilePathPreview(input, tick, { audioHandled: true, probe: { nodeId, port } });
    if (!r.ok) throw new TimingError(r.errors[0]?.message ?? `Path "${nodeId}" could not be evaluated.`, r.errors[0]?.nodeId ?? nodeId);
    const pts = r.value.probe?.[0]?.points ?? [];
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    return len;
  } finally { lengthProbeDepth--; }
}

/**
 * Validation, analysis and group expansion do not depend on the tick, but the preview recompiles every
 * tick (~80 of a lightning strike's 86 ms per frame was this). Cached per input object; a hit is reused
 * only while the object's JSON text is unchanged, so an in-place edit can never serve a stale plan.
 */
type PreparedPaths = { registry: ReturnType<typeof createRegistry>; analysis: ReturnType<typeof analyzeGraph>; expansion?: ReturnType<typeof expandGroups> };
const preparedCache = new WeakMap<object, { text: string; prepared: PreparedPaths }>();
/** Same-content check shared by the tick-independent caches below. */
function sameInputText(input: unknown): string | undefined {
  try { return JSON.stringify(input); } catch { return undefined; }
}
function preparePathDocument(input: unknown): PreparedPaths {
  const key = typeof input === 'object' && input !== null ? input : undefined;
  const text = key ? sameInputText(input) : undefined;
  const cached = key ? preparedCache.get(key) : undefined;
  if (cached && text !== undefined && cached.text === text) return cached.prepared;
  const registry = createRegistry();
  const analysis = analyzeGraph(input, { registry });
  const prepared: PreparedPaths = { registry, analysis, expansion: analysis.ok ? expandGroups(analysis.value) : undefined };
  if (key && text !== undefined) preparedCache.set(key, { text, prepared });
  return prepared;
}

export function compilePathPreview(input: unknown, effectTick: number, options: PathPreviewOptions = {}): ValidationResult<PathPreviewPlan> {
  if (typeof effectTick !== 'number' || !Number.isInteger(effectTick) || effectTick < 0) {
    return { ok: false, errors: [{ code: 'INVALID_VALUE', severity: 'error', message: `effectTick must be a nonnegative integer; got ${String(effectTick)}.` }] };
  }
  const prepared = preparePathDocument(input);
  const { registry, analysis } = prepared;
  if (!analysis.ok) return analysis;
  const expansion = prepared.expansion!;
  if (!expansion.ok) return expansion;
  const warnings = [...analysis.warnings, ...expansion.warnings];
  const doc = analysis.value.document;
  const x: ExpandedGraph = expansion.value;

  const errors: Diagnostic[] = [];
  const nodePath = new Map<string, string>();
  doc.graphs.forEach((g, gi) => g.nodes.forEach((n, ni) => nodePath.set(n.id, `graphs[${gi}].nodes[${ni}]`)));
  const report = (code: ErrorCode, message: string, nodeId?: string, param?: string) => {
    const d: Diagnostic = { code, message, severity: 'error' };
    if (nodeId !== undefined) {
      d.nodeId = nodeId;
      const p = nodePath.get(nodeId);
      if (p !== undefined) d.fieldPath = param === undefined ? p : `${p}.params.${param}`;
    }
    errors.push(d);
  };
  const fail = (code: ErrorCode, message: string, nodeId?: string, param?: string): never => {
    report(code, message, nodeId, param);
    throw new Fail(message);
  };

  const nodes = new Map<string, ExpandedNode>(x.nodes.map(n => [n.node.id, n]));
  const params = new Map<string, ParameterValue>(x.parameters.map(p => [`${p.nodeId}\u0000${p.parameter}`, p.value]));
  const into = (nodeId: string, port: string): ExpandedConnection[] =>
    x.connections.filter(c => c.target.nodeId === nodeId && c.target.port === port && c.source.kind !== 'empty');
  /** Event-relative Schedules (eventTiming.ts): startTicks includes the trigger event's tick. */
  /** 05 Curve/Gradient nodes: a connected, enabled one supplies a curve/gradient parameter (disabled = the literal). */
  const shapeDriver = (n: ExpandedNode, id: string): ParameterValue | undefined => {
    const c = into(n.node.id, id).find(x => x.source.kind === 'node');
    const src = c && c.source.kind === 'node' ? nodes.get(c.source.nodeId) : undefined;
    if (!src || (src.node.type !== 'Curve' && src.node.type !== 'Gradient') || !src.effectiveEnabled) return undefined;
    return rawParam(src, src.node.type === 'Curve' ? 'curve' : 'gradient');
  };
  const param = (n: ExpandedNode, id: string): ParameterValue => {
    const shaped = shapeDriver(n, id);
    if (shaped !== undefined) return shaped;
    if (n.node.type === 'Schedule' && id === 'startTicks' && into(n.node.id, 'trigger').length) {
      try { return scheduleStart(timing, n.node.id); } catch (e) {
        if (e instanceof TimingError) return fail('INVALID_VALUE', e.message, e.nodeId);
        throw e;
      }
    }
    return rawParam(n, id);
  };
  const timing: TimingContext = {
    type: id => nodes.get(id)?.node.type,
    raw: (id, p) => { const x = nodes.get(id); return x ? rawParam(x, p) as number : fail('MISSING_REFERENCE', `Node "${id}" is not in the expanded graph.`, id); },
    source: (nodeId, port) => { const c = into(nodeId, port)[0]; return c && c.source.kind === 'node' ? { nodeId: c.source.nodeId, port: c.source.port } : undefined; },
    pathLength: (nodeId, port, tick) => probePathLength(input, nodeId, port, tick),
  };
  const rawParam = (n: ExpandedNode, id: string): ParameterValue => {
    const v = params.get(`${n.node.id}\u0000${id}`);
    if (v !== undefined) return v;
    const spec = registry.get(registryKey(n.node.type, n.node.definitionVersion))?.parameters.find(p => p.id === id);
    if (!spec) return fail('MISSING_REFERENCE', `Parameter "${id}" of "${n.node.id}" is not registered.`, n.node.id, id);
    return spec.default;
  };
  const num = (n: ExpandedNode, id: string) => param(n, id) as number;
  const noDrivenParams = (n: ExpandedNode, structural: string[]) => {
    const before = errors.length;
    for (const c of x.connections) {
      if (c.target.nodeId !== n.node.id || structural.includes(c.target.port) || c.source.kind === 'empty') continue;
      if (c.source.kind === 'node' && ['Curve', 'Gradient'].includes(nodes.get(c.source.nodeId)?.node.type ?? '')) continue;
      if (n.node.type === 'Schedule' && c.target.port === 'trigger') continue; // Resolved by scheduleStart.
      report('DOMAIN_MISMATCH', `Input "${c.target.port}" of "${n.node.id}" is driven by a connection; connected/animated parameters are not supported by the path preview yet. Disconnect it and set a literal.`, n.node.id, c.target.port);
    }
    if (errors.length !== before) throw new Fail('driven parameter');
  };
  const sourceNode = (s: ExpandedSource, consumer: string, port: string): ExpandedNode => {
    if (s.kind !== 'node') return fail('INVALID_VALUE', `Input "${port}" of "${consumer}" receives a literal group default; only node connections are supported here.`, consumer);
    const n = nodes.get(s.nodeId);
    if (!n) return fail('MISSING_REFERENCE', `Source node "${s.nodeId}" of "${consumer}.${port}" is not in the expanded graph.`, consumer);
    return n;
  };
  /** Runs a pure runtime core and turns its argument errors into an addressed diagnostic. */
  const guard = <T>(nodeId: string, run: () => T): T => {
    try {
      return run();
    } catch (e) {
      if (e instanceof RangeError || e instanceof TypeError) return fail('INVALID_VALUE', `${e.message}`, nodeId);
      throw e;
    }
  };

  for (const d of x.controlDrivers) {
    report('INVALID_VALUE', `Exposed control "${d.controlId}" of Group "${d.groupNodeId}" is driven by a connection; control expressions are not supported by the path preview yet.`, d.groupNodeId);
  }
  const outputId = x.rootOutputNodeId;
  for (const port of options.audioHandled === true ? [] : ['audio']) {
    if (into(outputId, port).length) report('INVALID_VALUE', `EffectOutput.${port} is connected, but ${port} output is not supported by the path preview yet.`, outputId);
  }

  // ---------- path evaluation (effect-local space) ----------
  const anchorPos = new Map(doc.anchors.map(a => [a.id, a.position]));
  const seconds = effectTick / TICKS_PER_SECOND;
  let totalPaths = 0, totalPoints = 0;
  const spend = (n: ExpandedNode, paths: PathData[]) => {
    totalPaths += paths.length;
    for (const p of paths) totalPoints += p.points.length;
    if (totalPaths > MAX_PREVIEW_PATHS) fail('BUDGET_EXCEEDED', `Path preview would evaluate ${totalPaths} paths; the limit is ${MAX_PREVIEW_PATHS}. Reduce branch counts.`, n.node.id);
    if (totalPoints > MAX_PREVIEW_POINTS) fail('BUDGET_EXCEEDED', `Path preview would evaluate ${totalPoints} path points; the limit is ${MAX_PREVIEW_POINTS}. Reduce samples or branch counts.`, n.node.id);
  };

  /** 05 Anchor / OffsetAnchor chain → document-space position; undefined when it does not resolve (disabled Anchor, missing document anchor). */
  const staticAnchor = (n: ExpandedNode, depth = 0): Vec3 | undefined => {
    if (n.node.type === 'Anchor') {
      if (!n.effectiveEnabled) return undefined;
      const p = anchorPos.get(param(n, 'anchorId') as string);
      return p ? [p[0], p[1], p[2]] : undefined;
    }
    if (n.node.type !== 'OffsetAnchor' || depth > 16) return undefined;
    const up = into(n.node.id, 'anchor');
    const u = up.length === 1 && up[0].source.kind === 'node' ? nodes.get(up[0].source.nodeId) : undefined;
    const b = u ? staticAnchor(u, depth + 1) : undefined;
    if (!b || !n.effectiveEnabled) return b;
    noDrivenParams(n, ['anchor']);
    const o = param(n, 'offset') as Vec3;
    // Drop to ground: keep the anchor's horizontal position, height = offset.y above the ground (y = 0).
    return [b[0] + o[0], param(n, 'dropToGround') === true ? o[1] : b[1] + o[1], b[2] + o[2]];
  };
  const anchorOf = (n: ExpandedNode, port: string): Vec3 => {
    const cs = into(n.node.id, port);
    const a = cs.length === 1 ? sourceNode(cs[0].source, n.node.id, port) : undefined;
    if (!a || (a.node.type !== 'Anchor' && a.node.type !== 'OffsetAnchor') || (a.node.type === 'Anchor' && !a.effectiveEnabled)) {
      return fail('MISSING_REFERENCE', `Required input "${port}" of "${n.node.id}" needs an enabled Anchor or OffsetAnchor (a disabled Anchor acts absent).`, n.node.id);
    }
    const p = staticAnchor(a);
    if (!p) return fail('MISSING_REFERENCE', `Anchor chain into "${n.node.id}.${port}" does not resolve to an existing document anchor.`, a.node.id);
    return p;
  };

  /**
   * A normalized drivable parameter (DRIVABLE: RevealPath.fraction, RingPath.radiusScale,
   * Material.opacity): the literal, or an enabled EffectTimeCurve.value sampled at `seconds`
   * (a disabled driver falls back to the literal). Curve y outside [0,1] is an addressed error.
   */
  const drivenScalar = (n: ExpandedNode, id: string): number => {
    const cs = into(n.node.id, id);
    if (cs.length === 0) return num(n, id);
    if (cs.length > 1) return fail('MULTIPLE_DRIVERS', `Input "${id}" of "${n.node.id}" has ${cs.length} drivers; connect one.`, n.node.id, id);
    const s = cs[0].source;
    const d = sourceNode(s, n.node.id, id);
    if (s.kind !== 'node' || (!EFFECT_TIME_NODES.has(d.node.type) && !isTimeVarying(signals, d.node.id))) {
      return fail('DOMAIN_MISMATCH', `Input "${id}" of "${n.node.id}" is driven by "${d.node.id}" (${d.node.type}); the path preview accepts time signals (EffectTimeCurve, Oscillator, Time, ScalarMath on them).`, n.node.id, id);
    }
    if (!d.effectiveEnabled) return num(n, id);
    if (d.node.type === 'EffectTimeCurve' && (param(d, 'curve') as CurveValue)?.domain !== 'effectSeconds') return fail('DOMAIN_MISMATCH', `EffectTimeCurve "${d.node.id}" curve must use domain "effectSeconds".`, d.node.id, 'curve');
    try {
      const spec = registry.get(registryKey(n.node.type, n.node.definitionVersion))?.parameters.find(p => p.id === id);
      const v = evalSignal(signals, d.node.id, s.port, seconds);
      if (d.node.type === 'EffectTimeCurve' && (v < 0 || v > 1)) return fail('INVALID_VALUE', `EffectTimeCurve "${d.node.id}" value ${v} is outside 0..1.`, d.node.id, 'curve');
      return Math.min(spec?.max ?? Infinity, Math.max(spec?.min ?? -Infinity, v)); // Math chains clamp into the driven range.
    } catch (e) {
      if (e instanceof SignalError) return fail('INVALID_VALUE', e.message, e.nodeId, e.parameter);
      throw e;
    }
  };

  const signals: SignalContext = {
    node: id => { const x = nodes.get(id); return x ? { id, type: x.node.type, enabled: x.effectiveEnabled } : undefined; },
    param: (id, p) => param(nodes.get(id)!, p),
    source: (nodeId, port) => { const c = into(nodeId, port)[0]; return c && c.source.kind === 'node' ? { nodeId: c.source.nodeId, port: c.source.port } : undefined; },
    window: nodeId => { const c = into(nodeId, 'window')[0], s = c && c.source.kind === 'node' ? nodes.get(c.source.nodeId) : undefined; return s && s.node.type === 'Schedule' ? { startTicks: num(s, 'startTicks'), durationTicks: num(s, 'durationTicks') } : undefined; },
    constant: nodeId => { const x = nodes.get(nodeId); if (x?.node.type === 'Constant') return num(x, 'value'); throw new SignalError(`${x?.node.type ?? 'Node'} "${nodeId}" cannot feed a time signal in the path preview; use Constant or a literal.`, nodeId); },
  };
  const memo = new Map<string, NodeOutputs>();
  /** Nodes whose evaluation already reported; a second consumer fails silently (one diagnostic per node). */
  const failed = new Set<string>();
  const pathsInto = (consumerId: string, port: string): PathData[] => {
    const cs = into(consumerId, port);
    if (cs.length === 0) return []; // Empty expansion source: empty path set.
    if (cs.length > 1) return fail('MULTIPLE_DRIVERS', `Input "${port}" of "${consumerId}" resolves to ${cs.length} path sources; connect one.`, consumerId);
    const s = cs[0].source;
    const src = sourceNode(s, consumerId, port);
    const out = evalNode(src).get(s.kind === 'node' ? s.port : '');
    if (!out) return fail('UNKNOWN_NODE', `Output "${s.kind === 'node' ? s.port : ''}" of "${src.node.id}" is not a path output.`, src.node.id);
    return out;
  };

  const evalNode = (n: ExpandedNode): NodeOutputs => {
    const cached = memo.get(n.node.id);
    if (cached) return cached;
    if (failed.has(n.node.id)) throw new Fail('already reported');
    try {
      return evalUncached(n);
    } catch (e) {
      if (e instanceof Fail) failed.add(n.node.id);
      throw e;
    }
  };
  const evalUncached = (n: ExpandedNode): NodeOutputs => {
    const id = n.node.id;
    const on = n.effectiveEnabled;
    let out: NodeOutputs;
    switch (n.node.type) {
      case 'LinePath':
      case 'BezierPath': {
        if (!on) { out = new Map([['paths', []]]); break; }
        noDrivenParams(n, ENDPOINT_PORTS);
        const start = anchorOf(n, 'start'), end = anchorOf(n, 'end');
        const samples = num(n, 'samples');
        const path = n.node.type === 'LinePath'
          ? guard(id, () => linePath('p0', start, end, samples))
          : guard(id, () => {
            const h0 = param(n, 'startHandle') as Vec3, h1 = param(n, 'endHandle') as Vec3;
            const c0: Vec3 = [start[0] + h0[0], start[1] + h0[1], start[2] + h0[2]];
            const c1: Vec3 = [end[0] + h1[0], end[1] + h1[1], end[2] + h1[2]];
            return bezierPath('p0', start, c0, c1, end, samples);
          });
        out = new Map([['paths', [path]]]);
        break;
      }
      case 'HelixPath': {
        if (!on) { out = new Map([['paths', []]]); break; }
        noDrivenParams(n, ENDPOINT_PORTS);
        const start = anchorOf(n, 'start'), end = anchorOf(n, 'end');
        const opts = { radius: num(n, 'radius'), turns: num(n, 'turns'), phase: num(n, 'phase') + num(n, 'spin') * seconds, taper: param(n, 'taper') as HelixTaper, samples: num(n, 'samples') };
        out = new Map([['paths', [guard(id, () => helixPath('p0', start, end, opts))]]]);
        break;
      }
      case 'MergePaths': {
        if (!on) { out = new Map([['paths', []]]); break; }
        // Inputs in edge order; each input's ids get its index so merged ids stay unique and stable.
        const merged: PathData[] = [];
        into(id, 'paths').forEach((c, i) => {
          const src = sourceNode(c.source, id, 'paths'), set = evalNode(src).get(c.source.kind === 'node' ? c.source.port : '');
          if (!set) fail('UNKNOWN_NODE', `Output of "${src.node.id}" feeding MergePaths "${id}" is not a path output.`, src.node.id);
          for (const p of set as PathData[]) merged.push({ ...p, id: `m${i}-${p.id}` });
        });
        out = new Map([['paths', merged]]);
        break;
      }
      case 'PathTransform': {
        const input = pathsInto(id, 'paths');
        if (!on) { out = new Map([['paths', input]]); break; }
        noDrivenParams(n, MODIFIER_PORTS);
        const q = param(n, 'rotation') as [number, number, number, number], ql = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
        const qn: [number, number, number, number] = [q[0] / ql, q[1] / ql, q[2] / ql, q[3] / ql];
        out = new Map([['paths', guard(id, () => input.map(p => transformPath(p, param(n, 'offset') as Vec3, qn, num(n, 'scale'))))]]);
        break;
      }
      case 'ParticlePaths': {
        if (!on) { out = new Map([['paths', []]]); break; }
        noDrivenParams(n, ['particles', 'anchor']);
        const cs = into(id, 'particles');
        if (cs.length !== 1 || cs[0].source.kind !== 'node') fail('MISSING_REFERENCE', `ParticlePaths "${id}" needs exactly one particle source.`, id);
        const anchor = anchorOf(n, 'anchor');
        if (particleProbeDepth > 2) fail('GRAPH_CYCLE', `ParticlePaths "${id}" feeds the motion of its own particle source.`, id);
        particleProbeDepth++;
        let sys;
        try { sys = probeParticleSystem(input, (cs[0].source as { nodeId: string }).nodeId); } finally { particleProbeDepth--; }
        if (!sys.ok) { errors.push(...sys.errors); throw new Fail('particle source'); }
        const desc = sys.value.systems[0]?.descriptor;
        const alive = desc ? particlesAtTick(desc, effectTick) : [];
        if (typeof alive === 'string') fail('INVALID_VALUE', `ParticlePaths "${id}" particle source failed: ${alive}`, id);
        const t = doc.rootTransform, q = t.rotation, inv: Quaternion = [-q[0], -q[1], -q[2], q[3]];
        const toLocal = (p: Vec3): Vec3 => { const r = rotate(inv, [p[0] - t.position[0], p[1] - t.position[1], p[2] - t.position[2]]); return [r[0] / t.scale, r[1] / t.scale, r[2] / t.scale]; };
        const pick = [...(alive as ParticleState[])].map(p => ({ p, h: fnv1a32Utf8(`${n.node.randomStreamId}:${p.id}`) }))
          .sort((a, b) => a.h - b.h || (a.p.id < b.p.id ? -1 : 1)).slice(0, num(n, 'maxCount'));
        const toAnchor = param(n, 'direction') === 'particleToAnchor', samples = num(n, 'samples');
        out = new Map([['paths', pick.map(({ p }) => guard(id, () => {
          const pl = toLocal(p.position);
          return linePath(p.id, toAnchor ? pl : anchor, toAnchor ? anchor : pl, samples);
        }))]]);
        break;
      }
      case 'JaggedPath': {
        const input = pathsInto(id, 'paths');
        if (!on) { out = new Map([['paths', input]]); break; } // Bypass.
        noDrivenParams(n, MODIFIER_PORTS);
        const opts = {
          documentSeed: doc.seed, randomStreamId: n.node.randomStreamId, amplitude: num(n, 'amplitude'),
          samples: num(n, 'samples'), regenerationHz: num(n, 'regenerationHz'), effectLocalSeconds: seconds,
          pinned: param(n, 'pinned') as boolean,
        };
        out = new Map([['paths', guard(id, () => input.map((p, i) => jaggedPath(p, { ...opts, pathOrdinal: i })))]]);
        break;
      }
      case 'RevealPath': {
        const input = pathsInto(id, 'paths');
        if (!on) { out = new Map([['paths', input]]); break; }
        noDrivenParams(n, [...MODIFIER_PORTS, 'fraction']);
        const fraction = drivenScalar(n, 'fraction');
        out = new Map([['paths', guard(id, () => input.map(p => revealPath(p, fraction)))]]);
        break;
      }
      case 'BranchPath': {
        const input = pathsInto(id, 'paths');
        if (!on) { out = new Map([['trunk', input], ['branches', []]]); break; } // Trunk passes through.
        noDrivenParams(n, MODIFIER_PORTS);
        const count = num(n, 'count');
        const mode = param(n, 'countMode') as BranchCountMode;
        const projected = mode === 'perParent' ? count * input.length : count;
        if (totalPaths + input.length + projected > MAX_PREVIEW_PATHS) {
          fail('BUDGET_EXCEEDED', `BranchPath "${id}" would create up to ${projected} branches, exceeding the ${MAX_PREVIEW_PATHS}-path preview limit.`, id, 'count');
        }
        const r = guard(id, () => branchPaths(input, {
          documentSeed: doc.seed, randomStreamId: n.node.randomStreamId, count, countMode: mode,
          attachmentMin: num(n, 'attachmentMin'), attachmentMax: num(n, 'attachmentMax'),
          lengthMin: num(n, 'lengthMin'), lengthMax: num(n, 'lengthMax'), spread: num(n, 'spread'),
          widthMin: num(n, 'widthMin'), widthMax: num(n, 'widthMax'),
          opacityMin: num(n, 'opacityMin'), opacityMax: num(n, 'opacityMax'),
          groundEndClamp: param(n, 'groundEndClamp') as boolean, groundY: num(n, 'groundY'),
        }));
        out = new Map([['trunk', r.trunks], ['branches', r.branches]]);
        break;
      }
      case 'RadialPath': {
        if (!on) { out = new Map([['paths', []]]); break; }
        noDrivenParams(n, RADIAL_PORTS);
        if (into(id, 'window').length) fail('INVALID_VALUE', `RadialPath "${id}" window input is not supported by the path preview yet; gate visibility with the RibbonRenderer window.`, id);
        const center = anchorOf(n, 'center');
        out = new Map([['paths', guard(id, () => radialPaths(center, {
          documentSeed: doc.seed, randomStreamId: n.node.randomStreamId, mode: param(n, 'mode') as RadialMode,
          count: num(n, 'count'), lengthMin: num(n, 'lengthMin'), lengthMax: num(n, 'lengthMax'),
          coneAngle: num(n, 'coneAngle'), orientation: param(n, 'orientation') as Quaternion,
        }))]]);
        break;
      }
      case 'RingPath': {
        if (!on) { out = new Map([['paths', []]]); break; }
        noDrivenParams(n, ['center', 'radiusScale']);
        const center = anchorOf(n, 'center');
        const radiusScale = drivenScalar(n, 'radiusScale');
        out = new Map([['paths', [guard(id, () => ringPath(center, {
          radius: num(n, 'radius'), minRadius: num(n, 'minRadius'), radiusScale,
          samples: num(n, 'samples'), orientation: param(n, 'orientation') as Quaternion,
        }))]]]);
        break;
      }
      default:
        return fail('UNKNOWN_NODE', `Node "${id}" (${n.node.type}) is not supported in a path chain by the path preview.`, id);
    }
    if (on) for (const paths of out.values()) spend(n, paths); // Bypassed sets were already counted upstream.
    memo.set(id, out);
    return out;
  };

  if (options.probe) {
    try {
      const n = nodes.get(options.probe.nodeId);
      if (!n) fail('MISSING_REFERENCE', `Probe node "${options.probe.nodeId}" is not in the expanded graph.`, options.probe.nodeId);
      const out = evalNode(n as ExpandedNode).get(options.probe.port);
      if (!out) fail('UNKNOWN_NODE', `Output "${options.probe.port}" of "${options.probe.nodeId}" is not a path output.`, options.probe.nodeId);
      if (errors.length) return { ok: false, errors };
      return { ok: true, value: { durationTicks: doc.durationTicks, effectTick, layers: [], probe: (out as PathData[]).map(p => toWorld(p, doc.rootTransform)) }, warnings };
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      return { ok: false, errors };
    }
  }

  // ---------- layers ----------
  const transform: Transform = doc.rootTransform;
  const duration = doc.durationTicks;
  const layers: PathPreviewLayer[] = [];
  const done = new Set<string>();
  let emittedPoints = 0;
  const visual = into(outputId, 'visual');
  for (const [visualOrder, c] of visual.entries()) {
    try {
      const r = sourceNode(c.source, outputId, 'visual');
      if (r.node.type === 'BillboardRenderer' || r.node.type === 'ParticleTrail' || r.node.type === 'SpriteRenderer' || r.node.type === 'PropMesh' || r.node.type === 'PointLight' || r.node.type === 'MeshRenderer' || r.node.type === 'MotionTrail') continue; // Particle layers: compileParticlePreview.
      if (done.has(r.node.id) || !r.effectiveEnabled) continue; // Disabled sink (of any type) contributes nothing.
      const isRing = r.node.type === 'RingRenderer';
      if (r.node.type !== 'RibbonRenderer' && !isRing) fail('UNKNOWN_NODE', `Visual source "${r.node.id}" (${r.node.type}) is not supported by the path preview.`, r.node.id);
      done.add(r.node.id);
      const rid = r.node.id;
      noDrivenParams(r, isRing ? ['anchor', 'material', 'window'] : RIBBON_PORTS);

      const mats = into(rid, 'material');
      const mat = mats.length === 1 ? sourceNode(mats[0].source, rid, 'material') : undefined;
      if (!mat || mat.node.type !== 'Material' || !mat.effectiveEnabled) {
        fail('MISSING_REFERENCE', `Required input "material" of "${rid}" needs an enabled Material (a disabled Material acts absent).`, rid);
        continue;
      }
      noDrivenParams(mat, ['opacity']);
      const opacity = drivenScalar(mat, 'opacity');
      let sprite: PathPreviewLayer['sprite'];
      if (param(mat, 'template') === 'SpriteTextured') {
        const r = materialSheet(doc, param(mat, 'sprite'), param(mat, 'textureAsset'));
        if ('error' in r) report('MISSING_REFERENCE', r.error, mat.node.id, r.field);
        else sprite = { sheet: r.sheet, variant: num(mat, 'variant') };
      } else if (param(mat, 'template') !== 'SpriteUnlit') report('INVALID_VALUE', `Material template "${String(param(mat, 'template'))}" is not supported.`, mat.node.id, 'template');

      let window: PathPreviewLayer['window'] = { startTick: 0, endTick: duration }; // Unconnected: whole document (25).
      const ws = into(rid, 'window');
      if (ws.length === 1) {
        const s = sourceNode(ws[0].source, rid, 'window');
        if (s.node.type !== 'Schedule') fail('UNKNOWN_NODE', `RibbonRenderer "${rid}" window source "${s.node.id}" (${s.node.type}) is not supported; use a Schedule.`, rid);
        if (!s.effectiveEnabled) window = null; // Disabled Schedule: no window, never visible.
        else {
          noDrivenParams(s, []);
          if (param(s, 'mode') === 'repeat') fail('INVALID_VALUE', 'A repeating Schedule window is not supported by the path preview; use mode "window" or "once".', s.node.id, 'mode');
          const start = Math.min(duration, num(s, 'startTicks'));
          window = { startTick: start, endTick: Math.min(duration, start + num(s, 'durationTicks')) };
        }
      }

      // 05 RingRenderer: one closed ring at the anchor, radius from its curve at the window progress, rotated by orientation.
      const ringLocal = (): PathData[] => {
        const c = anchorOf(r, 'anchor'), w = window ?? { startTick: 0, endTick: duration };
        const u = Math.min(1, Math.max(0, (effectTick - w.startTick) / Math.max(1, w.endTick - w.startTick)));
        const radius = Math.max(0, evaluateCurve(param(r, 'radius') as CurveValue, u)), n = num(r, 'segments');
        const q = param(r, 'orientation') as [number, number, number, number], ql = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
        const qn: Quaternion = [q[0] / ql, q[1] / ql, q[2] / ql, q[3] / ql];
        const points: Vec3[] = [];
        for (let i = 0; i <= n; i++) {
          const a = (2 * Math.PI * (i % n)) / n, p = rotate(qn, [Math.cos(a) * radius, 0, Math.sin(a) * radius]);
          points.push([c[0] + p[0], c[1] + p[1], c[2] + p[2]]);
        }
        return radius > 0 ? [{ id: `${rid}:ring`, points, widthScale: 1, opacityScale: 1 }] : [];
      };
      const local = isRing ? ringLocal() : pathsInto(rid, 'paths');
      const active = window !== null && effectTick < duration && effectTick >= window.startTick && effectTick < window.endTick;
      const scale = transform.scale;
      if (active) {
        // Evaluation is memoized, but every layer emits its own world-space copy: count those too.
        for (const p of local) emittedPoints += p.points.length;
        if (emittedPoints > MAX_PREVIEW_POINTS) fail('BUDGET_EXCEEDED', `Path preview would emit ${emittedPoints} world-space path points across ribbons; the limit is ${MAX_PREVIEW_POINTS}. Reduce ribbons sharing a path output, samples or branch counts.`, rid);
      }
      layers.push({
        nodeId: rid,
        window,
        active,
        paths: active ? local.map(p => toWorld(p, transform)) : [],
        width: num(r, 'width') * scale,
        widthOverPath: isRing ? { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] } : structuredClone(param(r, 'widthOverPath') as CurveValue),
        endFade: isRing ? 0 : num(r, 'endFade'),
        uvMode: isRing ? 'stretch' : param(r, 'uvMode') as PathPreviewLayer['uvMode'],
        uvTileLength: isRing ? scale : num(r, 'uvTileLength') * scale,
        orientation: isRing ? 'camera' : param(r, 'orientation') as PathPreviewLayer['orientation'],
        renderOrderOffset: num(r, 'renderOrderOffset'),
        visualOrder,
        color: { ...(param(mat, 'tint') as ColorValue) },
        opacity,
        emission: num(mat, 'emission'),
        blend: param(mat, 'blend') as PathPreviewLayer['blend'],
        alphaCutoff: num(mat, 'alphaCutoff'),
        liquid: num(mat, 'liquid'),
        hueShift: num(mat, 'hueShift'),
        ...(sprite ? { sprite } : {}),
        ...((): Pick<PathPreviewLayer, 'uvAnim'> => {
          const sc = param(mat, 'uvScroll') as [number, number], dist = num(mat, 'uvDistort');
          return sprite && (sc[0] !== 0 || sc[1] !== 0 || dist > 0) ? { uvAnim: { scroll: [sc[0], sc[1]], distort: dist } } : {};
        })(),
      });
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { durationTicks: duration, effectTick, layers }, warnings };
}

/** world = rotation * (scale * p) + position, applied once per point. */
function toWorld(path: PathData, t: Transform): PathData {
  const points = path.points.map((p): Vec3 => {
    const r = rotate(t.rotation, [p[0] * t.scale, p[1] * t.scale, p[2] * t.scale]);
    return [r[0] + t.position[0], r[1] + t.position[1], r[2] + t.position[2]];
  });
  return { id: path.id, points, widthScale: path.widthScale, opacityScale: path.opacityScale };
}

/** Rotates v by quaternion q (xyzw, normalized here). Same formula as toParticles.ts. */
function rotate(q: Quaternion, v: Vec3): Vec3 {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const qx = q[0] / n, qy = q[1] / n, qz = q[2] / n, qw = q[3] / n;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}
