// Graph-to-particle preview adapter (WP03-PREVIEW-ADAPTER.md, claude-model). Pure compiler:
// createRegistry → analyzeGraph → expandGroups → point-emitter descriptors plus flat billboard layers.
// No DOM, React or Three. The input is never mutated (analysis works on a clone).
//
// Scope is deliberately narrow: only reachable BillboardRenderer sinks at the root EffectOutput.visual,
// fed by an Emitter (shape point/cone/sphere/disc/box, space world, one anchor, optional aim anchor) through InitialProperties chains, with
// Schedule triggers/windows. Anything else that is reachable returns an addressed error instead of being
// ignored or approximated.
//
// Decisions:
// - Particle-chain identity is the terminal *enabled* node of the chain (last enabled InitialProperties,
//   else the Emitter). Billboards whose chains end at the same node share one system; its systemId is
//   that node ID. The descriptor keeps the original emitter node ID and randomStreamId.
// - The last enabled InitialProperties (closest to the renderer) supplies size and color; every enabled
//   InitialProperties in the chain must still carry neutral rotation/angular velocity and no random frame.
// - Gravity/Drag modifiers anywhere in the chain become descriptor operators in upstream-to-downstream
//   (declared) order; a disabled modifier bypasses. Gravity is world-space and scaled by the root transform
//   scale only (it is not rotated with the effect). Chain identity is the modifier closest to the renderer.
// - Any non-empty connection into a parameter port, and any exposed-control driver, is rejected until
//   expression evaluation exists.
// - Schedule event keys are scheduleEventRandomKey(stream, tick, repeatOrdinal); start and end ticks of
//   one repeat always differ (durationTicks >= 1), so no extra tag is needed. Duplicate keys (the same
//   Schedule output wired twice) are a DUPLICATE_ID error.
import type { ColorValue, CurveValue, Diagnostic, ErrorCode, GradientValue, ParameterValue, Quaternion, Transform, ValidationResult, Vec3 } from '../model/types.ts';
import { TICKS_PER_SECOND } from '../model/types.ts';
import { registryKey } from '../model/controls.ts';
import { particleEventRandomKey, sampleUnit, scheduleEventRandomKey } from '../runtime/random.ts';
import {
  DEFAULT_MAX_BURST_EVENTS, DEFAULT_MAX_LIVE_PARTICLES, DEFAULT_MAX_TOTAL_BIRTHS, collectParticleEvents, validateParticleDescriptor,
  type ParticleBurst, type ParticleEmitterDescriptor, type ParticleOperator, type ParticleRate,
} from '../runtime/particles.ts';
import { analyzeGraph } from './analyze.ts';
import { expandGroups, type ExpandedConnection, type ExpandedGraph, type ExpandedNode, type ExpandedSource } from './expand.ts';
import { createRegistry } from './registry.ts';
import { materialSheet } from './materialSprite.ts';
import { lifeCurveError, OPACITY_OVER_LIFE_BOUNDS, SIZE_OVER_LIFE_BOUNDS } from '../render/billboardLife.ts';
import { BUILTIN_SPRITES } from '../assets/builtinSprites.generated.ts';
import { compilePathPreview } from './toPaths.ts';
import { ease, pointAtArcFraction, type Easing } from '../runtime/paths.ts';
import type { FlipbookMode, SpriteSheet } from '../assets/spriteLibrary.ts';

import { EFFECT_TIME_NODES, effectTimeValue } from './effectTime.ts';

/** Value nodes evaluated once per cast when they drive a parameter port. */
const VALUE_NODES = new Set(['RandomRange', 'Constant', 'ScalarMath']);

export type ParticlePreviewSystem = { id: string; descriptor: ParticleEmitterDescriptor };
export type ParticlePreviewLayer = {
  /** BillboardRenderer node ID. */
  nodeId: string;
  systemId: string;
  /** InitialProperties.color × Material.tint, multiplied in linear RGB, returned as encoded sRGB; alpha multiplied. */
  color: ColorValue;
  opacity: number;
  emission: number;
  blend: 'normal' | 'additive' | 'cutout';
  alphaCutoff: number;
  renderOrderOffset: number;
  /** Index of this sink's first connection among root EffectOutput.visual connections (shared with ribbon layers). */
  visualOrder: number;
  /** Validated normalized-age size multiplier, y in [0,20]; sample with render/billboardLife.ts. */
  sizeOverLife: CurveValue;
  /** Validated normalized-age opacity multiplier, y in [0,1]. */
  opacityOverLife: CurveValue;
  /** Colour × alpha multiplier over normalized age; document validation owns stop rules. */
  colorOverLife: GradientValue;
  alignment: 'camera' | 'velocity' | 'worldAxis';
  /** Unit normal the quad faces for worldAxis alignment. */
  worldAxis: Vec3;
  /** Quad length multiplier along its local up axis (velocity direction when velocity-aligned). */
  stretchRatio: number;
  /** Particle position along the stretch axis: 0 trailing end, 1 leading tip. */
  pivot: number;
  /** Present for SpriteTextured materials: the library sheet and how cells are chosen. */
  sprite?: { sheet: SpriteSheet; mode: FlipbookMode; fps: number; randomStart: boolean; variant: number };
};
/** 05 ParticleTrail sink: ribbon trails behind one particle system's particles. */
export type ParticleTrailLayer = {
  nodeId: string; systemId: string; historyTicks: number; maxPoints: number; width: number; endFade: number;
  color: ColorValue; opacity: number; emission: number; blend: 'normal' | 'additive' | 'cutout'; alphaCutoff: number;
  renderOrderOffset: number; visualOrder: number;
};
/** 05 PointLight: lights the preview ground over its window. */
export type PointLightLayer = {
  nodeId: string; position: Vec3; color: ColorValue; intensity: number; range: number;
  /** Moving light (PathFollower anchor): world position per tick from startTick, clamped. */
  track?: { startTick: number; positions: Vec3[] };
  startTick: number; endTick: number; intensityOverWindow: CurveValue; flicker: number; flickerRate: number; seed: number;
};
/** 05 MeshRenderer: instanced built-in mesh per particle. */
export type MeshLayer = {
  nodeId: string; systemId: string; mesh: 'shard' | 'rock-a' | 'rock-b' | 'rock-c' | 'orb' | 'cone'; scale: number;
  orientation: 'tumble' | 'velocity'; lit: boolean; color: ColorValue; opacity: number; emission: number; blend: 'normal' | 'additive' | 'cutout';
  sizeOverLife: CurveValue; colorOverLife: GradientValue; renderOrderOffset: number; visualOrder: number;
};
/** 05 presentation: screen flashes and camera impulses at event ticks (preview-only, reduced-motion aware). */
export type PresentationPlan = {
  flashes: { nodeId: string; tick: number; durationTicks: number; color: ColorValue; alpha: number }[];
  impulses: { nodeId: string; tick: number; durationTicks: number; translation: number; rotation: number; seed: number }[];
};
export type ParticlePreviewPlan = {
  durationTicks: number;
  /** One per distinct particle chain, in first-use order of layers. */
  systems: ParticlePreviewSystem[];
  /** In root EffectOutput.visual connection order. */
  layers: ParticlePreviewLayer[];
  /** ParticleTrail sinks, in root EffectOutput.visual connection order. */
  trails: ParticleTrailLayer[];
  lights: PointLightLayer[];
  meshes: MeshLayer[];
  presentation: PresentationPlan;
};

export const DEFAULT_PREVIEW_SIZE = { min: 0.08, max: 0.16 } as const;

const EMITTER_PORTS = ['anchor', 'paths', 'trigger', 'window', 'aim'];
const BILLBOARD_PORTS = ['particles', 'material'];
const IP_PORTS = ['particles'];
const FORCE_TYPES = ['Gravity', 'Drag', 'NoiseForce', 'Attract', 'Vortex', 'GroundCollision'];

class Fail extends Error {}

export type ParticlePreviewOptions = {
  /**
   * Set only when the caller has separately compiled and validated the root EffectOutput.audio graph
   * (e.g. with the audio compiler) and will act on its result. The visual compile then ignores the
   * root audio edge instead of reporting it; it never validates audio itself. Default false.
   * Presentation connections are errors regardless.
   */
  audioHandled?: boolean;
  /**
   * Set only when the caller also compiles RibbonRenderer sinks (compilePathPreview) and draws them. The
   * point compile then skips root RibbonRenderer sinks instead of reporting them. Default false.
   */
  ribbonsHandled?: boolean;
  /** Compile only the particle chain ending at this node (ParticlePaths input) and return it as the single system; no layers. */
  probeParticles?: string;
};

export function compileParticlePreview(input: unknown, options: ParticlePreviewOptions = {}): ValidationResult<ParticlePreviewPlan> {
  const registry = createRegistry();
  const analysis = analyzeGraph(input, { registry });
  if (!analysis.ok) return analysis;
  const expansion = expandGroups(analysis.value);
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
  const param = (n: ExpandedNode, id: string): ParameterValue => {
    const dv = drivenValue(n, id);
    if (dv !== undefined) return dv;
    const v = params.get(`${n.node.id}\u0000${id}`);
    if (v !== undefined) return v;
    const spec = registry.get(registryKey(n.node.type, n.node.definitionVersion))?.parameters.find(p => p.id === id);
    if (!spec) return fail('MISSING_REFERENCE', `Parameter "${id}" of "${n.node.id}" is not registered.`, n.node.id, id);
    return spec.default;
  };
  const num = (n: ExpandedNode, id: string) => param(n, id) as number;
  /** Value nodes feeding a parameter port (RandomRange, Constant, ScalarMath): evaluated once per cast. Undefined when not driven by one. */
  const valueSource = (nodeId: string, port: string): ExpandedNode | undefined => {
    const c = x.connections.find(e => e.target.nodeId === nodeId && e.target.port === port && e.source.kind === 'node');
    if (!c || c.source.kind !== 'node') return undefined;
    const src = nodes.get(c.source.nodeId);
    return src && VALUE_NODES.has(src.node.type) && src.effectiveEnabled ? src : undefined;
  };
  const valueOf = (src: ExpandedNode, depth: number): number => {
    if (depth > 32) return fail('INVALID_VALUE', `Value chain through "${src.node.id}" is too deep.`, src.node.id);
    if (src.node.type === 'Constant') return param(src, 'value') as number;
    if (src.node.type === 'RandomRange') {
      const lo = param(src, 'min') as number, hi = param(src, 'max') as number;
      const u = sampleUnit({ documentSeed: doc.seed, randomStreamId: src.node.randomStreamId, eventRandomKey: 'value', entityOrdinal: 0, propertyKey: 'value', sampleOrdinal: 0 });
      return Math.min(lo, hi) + u * Math.abs(hi - lo);
    }
    const operand = (id: string) => { const s = valueSource(src.node.id, id); return s ? valueOf(s, depth + 1) : param(src, id) as number; };
    const a = operand('a'), b = operand('b');
    switch (param(src, 'operation')) {
      case 'subtract': return a - b;
      case 'multiply': return a * b;
      case 'divide': return b === 0 ? fail('INVALID_VALUE', `ScalarMath "${src.node.id}" divides by zero.`, src.node.id, 'b') : a / b;
      case 'min': return Math.min(a, b);
      case 'max': return Math.max(a, b);
      default: return a + b;
    }
  };
  const drivenValue = (n: ExpandedNode, id: string): number | undefined => {
    const src = valueSource(n.node.id, id);
    if (!src) return undefined;
    const v = valueOf(src, 0);
    const spec = registry.get(registryKey(n.node.type, n.node.definitionVersion))?.parameters.find(p => p.id === id);
    return spec?.type === 'integer' ? Math.round(v) : v;
  };
  /** Rejects any non-empty connection into a port that is not one of the node's structural inputs. */
  const noDrivenParams = (n: ExpandedNode, structural: string[]) => {
    for (const c of x.connections) {
      if (c.target.nodeId !== n.node.id || structural.includes(c.target.port) || c.source.kind === 'empty') continue;
      if (c.source.kind === 'node' && VALUE_NODES.has(nodes.get(c.source.nodeId)?.node.type ?? '')) continue; // Resolved by drivenValue.
      report('DOMAIN_MISMATCH', `Input "${c.target.port}" of "${n.node.id}" is driven by a connection; connected/animated parameters are not supported by the point preview yet. Disconnect it and set a literal.`, n.node.id, c.target.port);
    }
  };
  const sourceNode = (s: ExpandedSource, consumer: string, port: string): ExpandedNode => {
    if (s.kind !== 'node') return fail('INVALID_VALUE', `Input "${port}" of "${consumer}" receives a literal group default; only node connections are supported here.`, consumer);
    const n = nodes.get(s.nodeId);
    if (!n) return fail('MISSING_REFERENCE', `Source node "${s.nodeId}" of "${consumer}.${port}" is not in the expanded graph.`, consumer);
    return n;
  };

  for (const d of x.controlDrivers) {
    report('INVALID_VALUE', `Exposed control "${d.controlId}" of Group "${d.groupNodeId}" is driven by a connection; control expressions are not supported by the point preview yet.`, d.groupNodeId);
  }
  const outputId = x.rootOutputNodeId;
  for (const port of options.audioHandled === true ? [] : ['audio']) {
    if (into(outputId, port).length) report('INVALID_VALUE', `EffectOutput.${port} is connected, but ${port} output is not supported by the point preview yet.`, outputId);
  }

  // ---------- chains and systems ----------
  type Chain = { emitter: ExpandedNode; initial: ExpandedNode | undefined; enabledInitials: ExpandedNode[]; forces: ExpandedNode[]; terminalId: string };
  const traceChain = (billboardId: string): Chain | undefined => {
    const sources = into(billboardId, 'particles');
    if (sources.length === 0) return undefined; // Empty expansion source: no layer.
    if (sources.length > 1) return fail('MULTIPLE_DRIVERS', `BillboardRenderer "${billboardId}" resolves to ${sources.length} particle sources; connect one.`, billboardId);
    return traceFrom(sourceNode(sources[0].source, billboardId, 'particles'), billboardId);
  };
  /** Walks upstream from `start` (a modifier or the Emitter itself) to the Emitter. */
  const traceFrom = (start: ExpandedNode, owner: string): Chain | undefined => {
    let cur = start;
    const enabledInitials: ExpandedNode[] = [];
    const forces: ExpandedNode[] = []; // Renderer-to-emitter order while tracing.
    let terminal: string | undefined;
    for (let guard = 0; guard <= nodes.size; guard++) {
      const n = cur.node;
      if (n.type === 'InitialProperties' || FORCE_TYPES.includes(n.type)) {
        if (cur.effectiveEnabled) { // Disabled modifier bypasses.
          terminal ??= n.id;
          (n.type === 'InitialProperties' ? enabledInitials : forces).push(cur);
        }
        const up = into(n.id, 'particles');
        if (up.length === 0) return undefined;
        if (up.length > 1) return fail('MULTIPLE_DRIVERS', `${n.type} "${n.id}" resolves to ${up.length} particle sources.`, n.id);
        cur = sourceNode(up[0].source, n.id, 'particles');
        continue;
      }
      if (n.type === 'Emitter') {
        if (!cur.effectiveEnabled) return undefined; // Disabled Emitter emits nothing.
        const initial = enabledInitials[0];
        return { emitter: cur, initial, enabledInitials, forces: forces.reverse(), terminalId: terminal ?? n.id };
      }
      return fail('UNKNOWN_NODE', `Node "${n.id}" (${n.type}) is not supported in a particle chain by the point preview.`, n.id);
    }
    return fail('GRAPH_CYCLE', `Particle chain of "${owner}" does not terminate at an Emitter.`, owner);
  };

  const transform: Transform = doc.rootTransform;
  const anchorPos = new Map(doc.anchors.map(a => [a.id, a.position]));
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
    return [b[0] + o[0], b[1] + o[1], b[2] + o[2]];
  };
  /** 05 EventDelay / MergeEvents: follows a trigger connection back to its producers, summing delays. */
  type RoutedEvent = { c: ExpandedConnection; delay: number; consumer: string };
  const routeEvents = (c: ExpandedConnection, consumer: string, port: string, delay = 0, depth = 0): RoutedEvent[] => {
    const src = sourceNode(c.source, consumer, port);
    if (src.node.type !== 'EventDelay' && src.node.type !== 'MergeEvents') return [{ c, delay, consumer }];
    if (depth > 16) return fail('GRAPH_CYCLE', `Event routing into "${consumer}" is nested deeper than 16 levels.`, src.node.id);
    if (src.node.type === 'MergeEvents' && !src.effectiveEnabled) return [];
    noDrivenParams(src, ['events']);
    const d = src.node.type === 'EventDelay' && src.effectiveEnabled ? num(src, 'delayTicks') : 0;
    return into(src.node.id, 'events').flatMap(u => routeEvents(u, src.node.id, 'events', delay + d, depth + 1));
  };
  const scheduleOf = (c: ExpandedConnection, emitterId: string, port: string): ExpandedNode | undefined => {
    const s = sourceNode(c.source, emitterId, port);
    if (s.node.type !== 'Schedule') return fail('UNKNOWN_NODE', `Emitter "${emitterId}" ${port} source "${s.node.id}" (${s.node.type}) is not supported; use a Schedule.`, emitterId);
    noDrivenParams(s, []);
    return s.effectiveEnabled ? s : undefined; // Disabled Schedule emits no events/window.
  };

  /**
   * 05 PathFollower: position along the first path of its input set, sampled per tick from the window start
   * (probe compiles of the path graph), eased over durationTicks, held at the end until the window closes.
   */
  type Track = { startTick: number; positions: Vec3[]; arrivalTick: number; arrivalPos: Vec3 };
  const tracks = new Map<string, Track | null>();
  const followerTrack = (f: ExpandedNode): Track | undefined => {
    const fid = f.node.id;
    if (tracks.has(fid)) return tracks.get(fid) ?? undefined;
    tracks.set(fid, null);
    if (!f.effectiveEnabled) return undefined;
    noDrivenParams(f, ['paths', 'window']);
    const ws = into(fid, 'window');
    if (ws.length !== 1) return fail('MISSING_REFERENCE', `PathFollower "${fid}" needs a Schedule window.`, fid);
    const s = scheduleOf(ws[0], fid, 'window');
    if (!s) return undefined;
    const start = num(s, 'startTicks'), end = Math.min(doc.durationTicks, start + num(s, 'durationTicks'));
    const ps = into(fid, 'paths');
    if (ps.length !== 1 || ps[0].source.kind !== 'node') return fail('MISSING_REFERENCE', `PathFollower "${fid}" needs one connected path source.`, fid);
    const src = ps[0].source, travel = num(f, 'durationTicks'), easing = param(f, 'easing') as Easing;
    const positions: Vec3[] = [];
    let last: Vec3 | undefined;
    for (let tk = start; tk < end; tk++) {
      const u = (tk - start) / travel;
      if (u <= 1 || !last) {
        const r = compilePathPreview(input, tk, { audioHandled: true, probe: { nodeId: src.nodeId, port: src.port } });
        if (!r.ok) { errors.push(...r.errors.map(e => ({ ...e, nodeId: e.nodeId ?? fid }))); return undefined; }
        const path = r.value.probe?.[0];
        if (!path || path.points.length === 0) return fail('MISSING_REFERENCE', `PathFollower "${fid}" path source produced no path at tick ${tk}.`, fid);
        last = pointAtArcFraction(path.points, ease(easing, Math.min(1, u)));
      }
      positions.push([last[0], last[1], last[2]]);
    }
    if (!positions.length) return undefined;
    const t: Track = { startTick: start, positions, arrivalTick: start + travel, arrivalPos: positions[Math.min(travel, positions.length - 1)] };
    tracks.set(fid, t);
    return t;
  };

  /**
   * Child emission (05 ParticleEvents, GroundCollision.collision): the parent chain is compiled and
   * simulated once (deterministic), and each selected event becomes one burst at the event tick.
   */
  const particleEventBursts = (src: ExpandedNode, port: string, childId: string, count: number, usePosition: boolean, depth: number, inherit = 0): ParticleBurst[] => {
    if (depth > 4) return fail('GRAPH_CYCLE', `Particle event chain into "${childId}" is nested deeper than 4 levels.`, childId);
    noDrivenParams(src, src.node.type === 'ParticleEvents' ? IP_PORTS : IP_PORTS);
    let start: ExpandedNode | undefined = src;
    if (src.node.type === 'ParticleEvents') {
      const up = into(src.node.id, 'particles');
      if (up.length !== 1) return up.length ? fail('MULTIPLE_DRIVERS', `ParticleEvents "${src.node.id}" resolves to ${up.length} particle sources.`, src.node.id) : [];
      start = sourceNode(up[0].source, src.node.id, 'particles');
    }
    const chain = traceFrom(start, src.node.id);
    if (!chain) return [];
    const before = errors.length;
    const parent = buildDescriptor(chain, depth + 1);
    if (errors.length !== before) return [];
    const ev = collectParticleEvents(parent);
    if (!ev.ok) { errors.push(...ev.errors.map(e => ({ ...e, nodeId: src.node.id }))); return []; }
    const kind = src.node.type === 'GroundCollision' ? 'collision' : port;
    let events = ev.value.filter(e => e.kind === kind && e.tick < doc.durationTicks);
    if (src.node.type === 'ParticleEvents') {
      const p = num(src, 'probability');
      if (p < 1) events = events.filter(e => sampleUnit({ documentSeed: doc.seed, randomStreamId: src.node.randomStreamId, eventRandomKey: particleEventRandomKey(e.parentRandomKey, e.kind, e.ordinal), entityOrdinal: 0, propertyKey: 'probability', sampleOrdinal: 0 }) < p);
      events = events.slice(0, num(src, 'maxEvents'));
    } else if (events.length > DEFAULT_MAX_BURST_EVENTS) {
      report('BUDGET_EXCEEDED', `GroundCollision "${src.node.id}" produces ${events.length} collision events; the limit is ${DEFAULT_MAX_BURST_EVENTS}. Route them through ParticleEvents-style thinning (lower rate or kill mode) — nothing is silently dropped.`, src.node.id);
      return [];
    }
    if (count <= 0) return [];
    return events.map(e => ({ tick: e.tick, eventRandomKey: particleEventRandomKey(e.parentRandomKey, e.kind, e.ordinal), count, ...(usePosition ? { position: [e.position[0], Math.max(0, e.position[1]), e.position[2]] as Vec3 } : {}), ...(inherit > 0 ? { addVelocity: [e.velocity[0] * inherit, e.velocity[1] * inherit, e.velocity[2] * inherit] as Vec3 } : {}) }));
  };

  const buildDescriptor = (chain: Chain, depth = 0): ParticleEmitterDescriptor => {
    const em = chain.emitter;
    const id = em.node.id;
    noDrivenParams(em, EMITTER_PORTS);
    const shape = param(em, 'shape') as string;
    if (shape === 'path') report('INVALID_VALUE', 'Emitter shape "path" is not supported yet; use point, cone, sphere, disc or box.', id, 'shape');
    if (param(em, 'space') !== 'world') report('INVALID_VALUE', 'Emitter local space is not supported by the point preview; use "world".', id, 'space');
    if (into(id, 'paths').length) report('INVALID_VALUE', 'Emitter paths input is not supported by the point preview; connect an anchor.', id);
    const speedMin = num(em, 'speedMin'), speedMax = num(em, 'speedMax');

    for (const ip of chain.enabledInitials) {
      noDrivenParams(ip, IP_PORTS);
    }

    // Position: a real anchor is required; Schedule events carry no position.
    let local: Vec3 = [0, 0, 0];
    const anchors = into(id, 'anchor');
    const anchorNode = anchors.length === 1 ? sourceNode(anchors[0].source, id, 'anchor') : undefined;
    const triggerSources = into(id, 'trigger').flatMap(c => routeEvents(c, id, 'trigger')).map(r => sourceNode(r.c.source, r.consumer, 'trigger'));
    const eventOnly = triggerSources.length > 0 && into(id, 'window').length === 0 && param(em, 'useEventPosition') === true
      && triggerSources.every(s => s.node.type === 'ParticleEvents' || s.node.type === 'GroundCollision' || s.node.type === 'PathFollower');
    const track = anchorNode?.node.type === 'PathFollower' ? followerTrack(anchorNode) : undefined;
    const sp = anchorNode && !track ? staticAnchor(anchorNode) : undefined;
    if (track) { /* Moving source: positions come from the follower track. */ } else if (!sp) {
      if (!eventOnly) report('MISSING_REFERENCE', 'Emitter needs an enabled Anchor (or OffsetAnchor) referencing an existing document anchor on its anchor input (Schedule events carry no position; particle events do when Use event position is on).', id);
    } else local = sp;

    const duration = doc.durationTicks;
    const bursts: ParticleBurst[] = [];
    const burst = num(em, 'burst');
    const seen = new Set<string>();
    for (const { c, delay, consumer } of into(id, 'trigger').flatMap(c => routeEvents(c, id, 'trigger'))) {
      const src = sourceNode(c.source, consumer, 'trigger');
      if (src.node.type === 'PathFollower') {
        const t = followerTrack(src);
        const at = t ? t.arrivalTick + delay : duration;
        if (!t || at >= duration || burst <= 0) continue;
        const key = JSON.stringify(['arrival', src.node.randomStreamId, at]);
        if (seen.has(key)) continue;
        seen.add(key);
        bursts.push({ tick: at, eventRandomKey: key, count: burst, ...(param(em, 'useEventPosition') === true ? { position: [...t.arrivalPos] as Vec3 } : {}) });
        continue;
      }
      if (src.node.type === 'ParticleEvents' || src.node.type === 'GroundCollision') {
        if (!src.effectiveEnabled) continue;
        for (const b0 of particleEventBursts(src, c.source.kind === 'node' ? c.source.port : '', id, burst, param(em, 'useEventPosition') === true, depth, num(em, 'inheritVelocity'))) {
          const b = delay ? { ...b0, tick: b0.tick + delay, eventRandomKey: `${b0.eventRandomKey}+${delay}` } : b0;
          if (b.tick >= duration) continue;
          if (seen.has(b.eventRandomKey)) continue;
          seen.add(b.eventRandomKey);
          bursts.push(b);
        }
        continue;
      }
      const s = scheduleOf(c, consumer, 'trigger');
      if (!s) continue;
      const start = num(s, 'startTicks'), len = num(s, 'durationTicks');
      const repeat = param(s, 'mode') === 'repeat';
      const count = repeat ? num(s, 'repeatCount') : 1;
      const interval = repeat ? num(s, 'repeatIntervalTicks') : 0;
      const port = c.source.kind === 'node' ? c.source.port : '';
      for (let k = 0; k < count; k++) {
        const tick = start + k * interval + (port === 'end' ? len : 0) + delay;
        if (tick >= duration) break; // Document end (inclusive) empties all outputs.
        const key = scheduleEventRandomKey(s.node.randomStreamId, tick, k);
        if (seen.has(key)) { report('DUPLICATE_ID', `Schedule "${s.node.id}" event at tick ${tick} reaches Emitter "${id}" more than once; distinct event IDs are not implemented yet.`, id); continue; }
        seen.add(key);
        if (burst > 0) bursts.push({ tick, eventRandomKey: key, count: burst });
      }
    }

    let rate: ParticleRate | undefined;
    const windows = into(id, 'window');
    const perSecond = num(em, 'rate');
    if (windows.length === 1) {
      const s = scheduleOf(windows[0], id, 'window');
      if (s && param(s, 'mode') === 'repeat') report('INVALID_VALUE', 'A repeating Schedule window is not supported by the point preview; use mode "window" or "once".', s.node.id, 'mode');
      else if (s && perSecond > 0) {
        const startTick = num(s, 'startTicks');
        if (startTick < duration) {
          rate = { perSecond, startTick, endTick: Math.min(duration, startTick + num(s, 'durationTicks')) };
          const rc = param(em, 'rateOverWindow') as CurveValue, rerr = lifeCurveError(rc, { min: 0, max: 4 });
          if (rerr !== undefined) report('INVALID_VALUE', `Emitter "${id}" rateOverWindow: ${rerr}`, id, 'rateOverWindow');
          else if (!rc.keys.every(k => k.y === 1)) {
            if (rc.interpolation === 'hold') report('INVALID_VALUE', 'Emitter rateOverWindow supports linear interpolation only.', id, 'rateOverWindow');
            rate.curve = rc.keys.map(k => ({ x: k.x, y: k.y }));
          }
        }
      }
    }

    const scale = transform.scale;
    /** Force Strength: a per-tick gain track when an enabled EffectTimeCurve drives it, otherwise a constant (literal or value node). */
    const strengthOf = (f: ExpandedNode): { k: number; gain?: number[] } => {
      const cs = into(f.node.id, 'strength');
      const src = cs.length === 1 && cs[0].source.kind === 'node' ? nodes.get(cs[0].source.nodeId) : undefined;
      if (!src || !EFFECT_TIME_NODES.has(src.node.type)) return { k: num(f, 'strength') };
      if (!src.effectiveEnabled) return { k: num(f, 'strength') };
      noDrivenParams(src, []);
      const curve = src.node.type === 'EffectTimeCurve' ? param(src, 'curve') as CurveValue : { domain: 'effectSeconds' };
      if (curve?.domain !== 'effectSeconds') { report('DOMAIN_MISMATCH', `EffectTimeCurve "${src.node.id}" curve must use domain "effectSeconds".`, src.node.id, 'curve'); return { k: 1 }; }
      try {
        return { k: 1, gain: Array.from({ length: doc.durationTicks + 1 }, (_, t) => effectTimeValue(src.node.type, k => param(src, k), t / TICKS_PER_SECOND)) };
      } catch (e) {
        if (e instanceof RangeError || e instanceof TypeError) { report('INVALID_VALUE', `${src.node.type} "${src.node.id}": ${e.message}`, src.node.id, 'curve'); return { k: 1 }; }
        throw e;
      }
    };
    const operators: ParticleOperator[] = chain.forces.map((f): ParticleOperator => {
      const op = forceOperator(f);
      if (f.node.type === 'GroundCollision') return op;
      const s = strengthOf(f);
      if (s.gain) return { ...op, gain: s.gain } as ParticleOperator;
      if (s.k === 1) return op;
      if (op.kind === 'gravity') return { ...op, acceleration: [op.acceleration[0] * s.k, op.acceleration[1] * s.k, op.acceleration[2] * s.k] };
      if (op.kind === 'drag') return { ...op, coefficient: op.coefficient * s.k };
      if (op.kind === 'noise') return { ...op, amplitude: op.amplitude * s.k };
      if (op.kind === 'attract') return { ...op, acceleration: op.acceleration * s.k };
      if (op.kind === 'vortex') return { ...op, tangential: op.tangential * s.k, inward: op.inward * s.k };
      return op;
    });
    function forceOperator(f: ExpandedNode): ParticleOperator {
      noDrivenParams(f, [...IP_PORTS, 'anchor', 'strength']);
      if (f.node.type === 'Drag') return { kind: 'drag', coefficient: num(f, 'coefficient') };
      if (f.node.type === 'Attract' || f.node.type === 'Vortex') {
        const an = into(f.node.id, 'anchor'), anode = an.length === 1 ? sourceNode(an[0].source, f.node.id, 'anchor') : undefined;
        const ap = anode ? staticAnchor(anode) : undefined;
        if (!ap) { report('MISSING_REFERENCE', `${f.node.type} "${f.node.id}" needs an enabled Anchor referencing an existing document anchor.`, f.node.id); return { kind: 'drag', coefficient: 0 }; }
        const q = rotate(transform.rotation, [ap[0] * scale, ap[1] * scale, ap[2] * scale]);
        const center: Vec3 = [q[0] + transform.position[0], q[1] + transform.position[1], q[2] + transform.position[2]];
        if (f.node.type === 'Attract') return { kind: 'attract', center, acceleration: num(f, 'acceleration') * scale, softRadius: num(f, 'softRadius') * scale, killRadius: num(f, 'killRadius') * scale };
        const ax = param(f, 'axis') as Vec3, al = Math.hypot(ax[0], ax[1], ax[2]);
        if (!(al > 1e-9)) { report('INVALID_VALUE', 'Vortex axis must be nonzero.', f.node.id, 'axis'); return { kind: 'drag', coefficient: 0 }; }
        return { kind: 'vortex', center, axis: rotate(transform.rotation, [ax[0] / al, ax[1] / al, ax[2] / al]), tangential: num(f, 'tangential') * scale, inward: num(f, 'inward') * scale, falloff: num(f, 'falloff') * scale };
      }
      if (f.node.type === 'NoiseForce') return { kind: 'noise', mode: param(f, 'mode') as 'vector' | 'curl', amplitude: num(f, 'amplitude') * scale, frequency: num(f, 'frequency') / scale, evolution: num(f, 'evolution'), randomStreamId: f.node.randomStreamId };
      if (f.node.type === 'GroundCollision') {
        return { kind: 'ground', mode: param(f, 'mode') as 'kill' | 'slide' | 'bounce', restitution: num(f, 'restitution'), friction: num(f, 'friction'), maxBounces: num(f, 'maxBounces') };
      }
      const a = param(f, 'acceleration') as Vec3;
      return { kind: 'gravity', acceleration: [a[0] * scale, a[1] * scale, a[2] * scale] };
    }
    const dir = param(em, 'direction') as Vec3;
    const k = (speedMin * scale) / Math.hypot(dir[0], dir[1], dir[2]);
    let velocity = rotate(transform.rotation, [dir[0] * k, dir[1] * k, dir[2] * k]);
    const r = rotate(transform.rotation, [local[0] * scale, local[1] * scale, local[2] * scale]);
    const worldOf = (p: Vec3): Vec3 => { const q = rotate(transform.rotation, [p[0] * scale, p[1] * scale, p[2] * scale]); return [q[0] + transform.position[0], q[1] + transform.position[1], q[2] + transform.position[2]]; };
    const source = worldOf(local);
    const dl = Math.hypot(dir[0], dir[1], dir[2]);
    let axis: Vec3 = rotate(transform.rotation, [dir[0] / dl, dir[1] / dl, dir[2] / dl]);
    const aims = into(id, 'aim');
    if (aims.length === 1) {
      const an = sourceNode(aims[0].source, id, 'aim');
      const ap = staticAnchor(an);
      if (!ap) report('MISSING_REFERENCE', 'Emitter aim needs an enabled Anchor referencing an existing document anchor.', id);
      else {
        const t = worldOf(ap), v: Vec3 = [t[0] - source[0], t[1] - source[1], t[2] - source[2]], l = Math.hypot(v[0], v[1], v[2]);
        if (l < 1e-9) report('INVALID_VALUE', 'Emitter aim anchor coincides with the emitter position; direction is undefined.', id);
        else { axis = [v[0] / l, v[1] / l, v[2] / l]; velocity = [axis[0] * speedMin * scale, axis[1] * speedMin * scale, axis[2] * speedMin * scale]; }
      }
    }
    const nl = Math.hypot(axis[0], axis[1], axis[2]);
    axis = [axis[0] / nl, axis[1] / nl, axis[2] / nl];
    const shaped = shape !== 'point' || speedMin !== speedMax;
    const size = chain.initial ? { min: num(chain.initial, 'sizeMin'), max: num(chain.initial, 'sizeMax') } : DEFAULT_PREVIEW_SIZE;
    const ticks = (s: number) => Math.max(1, Math.floor(s * TICKS_PER_SECOND + 0.5));
    const d: ParticleEmitterDescriptor = {
      documentSeed: doc.seed,
      durationTicks: duration,
      emitterId: id,
      randomStreamId: em.node.randomStreamId,
      shape: (shape === 'path' ? 'point' : shape) as ParticleEmitterDescriptor['shape'],
      sourcePosition: [r[0] + transform.position[0], r[1] + transform.position[1], r[2] + transform.position[2]],
      initialVelocity: { kind: 'vector', value: velocity },
      bursts,
      lifetimeTicks: { min: ticks(num(em, 'lifetimeMin')), max: ticks(num(em, 'lifetimeMax')) },
      size: { min: size.min * scale, max: size.max * scale },
      operators,
    };
    if (rate) d.rate = rate;
    if (track) { d.sourcePosition = [...track.positions[0]] as Vec3; d.sourceTrack = { startTick: track.startTick, positions: track.positions.map(p => [...p] as Vec3) }; }
    if (chain.initial) {
      const ip = chain.initial, r = [num(ip, 'rotationMin'), num(ip, 'rotationMax')], w = [num(ip, 'angularVelocityMin'), num(ip, 'angularVelocityMax')];
      if (r[0] > r[1]) report('INVALID_VALUE', 'InitialProperties rotationMin must be <= rotationMax.', ip.node.id, 'rotationMax');
      if (w[0] > w[1]) report('INVALID_VALUE', 'InitialProperties angularVelocityMin must be <= angularVelocityMax.', ip.node.id, 'angularVelocityMax');
      if (r.some(v => v !== 0) || w.some(v => v !== 0)) d.spin = { rotation: { min: r[0], max: r[1] }, angularVelocity: { min: w[0], max: w[1] } };
    }
    if (shaped && shape !== 'path') d.emission = { shape: d.shape, axis, radius: num(em, 'radius') * scale, coneAngle: num(em, 'coneAngle'), speed: { min: speedMin * scale, max: speedMax * scale } };
    return d;
  };

  if (options.probeParticles !== undefined) {
    const empty = { durationTicks: doc.durationTicks, layers: [], trails: [], lights: [], meshes: [], presentation: { flashes: [], impulses: [] } };
    try {
      const n = nodes.get(options.probeParticles);
      if (!n) return fail('MISSING_REFERENCE', `Probe node "${options.probeParticles}" is not in the expanded graph.`, options.probeParticles);
      const chain = traceFrom(n, n.node.id);
      if (!chain) return { ok: true, value: { ...empty, systems: [] }, warnings };
      const d = buildDescriptor(chain);
      if (errors.length) return { ok: false, errors };
      const v = validateParticleDescriptor(d);
      if (!v.ok) return { ok: false, errors: v.errors.map(e => ({ ...e, nodeId: e.nodeId ?? n.node.id })) };
      return { ok: true, value: { ...empty, systems: [{ id: chain.terminalId, descriptor: v.value }] }, warnings };
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      return { ok: false, errors };
    }
  }

  // ---------- layers ----------
  const systems: ParticlePreviewSystem[] = [];
  const layers: ParticlePreviewLayer[] = [];
  const trails: ParticleTrailLayer[] = [];
  const lights: PointLightLayer[] = [];
  const meshes: MeshLayer[] = [];
  const done = new Set<string>();
  const visual = into(outputId, 'visual');
  for (const [visualOrder, c] of visual.entries()) {
    try {
      const b = sourceNode(c.source, outputId, 'visual');
      if (options.ribbonsHandled === true && b.node.type === 'RibbonRenderer') continue; // Ribbon layers: compilePathPreview.
      if (done.has(b.node.id) || !b.effectiveEnabled) continue; // Disabled sink contributes nothing.
      if (b.node.type === 'MotionTrail') {
        // A ribbon behind a (moving) anchor: one particle attached to the anchor/follower track over the window.
        done.add(b.node.id);
        const tid = b.node.id;
        noDrivenParams(b, ['anchor', 'material', 'window']);
        const mats = into(tid, 'material');
        const mat = mats.length === 1 ? sourceNode(mats[0].source, tid, 'material') : undefined;
        if (!mat || mat.node.type !== 'Material' || !mat.effectiveEnabled) { fail('MISSING_REFERENCE', `Required input "material" of "${tid}" needs an enabled Material.`, tid); }
        const m = mat as ExpandedNode;
        const an = into(tid, 'anchor'), anchorNode = an.length === 1 ? sourceNode(an[0].source, tid, 'anchor') : undefined;
        const track = anchorNode?.node.type === 'PathFollower' ? followerTrack(anchorNode) : undefined;
        const ap = anchorNode ? staticAnchor(anchorNode) : undefined;
        if (!ap && !track) { fail('MISSING_REFERENCE', `MotionTrail "${tid}" needs an enabled Anchor or PathFollower.`, tid); }
        const ws = into(tid, 'window');
        if (ws.length !== 1) { fail('MISSING_REFERENCE', `MotionTrail "${tid}" needs a Schedule window.`, tid); }
        const s = scheduleOf(ws[0], tid, 'window');
        if (!s) continue;
        const start = num(s, 'startTicks'), len = Math.max(1, Math.min(num(s, 'durationTicks'), doc.durationTicks - start));
        if (start >= doc.durationTicks) continue;
        const scale = transform.scale, a = (ap ?? [0, 0, 0]) as Vec3, q = rotate(transform.rotation, [a[0] * scale, a[1] * scale, a[2] * scale]);
        const d: ParticleEmitterDescriptor = {
          documentSeed: doc.seed, durationTicks: doc.durationTicks, emitterId: tid, randomStreamId: b.node.randomStreamId, shape: 'point',
          sourcePosition: track ? [...track.positions[0]] as Vec3 : [q[0] + transform.position[0], q[1] + transform.position[1], q[2] + transform.position[2]],
          initialVelocity: { kind: 'vector', value: [0, 0, 0] }, bursts: [{ tick: start, eventRandomKey: scheduleEventRandomKey(s.node.randomStreamId, start, 0), count: 1 }],
          lifetimeTicks: { min: len, max: len }, size: { min: 0, max: 0 }, operators: [],
          ...(track ? { sourceTrack: { startTick: track.startTick, positions: track.positions.map(p => [...p] as Vec3) }, attachToSource: true } : {}),
        };
        const v = validateParticleDescriptor(d);
        if (!v.ok) { errors.push(...v.errors.map(e => ({ ...e, nodeId: tid }))); continue; }
        systems.push({ id: tid, descriptor: v.value });
        trails.push({
          nodeId: tid, systemId: tid, historyTicks: Math.max(1, Math.round(num(b, 'history') * TICKS_PER_SECOND)), maxPoints: num(b, 'maxPoints'),
          width: num(b, 'width') * scale, endFade: num(b, 'endFade'), color: param(m, 'tint') as ColorValue, opacity: num(m, 'opacity'), emission: num(m, 'emission'),
          blend: param(m, 'blend') as ParticleTrailLayer['blend'], alphaCutoff: num(m, 'alphaCutoff'), renderOrderOffset: num(b, 'renderOrderOffset'), visualOrder,
        });
        continue;
      }
      if (b.node.type === 'MeshRenderer') {
        done.add(b.node.id);
        const mid = b.node.id;
        noDrivenParams(b, BILLBOARD_PORTS);
        const mats = into(mid, 'material');
        const mat = mats.length === 1 ? sourceNode(mats[0].source, mid, 'material') : undefined;
        if (!mat || mat.node.type !== 'Material' || !mat.effectiveEnabled) { fail('MISSING_REFERENCE', `Required input "material" of "${mid}" needs an enabled Material.`, mid); }
        const m = mat as ExpandedNode;
        const chain = traceChain(mid);
        if (!chain) continue;
        if (!systems.some(s => s.id === chain.terminalId)) {
          const before = errors.length;
          const d = buildDescriptor(chain);
          if (errors.length === before) {
            const v = validateParticleDescriptor(d);
            if (!v.ok) errors.push(...v.errors.map(e => ({ ...e, nodeId: chain.emitter.node.id })));
            else systems.push({ id: chain.terminalId, descriptor: v.value });
          }
        }
        const sc = param(b, 'sizeOverLife') as CurveValue, serr = lifeCurveError(sc, SIZE_OVER_LIFE_BOUNDS);
        if (serr !== undefined) report('INVALID_VALUE', `MeshRenderer "${mid}" sizeOverLife: ${serr}`, mid, 'sizeOverLife');
        const base = chain.initial ? param(chain.initial, 'color') as ColorValue : { srgb: '#FFFFFF', alpha: 1 };
        meshes.push({
          nodeId: mid, systemId: chain.terminalId, mesh: param(b, 'mesh') as MeshLayer['mesh'], scale: num(b, 'scale'), orientation: param(b, 'orientation') as MeshLayer['orientation'],
          lit: param(b, 'lit') === true, color: multiplyColors(base, param(m, 'tint') as ColorValue), opacity: num(m, 'opacity'), emission: num(m, 'emission'), blend: param(m, 'blend') as MeshLayer['blend'],
          sizeOverLife: structuredClone(sc), colorOverLife: structuredClone(param(b, 'colorOverLife') as GradientValue), renderOrderOffset: num(b, 'renderOrderOffset'), visualOrder,
        });
        continue;
      }
      if (b.node.type === 'PointLight') {
        done.add(b.node.id);
        const lid = b.node.id;
        noDrivenParams(b, ['anchor', 'window']);
        const an = into(lid, 'anchor'), anchorNode = an.length === 1 ? sourceNode(an[0].source, lid, 'anchor') : undefined;
        const ltrack = anchorNode?.node.type === 'PathFollower' ? followerTrack(anchorNode) : undefined;
        const ap = anchorNode ? staticAnchor(anchorNode) : undefined;
        if (!ap && !ltrack) { fail('MISSING_REFERENCE', `PointLight "${lid}" needs an enabled Anchor (or PathFollower) referencing an existing document anchor.`, lid); }
        const ws = into(lid, 'window');
        if (ws.length !== 1) { fail('MISSING_REFERENCE', `PointLight "${lid}" needs a Schedule window.`, lid); }
        const s = scheduleOf(ws[0], lid, 'window');
        if (!s) continue;
        const start = num(s, 'startTicks');
        if (start >= doc.durationTicks) continue;
        const curve = param(b, 'intensityOverWindow') as CurveValue, cerr = lifeCurveError(curve, { min: 0, max: 1 });
        if (cerr !== undefined) report('INVALID_VALUE', `PointLight "${lid}" intensityOverWindow: ${cerr}`, lid, 'intensityOverWindow');
        const scale = transform.scale, a = (ap ?? [0, 0, 0]) as Vec3, q = rotate(transform.rotation, [a[0] * scale, a[1] * scale, a[2] * scale]);
        lights.push({
          ...(ltrack ? { track: { startTick: ltrack.startTick, positions: ltrack.positions.map(p => [...p] as Vec3) } } : {}),
          nodeId: lid, position: [q[0] + transform.position[0], q[1] + transform.position[1], q[2] + transform.position[2]], color: param(b, 'color') as ColorValue,
          intensity: num(b, 'intensity'), range: num(b, 'range') * scale, startTick: start, endTick: Math.min(doc.durationTicks, start + num(s, 'durationTicks')),
          intensityOverWindow: structuredClone(curve), flicker: num(b, 'flicker'), flickerRate: num(b, 'flickerRate'),
          seed: sampleUnit({ documentSeed: doc.seed, randomStreamId: b.node.randomStreamId, eventRandomKey: 'light', entityOrdinal: 0, propertyKey: 'flicker', sampleOrdinal: 0 }) * 4294967296 >>> 0,
        });
        continue;
      }
      if (b.node.type === 'SpriteRenderer') {
        // A sprite is a one-particle system: born at the window start, living for the window length.
        done.add(b.node.id);
        const sid = b.node.id;
        noDrivenParams(b, ['anchor', 'material', 'window']);
        const mats = into(sid, 'material');
        const mat = mats.length === 1 ? sourceNode(mats[0].source, sid, 'material') : undefined;
        if (!mat || mat.node.type !== 'Material' || !mat.effectiveEnabled) { fail('MISSING_REFERENCE', `Required input "material" of "${sid}" needs an enabled Material.`, sid); }
        const m = mat as ExpandedNode;
        const an = into(sid, 'anchor'), anchorNode = an.length === 1 ? sourceNode(an[0].source, sid, 'anchor') : undefined;
        const strack = anchorNode?.node.type === 'PathFollower' ? followerTrack(anchorNode) : undefined;
        const ap = anchorNode ? staticAnchor(anchorNode) : undefined;
        if (!ap && !strack) { fail('MISSING_REFERENCE', `SpriteRenderer "${sid}" needs an enabled Anchor (or PathFollower) referencing an existing document anchor.`, sid); }
        const ws = into(sid, 'window');
        if (ws.length !== 1) { fail('MISSING_REFERENCE', `SpriteRenderer "${sid}" needs a Schedule window.`, sid); }
        const s = scheduleOf(ws[0], sid, 'window');
        if (!s) continue; // Disabled Schedule: nothing shown.
        if (param(s, 'mode') === 'repeat') report('INVALID_VALUE', 'A repeating Schedule window is not supported for SpriteRenderer yet; use mode "window" or "once".', s.node.id, 'mode');
        const start = num(s, 'startTicks'), len = Math.max(1, Math.min(num(s, 'durationTicks'), doc.durationTicks - start));
        if (start >= doc.durationTicks) continue;
        const scale = transform.scale, a = (ap ?? [0, 0, 0]) as Vec3, q = rotate(transform.rotation, [a[0] * scale, a[1] * scale, a[2] * scale]);
        const rot = num(b, 'rotation'), spin = num(b, 'spin');
        const d: ParticleEmitterDescriptor = {
          documentSeed: doc.seed, durationTicks: doc.durationTicks, emitterId: sid, randomStreamId: b.node.randomStreamId, shape: 'point',
          sourcePosition: [q[0] + transform.position[0], q[1] + transform.position[1], q[2] + transform.position[2]], initialVelocity: { kind: 'vector', value: [0, 0, 0] },
          bursts: [{ tick: start, eventRandomKey: scheduleEventRandomKey(s.node.randomStreamId, start, 0), count: 1 }],
          lifetimeTicks: { min: len, max: len }, size: { min: num(b, 'size') * scale, max: num(b, 'size') * scale }, operators: [],
          ...(rot !== 0 || spin !== 0 ? { spin: { rotation: { min: rot, max: rot }, angularVelocity: { min: spin, max: spin } } } : {}),
        };
        if (strack) { d.sourcePosition = [...strack.positions[0]] as Vec3; d.sourceTrack = { startTick: strack.startTick, positions: strack.positions.map(p => [...p] as Vec3) }; d.attachToSource = true; }
        const v = validateParticleDescriptor(d);
        if (!v.ok) { errors.push(...v.errors.map(e => ({ ...e, nodeId: sid }))); continue; }
        systems.push({ id: sid, descriptor: v.value });
        const curve = (id: string, bounds: { min: number; max: number }): CurveValue => {
          const c = param(b, id) as CurveValue, err = lifeCurveError(c, bounds);
          if (err !== undefined) report('INVALID_VALUE', `SpriteRenderer "${sid}" ${id}: ${err}`, sid, id);
          return structuredClone(c);
        };
        let sprite: ParticlePreviewLayer['sprite'];
        if (param(m, 'template') === 'SpriteTextured') {
          const r = materialSheet(doc, param(m, 'sprite'), param(m, 'textureAsset'));
          if ('error' in r) report('MISSING_REFERENCE', r.error, m.node.id, r.field);
          else sprite = { sheet: r.sheet, mode: 'overLife', fps: 24, randomStart: false, variant: num(m, 'variant') };
        }
        layers.push({
          nodeId: sid, systemId: sid, color: param(m, 'tint') as ColorValue, opacity: num(m, 'opacity'), emission: num(m, 'emission'),
          blend: param(m, 'blend') as ParticlePreviewLayer['blend'], alphaCutoff: num(m, 'alphaCutoff'), renderOrderOffset: num(b, 'renderOrderOffset'), visualOrder,
          sizeOverLife: curve('sizeOverWindow', SIZE_OVER_LIFE_BOUNDS), opacityOverLife: curve('opacityOverWindow', OPACITY_OVER_LIFE_BOUNDS),
          colorOverLife: structuredClone(param(b, 'colorOverWindow') as GradientValue), stretchRatio: 1, pivot: 0.5,
          ...((): Pick<ParticlePreviewLayer, 'alignment' | 'worldAxis'> => { const w = param(b, 'worldAxis') as Vec3, l = Math.hypot(w[0], w[1], w[2]); return param(b, 'alignment') === 'worldAxis' && l > 1e-9 ? { alignment: 'worldAxis', worldAxis: rotate(transform.rotation, [w[0] / l, w[1] / l, w[2] / l]) } : { alignment: 'camera', worldAxis: [0, 1, 0] }; })(), ...(sprite ? { sprite } : {}),
        });
        continue;
      }
      if (b.node.type === 'ParticleTrail') {
        done.add(b.node.id);
        const tid = b.node.id;
        noDrivenParams(b, BILLBOARD_PORTS);
        const mats = into(tid, 'material');
        const mat = mats.length === 1 ? sourceNode(mats[0].source, tid, 'material') : undefined;
        if (!mat || mat.node.type !== 'Material' || !mat.effectiveEnabled) { fail('MISSING_REFERENCE', `Required input "material" of "${tid}" needs an enabled Material.`, tid); }
        const m = mat as ExpandedNode;
        if (param(m, 'template') === 'SpriteTextured') report('INVALID_VALUE', 'ParticleTrail draws untextured ribbons in the preview; use a SpriteUnlit material.', m.node.id, 'template');
        const chain = traceChain(tid);
        if (!chain) continue;
        if (!systems.some(s => s.id === chain.terminalId)) {
          const before = errors.length;
          const d = buildDescriptor(chain);
          if (errors.length === before) {
            const v = validateParticleDescriptor(d);
            if (!v.ok) errors.push(...v.errors.map(e => ({ ...e, nodeId: chain.emitter.node.id })));
            else systems.push({ id: chain.terminalId, descriptor: v.value });
          }
        }
        const base = chain.initial ? param(chain.initial, 'color') as ColorValue : { srgb: '#FFFFFF', alpha: 1 };
        trails.push({
          nodeId: tid, systemId: chain.terminalId, historyTicks: Math.max(1, Math.round(num(b, 'history') * TICKS_PER_SECOND)), maxPoints: num(b, 'maxPoints'),
          width: num(b, 'width') * transform.scale, endFade: num(b, 'endFade'), color: multiplyColors(base, param(m, 'tint') as ColorValue), opacity: num(m, 'opacity'),
          emission: num(m, 'emission'), blend: param(m, 'blend') as ParticleTrailLayer['blend'], alphaCutoff: num(m, 'alphaCutoff'), renderOrderOffset: num(b, 'renderOrderOffset'), visualOrder,
        });
        continue;
      }
      if (b.node.type !== 'BillboardRenderer') fail('UNKNOWN_NODE', `Visual source "${b.node.id}" (${b.node.type}) is not supported by the point preview.`, b.node.id);
      done.add(b.node.id);
      const bid = b.node.id;
      noDrivenParams(b, BILLBOARD_PORTS);
      const alignment = param(b, 'alignment') as string;
      const wa = param(b, 'worldAxis') as Vec3, wl = Math.hypot(wa[0], wa[1], wa[2]);
      if (alignment === 'worldAxis' && !(wl > 1e-9)) report('INVALID_VALUE', 'Billboard worldAxis must be nonzero.', bid, 'worldAxis');
      const worldAxis: Vec3 = wl > 1e-9 ? rotate(transform.rotation, [wa[0] / wl, wa[1] / wl, wa[2] / wl]) : [0, 1, 0];
      if (param(b, 'softIntersection') !== false) report('INVALID_VALUE', 'Soft intersection is not supported by the point preview; turn it off.', bid, 'softIntersection');
      const lifeCurve = (id: string, bounds: { min: number; max: number }): CurveValue => {
        const curve = param(b, id) as CurveValue;
        const err = lifeCurveError(curve, bounds);
        if (err !== undefined) report('INVALID_VALUE', `BillboardRenderer "${bid}" ${id}: ${err}`, bid, id);
        return structuredClone(curve);
      };
      const sizeOverLife = lifeCurve('sizeOverLife', SIZE_OVER_LIFE_BOUNDS);
      const opacityOverLife = lifeCurve('opacityOverLife', OPACITY_OVER_LIFE_BOUNDS);

      const mats = into(bid, 'material');
      const mat = mats.length === 1 ? sourceNode(mats[0].source, bid, 'material') : undefined;
      if (!mat || mat.node.type !== 'Material' || !mat.effectiveEnabled) {
        return fail('MISSING_REFERENCE', `Required input "material" of "${bid}" needs an enabled Material (a disabled Material acts absent).`, bid);
      }
      noDrivenParams(mat, []);
      const template = param(mat, 'template');
      let sprite: ParticlePreviewLayer['sprite'];
      if (template === 'SpriteTextured') {
        const r = materialSheet(doc, param(mat, 'sprite'), param(mat, 'textureAsset'));
        if ('error' in r) report('MISSING_REFERENCE', r.error, mat.node.id, r.field);
        else sprite = { sheet: r.sheet, mode: param(b, 'flipbookMode') as FlipbookMode, fps: num(b, 'flipbookFps'), randomStart: false, variant: num(mat, 'variant') };
      } else if (template !== 'SpriteUnlit') report('INVALID_VALUE', `Material template "${String(template)}" is not supported.`, mat.node.id, 'template');

      const chain = traceChain(bid);
      if (!chain) continue; // Empty source or disabled Emitter: no particles, no layer.
      if (!systems.some(s => s.id === chain.terminalId)) {
        const before = errors.length;
        const d = buildDescriptor(chain);
        if (errors.length === before) {
          const v = validateParticleDescriptor(d);
          if (!v.ok) errors.push(...v.errors.map(e => ({ ...e, nodeId: chain.emitter.node.id })));
          else systems.push({ id: chain.terminalId, descriptor: v.value });
        }
      }
      const white: ColorValue = { srgb: '#FFFFFF', alpha: 1 };
      const base = chain.initial ? param(chain.initial, 'color') as ColorValue : white;
      layers.push({
        nodeId: bid,
        systemId: chain.terminalId,
        color: multiplyColors(base, param(mat, 'tint') as ColorValue),
        opacity: num(mat, 'opacity'),
        emission: num(mat, 'emission'),
        blend: param(mat, 'blend') as ParticlePreviewLayer['blend'],
        alphaCutoff: num(mat, 'alphaCutoff'),
        renderOrderOffset: num(b, 'renderOrderOffset'),
        visualOrder,
        sizeOverLife,
        opacityOverLife,
        colorOverLife: structuredClone(param(b, 'colorOverLife') as GradientValue),
        alignment: alignment === 'velocity' ? 'velocity' : alignment === 'worldAxis' ? 'worldAxis' : 'camera',
        worldAxis,
        stretchRatio: num(b, 'stretchRatio'),
        pivot: num(b, 'pivot'),
        ...(sprite ? { sprite: { ...sprite, randomStart: chain.initial ? param(chain.initial, 'randomFrameStart') === true : false } } : {}),
      });
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
    }
  }

  // ---------- presentation ----------
  const presentation: PresentationPlan = { flashes: [], impulses: [] };
  for (const c of into(outputId, 'presentation')) {
    try {
      const p = sourceNode(c.source, outputId, 'presentation');
      if (!p.effectiveEnabled) continue;
      if (p.node.type !== 'ScreenFlash' && p.node.type !== 'CameraImpulse') fail('UNKNOWN_NODE', `Presentation source "${p.node.id}" (${p.node.type}) is not supported; use ScreenFlash or CameraImpulse.`, p.node.id);
      noDrivenParams(p, ['trigger']);
      const ticks: number[] = [];
      for (const { c: tc, delay, consumer } of into(p.node.id, 'trigger').flatMap(c => routeEvents(c, p.node.id, 'trigger'))) {
        const s = sourceNode(tc.source, consumer, 'trigger'), port = tc.source.kind === 'node' ? tc.source.port : '';
        if (!s.effectiveEnabled) continue;
        if (s.node.type === 'Schedule') {
          const repeat = param(s, 'mode') === 'repeat', n = repeat ? num(s, 'repeatCount') : 1;
          for (let k = 0; k < n; k++) ticks.push(num(s, 'startTicks') + k * (repeat ? num(s, 'repeatIntervalTicks') : 0) + (port === 'end' ? num(s, 'durationTicks') : 0) + delay);
        } else if (s.node.type === 'PathFollower') { const tr = followerTrack(s); if (tr) ticks.push(tr.arrivalTick + delay); }
        else fail('UNKNOWN_NODE', `${p.node.type} "${p.node.id}" trigger from ${s.node.type} is not supported; use a Schedule or PathFollower arrival.`, p.node.id);
      }
      for (const tick of ticks) {
        if (tick >= doc.durationTicks) continue;
        if (p.node.type === 'ScreenFlash') presentation.flashes.push({ nodeId: p.node.id, tick, durationTicks: num(p, 'durationTicks'), color: param(p, 'color') as ColorValue, alpha: num(p, 'alpha') });
        else presentation.impulses.push({ nodeId: p.node.id, tick, durationTicks: num(p, 'durationTicks'), translation: num(p, 'translation') * transform.scale, rotation: num(p, 'rotation'),
          seed: sampleUnit({ documentSeed: doc.seed, randomStreamId: p.node.randomStreamId, eventRandomKey: String(tick), entityOrdinal: 0, propertyKey: 'shake', sampleOrdinal: 0 }) * 4294967296 >>> 0 });
      }
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
    }
  }

  if (!errors.length) {
    const budget = checkBudget(systems.map(s => s.descriptor), doc.durationTicks);
    if (budget) errors.push(budget);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { durationTicks: doc.durationTicks, systems, layers, trails, lights, meshes, presentation }, warnings };
}

/** Aggregate worst case over all systems: total births and live particles at any tick (plan15 caps). */
function checkBudget(descriptors: ParticleEmitterDescriptor[], duration: number): Diagnostic | undefined {
  const live = new Array<number>(duration).fill(0);
  let total = 0;
  for (const d of descriptors) {
    const births = new Array<number>(duration).fill(0);
    for (const b of d.bursts) births[b.tick] += b.count;
    if (d.rate) {
      let emitted = 0, eligible = 0;
      for (let t = d.rate.startTick; t < d.rate.endTick; t++) {
        const due = Math.floor((++eligible * d.rate.perSecond) / TICKS_PER_SECOND);
        births[t] += due - emitted;
        emitted = due;
      }
    }
    const span = d.lifetimeTicks.max;
    for (let t = 0; t < duration; t++) {
      total += births[t];
      for (let u = t; u < Math.min(duration, t + span); u++) live[u] += births[t];
    }
  }
  if (total > DEFAULT_MAX_TOTAL_BIRTHS) {
    return { code: 'BUDGET_EXCEEDED', severity: 'error', message: `Preview would birth up to ${total} particles in total; the limit is ${DEFAULT_MAX_TOTAL_BIRTHS}. Reduce burst, rate or repeats.` };
  }
  const peak = Math.max(0, ...live);
  if (peak > DEFAULT_MAX_LIVE_PARTICLES) {
    return { code: 'BUDGET_EXCEEDED', severity: 'error', message: `Preview could keep up to ${peak} particles alive at once; the limit is ${DEFAULT_MAX_LIVE_PARTICLES}. Reduce burst, rate or lifetime.` };
  }
  return undefined;
}

/** Rotates v by quaternion q (xyzw, normalized here). */
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

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (l: number) => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);

/** Multiplies two sRGB colors in linear RGB and re-encodes; alphas multiply. */
export function multiplyColors(a: ColorValue, b: ColorValue): ColorValue {
  const channel = (i: number) => {
    const l = toLinear(parseInt(a.srgb.slice(1 + 2 * i, 3 + 2 * i), 16) / 255) * toLinear(parseInt(b.srgb.slice(1 + 2 * i, 3 + 2 * i), 16) / 255);
    const v = Math.round(Math.min(1, Math.max(0, toSrgb(l))) * 255);
    return v.toString(16).toUpperCase().padStart(2, '0');
  };
  return { srgb: `#${channel(0)}${channel(1)}${channel(2)}`, alpha: a.alpha * b.alpha };
}
