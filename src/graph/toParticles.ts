// Graph-to-particle preview adapter (WP03-PREVIEW-ADAPTER.md, claude-model). Pure compiler:
// createRegistry → analyzeGraph → expandGroups → point-emitter descriptors plus flat billboard layers.
// No DOM, React or Three. The input is never mutated (analysis works on a clone).
//
// Scope is deliberately narrow: only reachable BillboardRenderer sinks at the root EffectOutput.visual,
// fed by an Emitter (shape point, space world, one anchor) through InitialProperties chains, with
// Schedule triggers/windows. Anything else that is reachable returns an addressed error instead of being
// ignored or approximated.
//
// Decisions:
// - Particle-chain identity is the terminal *enabled* node of the chain (last enabled InitialProperties,
//   else the Emitter). Billboards whose chains end at the same node share one system; its systemId is
//   that node ID. The descriptor keeps the original emitter node ID and randomStreamId.
// - The last enabled InitialProperties (closest to the renderer) supplies size and color; every enabled
//   InitialProperties in the chain must still carry neutral rotation/angular velocity and no random frame.
// - Any non-empty connection into a parameter port, and any exposed-control driver, is rejected until
//   expression evaluation exists.
// - Schedule event keys are scheduleEventRandomKey(stream, tick, repeatOrdinal); start and end ticks of
//   one repeat always differ (durationTicks >= 1), so no extra tag is needed. Duplicate keys (the same
//   Schedule output wired twice) are a DUPLICATE_ID error.
import type { ColorValue, Diagnostic, ErrorCode, ParameterValue, Quaternion, Transform, ValidationResult, Vec3 } from '../model/types.ts';
import { TICKS_PER_SECOND } from '../model/types.ts';
import { registryKey } from '../model/controls.ts';
import { scheduleEventRandomKey } from '../runtime/random.ts';
import {
  DEFAULT_MAX_LIVE_PARTICLES, DEFAULT_MAX_TOTAL_BIRTHS, validateParticleDescriptor,
  type ParticleBurst, type ParticleEmitterDescriptor, type ParticleRate,
} from '../runtime/particles.ts';
import { analyzeGraph } from './analyze.ts';
import { expandGroups, type ExpandedConnection, type ExpandedGraph, type ExpandedNode, type ExpandedSource } from './expand.ts';
import { createRegistry } from './registry.ts';

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
};
export type ParticlePreviewPlan = {
  durationTicks: number;
  /** One per distinct particle chain, in first-use order of layers. */
  systems: ParticlePreviewSystem[];
  /** In root EffectOutput.visual connection order. */
  layers: ParticlePreviewLayer[];
};

export const DEFAULT_PREVIEW_SIZE = { min: 0.08, max: 0.16 } as const;

const EMITTER_PORTS = ['anchor', 'paths', 'trigger', 'window'];
const BILLBOARD_PORTS = ['particles', 'material'];
const IP_PORTS = ['particles'];

class Fail extends Error {}

export function compileParticlePreview(input: unknown): ValidationResult<ParticlePreviewPlan> {
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
    const v = params.get(`${n.node.id}\u0000${id}`);
    if (v !== undefined) return v;
    const spec = registry.get(registryKey(n.node.type, n.node.definitionVersion))?.parameters.find(p => p.id === id);
    if (!spec) return fail('MISSING_REFERENCE', `Parameter "${id}" of "${n.node.id}" is not registered.`, n.node.id, id);
    return spec.default;
  };
  const num = (n: ExpandedNode, id: string) => param(n, id) as number;
  /** Rejects any non-empty connection into a port that is not one of the node's structural inputs. */
  const noDrivenParams = (n: ExpandedNode, structural: string[]) => {
    for (const c of x.connections) {
      if (c.target.nodeId !== n.node.id || structural.includes(c.target.port) || c.source.kind === 'empty') continue;
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
  for (const port of ['audio', 'presentation']) {
    if (into(outputId, port).length) report('INVALID_VALUE', `EffectOutput.${port} is connected, but ${port} output is not supported by the point preview yet.`, outputId);
  }

  // ---------- chains and systems ----------
  type Chain = { emitter: ExpandedNode; initial: ExpandedNode | undefined; enabledInitials: ExpandedNode[]; terminalId: string };
  const traceChain = (billboardId: string): Chain | undefined => {
    const sources = into(billboardId, 'particles');
    if (sources.length === 0) return undefined; // Empty expansion source: no layer.
    if (sources.length > 1) return fail('MULTIPLE_DRIVERS', `BillboardRenderer "${billboardId}" resolves to ${sources.length} particle sources; connect one.`, billboardId);
    let cur = sourceNode(sources[0].source, billboardId, 'particles');
    const enabledInitials: ExpandedNode[] = [];
    for (let guard = 0; guard <= nodes.size; guard++) {
      const n = cur.node;
      if (n.type === 'InitialProperties') {
        if (cur.effectiveEnabled) enabledInitials.push(cur); // Disabled modifier bypasses.
        const up = into(n.id, 'particles');
        if (up.length === 0) return undefined;
        if (up.length > 1) return fail('MULTIPLE_DRIVERS', `InitialProperties "${n.id}" resolves to ${up.length} particle sources.`, n.id);
        cur = sourceNode(up[0].source, n.id, 'particles');
        continue;
      }
      if (n.type === 'Emitter') {
        if (!cur.effectiveEnabled) return undefined; // Disabled Emitter emits nothing.
        const initial = enabledInitials[0];
        return { emitter: cur, initial, enabledInitials, terminalId: initial ? initial.node.id : n.id };
      }
      return fail('UNKNOWN_NODE', `Node "${n.id}" (${n.type}) is not supported in a particle chain by the point preview.`, n.id);
    }
    return fail('GRAPH_CYCLE', `Particle chain of "${billboardId}" does not terminate at an Emitter.`, billboardId);
  };

  const transform: Transform = doc.rootTransform;
  const anchorPos = new Map(doc.anchors.map(a => [a.id, a.position]));
  const scheduleOf = (c: ExpandedConnection, emitterId: string, port: string): ExpandedNode | undefined => {
    const s = sourceNode(c.source, emitterId, port);
    if (s.node.type !== 'Schedule') return fail('UNKNOWN_NODE', `Emitter "${emitterId}" ${port} source "${s.node.id}" (${s.node.type}) is not supported; use a Schedule.`, emitterId);
    noDrivenParams(s, []);
    return s.effectiveEnabled ? s : undefined; // Disabled Schedule emits no events/window.
  };

  const buildDescriptor = (chain: Chain): ParticleEmitterDescriptor => {
    const em = chain.emitter;
    const id = em.node.id;
    noDrivenParams(em, EMITTER_PORTS);
    if (param(em, 'shape') !== 'point') report('INVALID_VALUE', `Emitter shape "${String(param(em, 'shape'))}" is not supported by the point preview; use "point".`, id, 'shape');
    if (param(em, 'space') !== 'world') report('INVALID_VALUE', 'Emitter local space is not supported by the point preview; use "world".', id, 'space');
    if (into(id, 'paths').length) report('INVALID_VALUE', 'Emitter paths input is not supported by the point preview; connect an anchor.', id);
    const speedMin = num(em, 'speedMin'), speedMax = num(em, 'speedMax');
    if (speedMin !== speedMax) report('INVALID_VALUE', `Emitter speed range ${speedMin}..${speedMax} is not supported yet; set speedMin equal to speedMax.`, id, 'speedMax');

    for (const ip of chain.enabledInitials) {
      noDrivenParams(ip, IP_PORTS);
      for (const k of ['rotationMin', 'rotationMax', 'angularVelocityMin', 'angularVelocityMax']) {
        if (num(ip, k) !== 0) report('INVALID_VALUE', `InitialProperties ${k} = ${num(ip, k)} is not supported yet (particles have no rotation); set it to 0.`, ip.node.id, k);
      }
      if (param(ip, 'randomFrameStart') !== false) report('INVALID_VALUE', 'randomFrameStart is not supported by the point preview (no flipbook); turn it off.', ip.node.id, 'randomFrameStart');
    }

    // Position: a real anchor is required; Schedule events carry no position.
    let local: Vec3 = [0, 0, 0];
    const anchors = into(id, 'anchor');
    const anchorNode = anchors.length === 1 ? sourceNode(anchors[0].source, id, 'anchor') : undefined;
    if (!anchorNode || anchorNode.node.type !== 'Anchor' || !anchorNode.effectiveEnabled) {
      report('MISSING_REFERENCE', 'Point emitter needs an enabled Anchor connected to its anchor input (Schedule events carry no position).', id);
    } else {
      const aid = param(anchorNode, 'anchorId') as string;
      const p = anchorPos.get(aid);
      if (!p) report('MISSING_REFERENCE', `Document anchor "${aid}" does not exist.`, anchorNode.node.id, 'anchorId');
      else local = p;
    }

    const duration = doc.durationTicks;
    const bursts: ParticleBurst[] = [];
    const burst = num(em, 'burst');
    const seen = new Set<string>();
    for (const c of into(id, 'trigger')) {
      const s = scheduleOf(c, id, 'trigger');
      if (!s) continue;
      const start = num(s, 'startTicks'), len = num(s, 'durationTicks');
      const repeat = param(s, 'mode') === 'repeat';
      const count = repeat ? num(s, 'repeatCount') : 1;
      const interval = repeat ? num(s, 'repeatIntervalTicks') : 0;
      const port = c.source.kind === 'node' ? c.source.port : '';
      for (let k = 0; k < count; k++) {
        const tick = start + k * interval + (port === 'end' ? len : 0);
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
        if (startTick < duration) rate = { perSecond, startTick, endTick: Math.min(duration, startTick + num(s, 'durationTicks')) };
      }
    }

    const scale = transform.scale;
    const dir = param(em, 'direction') as Vec3;
    const k = (speedMin * scale) / Math.hypot(dir[0], dir[1], dir[2]);
    const velocity = rotate(transform.rotation, [dir[0] * k, dir[1] * k, dir[2] * k]);
    const r = rotate(transform.rotation, [local[0] * scale, local[1] * scale, local[2] * scale]);
    const size = chain.initial ? { min: num(chain.initial, 'sizeMin'), max: num(chain.initial, 'sizeMax') } : DEFAULT_PREVIEW_SIZE;
    const ticks = (s: number) => Math.max(1, Math.floor(s * TICKS_PER_SECOND + 0.5));
    const d: ParticleEmitterDescriptor = {
      documentSeed: doc.seed,
      durationTicks: duration,
      emitterId: id,
      randomStreamId: em.node.randomStreamId,
      shape: 'point',
      sourcePosition: [r[0] + transform.position[0], r[1] + transform.position[1], r[2] + transform.position[2]],
      initialVelocity: { kind: 'vector', value: velocity },
      bursts,
      lifetimeTicks: { min: ticks(num(em, 'lifetimeMin')), max: ticks(num(em, 'lifetimeMax')) },
      size: { min: size.min * scale, max: size.max * scale },
      operators: [],
    };
    if (rate) d.rate = rate;
    return d;
  };

  // ---------- layers ----------
  const systems: ParticlePreviewSystem[] = [];
  const layers: ParticlePreviewLayer[] = [];
  const done = new Set<string>();
  for (const c of into(outputId, 'visual')) {
    try {
      const b = sourceNode(c.source, outputId, 'visual');
      if (b.node.type !== 'BillboardRenderer') fail('UNKNOWN_NODE', `Visual source "${b.node.id}" (${b.node.type}) is not supported by the point preview.`, b.node.id);
      if (done.has(b.node.id) || !b.effectiveEnabled) continue; // Disabled sink contributes nothing.
      done.add(b.node.id);
      const bid = b.node.id;
      noDrivenParams(b, BILLBOARD_PORTS);
      if (param(b, 'alignment') !== 'camera') report('INVALID_VALUE', `Billboard alignment "${String(param(b, 'alignment'))}" is not supported by the point preview; use "camera".`, bid, 'alignment');
      if (num(b, 'stretchRatio') !== 1) report('INVALID_VALUE', 'Billboard stretchRatio is not supported by the point preview; set it to 1.', bid, 'stretchRatio');
      if (param(b, 'softIntersection') !== false) report('INVALID_VALUE', 'Soft intersection is not supported by the point preview; turn it off.', bid, 'softIntersection');

      const mats = into(bid, 'material');
      const mat = mats.length === 1 ? sourceNode(mats[0].source, bid, 'material') : undefined;
      if (!mat || mat.node.type !== 'Material' || !mat.effectiveEnabled) {
        return fail('MISSING_REFERENCE', `Required input "material" of "${bid}" needs an enabled Material (a disabled Material acts absent).`, bid);
      }
      noDrivenParams(mat, []);
      if (param(mat, 'template') !== 'SpriteUnlit') report('INVALID_VALUE', 'Only the SpriteUnlit material template is supported.', mat.node.id, 'template');

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
      });
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
    }
  }

  if (!errors.length) {
    const budget = checkBudget(systems.map(s => s.descriptor), doc.durationTicks);
    if (budget) errors.push(budget);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { durationTicks: doc.durationTicks, systems, layers }, warnings };
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
