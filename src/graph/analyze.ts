// Deterministic typed graph analysis (WP02A-WORKER-CONTRACT.md, claude-controls). A bounded structural
// stage: validateDocument → resolveParameters → per-node signatures → per-graph edge typing, driver
// counts, cycle detection, topological order and reachability. Each embedded graph is analyzed on its
// own, with Group nodes as typed boundary nodes. NOT done here (next slice): group flattening,
// enabled-state execution, disabled fallback/bypass rewriting, runtime signal evaluation and
// CompiledEffect lowering. Pure: no DOM, React or Three. The input is never mutated.
//
// Parameter values: `parameters` are the resolveParameters results with NO graph connections supplied,
// i.e. the authored baseline (bound control > literal > default). A parameter driven by an edge keeps
// that edge in `edges`; its effective value awaits graph expression evaluation in a later stage.
//
// Required inputs: an edge from a disabled producer still counts as present at this stage. Whether a
// disabled producer's fallback/empty output actually satisfies a consumer belongs to flatten/lower.
//
// Known conservative limits (fail safe; made precise by flattening/runtime evaluation, not here):
// - Emitter rate/burst: any edge into `rate`/`burst` counts as possibly nonzero, so a driver that is
//   constantly 0 still requires a window/trigger.
// - Cycles: a Group is one node in its parent graph. Root edges Group.a → X → Group.b are reported as a
//   cycle even when the child graph does not connect b to a.
import type {
  Diagnostic, EdgeDefinition, EffectDocumentV2, ErrorCode, NodeDefinition, NodeSpec, PortSpec,
  ValidationResult,
} from '../model/types.ts';
import type { RecordRegistry } from '../model/values.ts';
import { validateDocument } from '../model/document.ts';
import { registryKey, resolveParameters, type ResolvedParameter } from '../model/controls.ts';
import { checkPortCompatibility, resolveSignature, type ResolvedSignature } from './signature.ts';

export type AnalyzeOptions = {
  registry: ReadonlyMap<string, NodeSpec>;
  records?: RecordRegistry;
  availableAssetIds?: ReadonlySet<string>;
};

export type AnalyzedGraph = {
  graphId: string;
  /** All nodes of the graph in topological order; ties broken by node ID (code units). */
  nodeOrder: string[];
  /** Cloned edges ordered by target node, target port, edge.order, then edge ID. */
  edges: EdgeDefinition[];
  /** Nodes demanded by the root EffectOutput (through Group boundaries), in nodeOrder order. */
  reachableNodeIds: string[];
  /** Ordered by node ID. */
  signatures: ResolvedSignature[];
};

export type GraphAnalysis = {
  /** Clone of the validated input document; source IDs preserved. */
  document: EffectDocumentV2;
  /** Root graph first, then the remaining graphs by ID. */
  graphs: AnalyzedGraph[];
  /** Authored baseline values (no connection evaluation); see file header. */
  parameters: ResolvedParameter[];
  rootGraphId: string;
};

const GROUP = 'Group';
const GROUP_INPUT = 'GroupInput';
const GROUP_OUTPUT = 'GroupOutput';
const EFFECT_OUTPUT = 'EffectOutput';
const EMITTER = 'Emitter';
const ANCHOR = 'Anchor';
/** Numeric min/max parameter pairs that must satisfy min <= max. */
const RANGE_PAIRS: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = {
  [EMITTER]: [['lifetimeMin', 'lifetimeMax'], ['speedMin', 'speedMax']],
  InitialProperties: [['sizeMin', 'sizeMax'], ['rotationMin', 'rotationMax'], ['angularVelocityMin', 'angularVelocityMax']],
};

type NodeInfo = { node: NodeDefinition; graphId: string; gi: number; ni: number; sig?: ResolvedSignature };
type EdgeInfo = { edge: EdgeDefinition; path: string };

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const edgeOrder = (a: EdgeDefinition, b: EdgeDefinition) =>
  byCodeUnit(a.target.nodeId, b.target.nodeId) || byCodeUnit(a.target.port, b.target.port) ||
  a.order - b.order || byCodeUnit(a.id, b.id);

export function analyzeGraph(input: unknown, options: AnalyzeOptions): ValidationResult<GraphAnalysis> {
  const validated = validateDocument(input, options);
  if (!validated.ok) return validated;
  // Work on a private clone so neither the caller's input nor the returned document can alias.
  const doc = structuredClone(validated.value);
  const warnings: Diagnostic[] = [...validated.warnings];
  const resolved = resolveParameters(doc, options.registry, options.records ? { records: options.records } : {});
  if (!resolved.ok) return resolved;
  warnings.push(...resolved.warnings);

  const errors: Diagnostic[] = [];
  const diag = (severity: Diagnostic['severity'], code: ErrorCode, message: string, fieldPath?: string, nodeId?: string) => {
    const d: Diagnostic = { code, message, severity };
    if (fieldPath !== undefined) d.fieldPath = fieldPath;
    if (nodeId !== undefined) d.nodeId = nodeId;
    (severity === 'error' ? errors : warnings).push(d);
  };

  // ---------- signatures ----------
  const nodes = new Map<string, NodeInfo>();
  doc.graphs.forEach((g, gi) => g.nodes.forEach((node, ni) => {
    const info: NodeInfo = { node, graphId: g.id, gi, ni };
    nodes.set(node.id, info);
    const spec = options.registry.get(registryKey(node.type, node.definitionVersion));
    if (!spec) return; // validateDocument already rejects unregistered nodes.
    const r = resolveSignature(node, spec, { doc, graphId: g.id });
    if (r.ok) { info.sig = r.value; warnings.push(...r.warnings); }
    else errors.push(...r.errors.map(d => (d.nodeId === undefined ? { ...d, nodeId: node.id } : d)));
  }));
  const paramValue = new Map<string, ResolvedParameter>();
  for (const p of resolved.value) paramValue.set(`${p.nodeId}\u0000${p.parameter}`, p);
  const resolvedParam = (nodeId: string, parameter: string) => paramValue.get(`${nodeId}\u0000${parameter}`)?.value;

  // Group instance of each embedded graph (validateDocument guarantees at most one).
  const instantiator = new Map<string, string>();
  for (const info of nodes.values()) {
    const child = info.node.params.graphId;
    if (info.node.type === GROUP && typeof child === 'string') instantiator.set(child, info.node.id);
  }

  // ---------- edges: typing, drivers, integer constant sources ----------
  const incoming = new Map<string, EdgeInfo[]>();
  const outgoing = new Map<string, EdgeInfo[]>();
  const push = (m: Map<string, EdgeInfo[]>, k: string, e: EdgeInfo) => { const l = m.get(k); if (l) l.push(e); else m.set(k, [e]); };
  doc.graphs.forEach((g, gi) => g.edges.forEach((edge, ei) => {
    const path = `graphs[${gi}].edges[${ei}]`;
    const e: EdgeInfo = { edge, path };
    push(incoming, edge.target.nodeId, e);
    push(outgoing, edge.source.nodeId, e);
    const src = nodes.get(edge.source.nodeId)?.sig;
    const dst = nodes.get(edge.target.nodeId)?.sig;
    if (!src || !dst) return; // Signature failure already reported.
    const sp = src.outputs.find(p => p.id === edge.source.port);
    const tp = dst.inputs.find(p => p.id === edge.target.port);
    if (!sp) diag('error', 'MISSING_REFERENCE', `Node "${edge.source.nodeId}" has no output port "${edge.source.port}".`, `${path}.source.port`, edge.source.nodeId);
    if (!tp) diag('error', 'MISSING_REFERENCE', `Node "${edge.target.nodeId}" has no input port "${edge.target.port}".`, `${path}.target.port`, edge.target.nodeId);
    if (!sp || !tp) return;
    errors.push(...checkPortCompatibility(sp, tp, path).map(d => (d.nodeId === undefined ? { ...d, nodeId: edge.target.nodeId } : d)));
    const targetParam = dst.parameters.find(p => p.id === tp.id);
    if (targetParam?.type === 'integer' && !isConstantOnly(sp)) {
      diag('error', 'DOMAIN_MISMATCH', `Integer parameter "${tp.id}" accepts only constant sources; "${edge.source.nodeId}.${sp.id}" may vary.`, path, edge.target.nodeId);
    }
  }));
  for (const [nodeId, list] of incoming) {
    const sig = nodes.get(nodeId)?.sig;
    if (!sig) continue;
    const byPort = new Map<string, EdgeInfo[]>();
    for (const e of list) push(byPort, e.edge.target.port, e);
    for (const [port, es] of byPort) {
      const spec = sig.inputs.find(p => p.id === port);
      if (spec?.cardinality !== 'one' || es.length < 2) continue;
      const sorted = [...es].sort((a, b) => byCodeUnit(a.edge.id, b.edge.id));
      for (const e of sorted.slice(1)) {
        diag('error', 'MULTIPLE_DRIVERS', `Input "${port}" of node "${nodeId}" accepts one connection but has ${es.length} (${sorted.map(x => x.edge.id).join(', ')}).`, e.path, nodeId);
      }
    }
  }

  // ---------- topology and cycles (all edges, including event edges) ----------
  const orders = new Map<string, string[]>();
  doc.graphs.forEach((g, gi) => {
    const ids = g.nodes.map(n => n.id);
    const indeg = new Map(ids.map(id => [id, 0]));
    for (const e of g.edges) indeg.set(e.target.nodeId, (indeg.get(e.target.nodeId) ?? 0) + 1);
    const ready = ids.filter(id => indeg.get(id) === 0).sort(byCodeUnit);
    const order: string[] = [];
    while (ready.length) {
      const id = ready.shift() as string;
      order.push(id);
      let added = false;
      for (const { edge } of outgoing.get(id) ?? []) {
        const n = (indeg.get(edge.target.nodeId) as number) - 1;
        indeg.set(edge.target.nodeId, n);
        if (n === 0) { ready.push(edge.target.nodeId); added = true; }
      }
      if (added) ready.sort(byCodeUnit);
    }
    orders.set(g.id, order);
    if (order.length === ids.length) return;
    // Every remaining node has a predecessor that also remains: walk predecessors to a repeat.
    const remaining = new Set(ids.filter(id => (indeg.get(id) as number) > 0));
    const reported = new Set<string>();
    for (const start of [...remaining].sort(byCodeUnit)) {
      if (reported.has(start)) continue;
      const walk: string[] = [];
      const seenAt = new Map<string, number>();
      let cur = start;
      while (!seenAt.has(cur)) {
        seenAt.set(cur, walk.length);
        walk.push(cur);
        const preds = (incoming.get(cur) ?? []).map(e => e.edge.source.nodeId).filter(id => remaining.has(id)).sort(byCodeUnit);
        cur = preds[0];
      }
      const cycle = walk.slice(seenAt.get(cur)).reverse();
      if (cycle.some(id => reported.has(id))) { for (const id of walk) reported.add(id); continue; }
      for (const id of walk) reported.add(id);
      // Rotate so the smallest ID leads, for a stable message.
      const lead = cycle.indexOf([...cycle].sort(byCodeUnit)[0]);
      const path = [...cycle.slice(lead), ...cycle.slice(0, lead)];
      diag('error', 'GRAPH_CYCLE', `Graph "${g.id}" has a cycle: ${[...path, path[0]].join(' -> ')}. Remove one of these connections.`, `graphs[${gi}].edges`, path[0]);
    }
  });

  // ---------- reachability (root EffectOutput, through Group boundaries) ----------
  const reachable = new Set<string>();
  const groupDemand = new Map<string, Set<string>>();
  const childInputs = (groupId: string): Set<string> => {
    const child = nodes.get(groupId)?.node.params.graphId;
    const g = doc.graphs.find(x => x.id === child);
    return new Set(g ? g.inputs.map(p => p.id) : []);
  };
  const bridgesIn = (graphId: string, type: string, portId: string) =>
    [...nodes.values()].filter(i => i.graphId === graphId && i.node.type === type && i.node.params.portId === portId).map(i => i.node.id);
  const stack: Array<{ nodeId: string; port: string }> = [];
  const visit = (nodeId: string, port: string) => stack.push({ nodeId, port });
  const follow = (nodeId: string, accept: (port: string) => boolean) => {
    for (const { edge } of incoming.get(nodeId) ?? []) if (accept(edge.target.port)) visit(edge.source.nodeId, edge.source.port);
  };
  for (const info of nodes.values()) {
    if (info.graphId === doc.rootGraphId && info.node.type === EFFECT_OUTPUT && info.node.enabled) visit(info.node.id, '');
  }
  while (stack.length) {
    const { nodeId, port } = stack.pop() as { nodeId: string; port: string };
    const info = nodes.get(nodeId);
    if (!info) continue;
    const first = !reachable.has(nodeId);
    reachable.add(nodeId);
    const n = info.node;
    if (n.type === GROUP) {
      if (!n.enabled) continue; // Disabled Group is empty: its child graph is not demanded.
      const child = n.params.graphId as string;
      const demand = groupDemand.get(nodeId) ?? new Set<string>();
      groupDemand.set(nodeId, demand);
      if (port && !demand.has(port)) {
        demand.add(port);
        for (const b of bridgesIn(child, GROUP_OUTPUT, port)) visit(b, '');
      }
      // Exposed-control ports feed the child graph whenever the Group runs.
      if (first) { const ins = childInputs(nodeId); follow(nodeId, p => !ins.has(p)); }
      continue;
    }
    if (!first) continue;
    if (n.type === GROUP_INPUT) {
      const groupId = instantiator.get(info.graphId);
      if (groupId === undefined || !nodes.get(groupId)?.node.enabled) continue;
      reachable.add(groupId);
      const portId = n.params.portId;
      follow(groupId, p => p === portId);
      continue;
    }
    if (!n.enabled) {
      // Disabled bypass validates only its passthrough dependency; empty/fallback nodes execute nothing.
      const bp = info.sig?.disabledBehavior === 'bypass' ? info.sig.bypass : undefined;
      if (bp) follow(nodeId, p => p === bp.input);
      continue;
    }
    follow(nodeId, () => true);
  }

  // ---------- required inputs ----------
  for (const info of nodes.values()) {
    const { node: n, sig } = info;
    if (!sig) continue;
    const live = reachable.has(n.id);
    let ports: PortSpec[];
    if (n.enabled) ports = sig.inputs;
    else if (sig.disabledBehavior === 'bypass' && sig.bypass) ports = sig.inputs.filter(p => p.id === sig.bypass?.input);
    else continue;
    const connected = new Set((incoming.get(n.id) ?? []).map(e => e.edge.target.port));
    for (const p of ports) {
      if (!p.required || connected.has(p.id)) continue;
      diag(live ? 'error' : 'warning', 'MISSING_REFERENCE',
        live ? `Required input "${p.id}" of node "${n.id}" is not connected.`
          : `Required input "${p.id}" of unreachable node "${n.id}" is not connected; it would fail if connected to the output.`,
        `graphs[${info.gi}].nodes[${info.ni}]`, n.id);
    }
  }

  // ---------- special node rules ----------
  const anchorIds = new Set(doc.anchors.map(a => a.id));
  for (const info of nodes.values()) {
    const { node: n } = info;
    const path = `graphs[${info.gi}].nodes[${info.ni}]`;
    const live = reachable.has(n.id) && n.enabled;
    if (n.type === ANCHOR) {
      const id = resolvedParam(n.id, 'anchorId');
      if (typeof id === 'string' && !anchorIds.has(id)) {
        diag(live ? 'error' : 'warning', 'MISSING_REFERENCE', `Anchor node "${n.id}" names document anchor "${id}", which does not exist.`, `${path}.params.anchorId`, n.id);
      }
    }
    if (n.type === EMITTER && live) checkEmitter(n.id, path);
    for (const [lo, hi] of RANGE_PAIRS[n.type] ?? []) checkRange(n.id, path, lo, hi, live);
    if (n.type === EMITTER) checkDirection(n.id, path, live);
  }
  // Cross-parameter checks: reachable enabled nodes error, others warn. Edge-driven values are not
  // compared against their stale literal; the check is reported as deferred instead.
  function drivenPorts(nodeId: string) { return new Set((incoming.get(nodeId) ?? []).map(e => e.edge.target.port)); }
  function checkRange(nodeId: string, path: string, lo: string, hi: string, live: boolean) {
    const driven = drivenPorts(nodeId);
    if (driven.has(lo) || driven.has(hi)) {
      diag('warning', 'INVALID_VALUE', `Range check ${lo} <= ${hi} on node "${nodeId}" is deferred: a range end is driven by a connection.`, `${path}.params.${driven.has(lo) ? lo : hi}`, nodeId);
      return;
    }
    const a = resolvedParam(nodeId, lo);
    const b = resolvedParam(nodeId, hi);
    if (typeof a === 'number' && typeof b === 'number' && a > b) {
      diag(live ? 'error' : 'warning', 'INVALID_VALUE', `${lo} (${a}) must not exceed ${hi} (${b}) on node "${nodeId}".`, `${path}.params.${lo}`, nodeId);
    }
  }
  function checkDirection(nodeId: string, path: string, live: boolean) {
    if (drivenPorts(nodeId).has('direction')) {
      diag('warning', 'INVALID_VALUE', `Nonzero direction check on node "${nodeId}" is deferred: direction is driven by a connection.`, `${path}.params.direction`, nodeId);
      return;
    }
    const v = resolvedParam(nodeId, 'direction');
    if (Array.isArray(v) && v.every(x => x === 0)) {
      diag(live ? 'error' : 'warning', 'INVALID_VALUE', `Emitter "${nodeId}" direction must be nonzero.`, `${path}.params.direction`, nodeId);
    }
  }
  function checkEmitter(nodeId: string, path: string) {
    const ports = new Set((incoming.get(nodeId) ?? []).map(e => e.edge.target.port));
    const has = (p: string) => ports.has(p);
    // Edge-driven numbers may be nonzero at runtime; literals use the resolved baseline.
    const maybeNonzero = (p: string) => has(p) || (resolvedParam(nodeId, p) ?? 0) !== 0;
    const useEventPosition = resolvedParam(nodeId, 'useEventPosition') === true;
    if (has('anchor') && has('paths')) {
      diag('error', 'INVALID_VALUE', 'Emitter has both an anchor and paths input; connect exactly one position source.', path, nodeId);
    } else if (!has('anchor') && !has('paths') && !(useEventPosition && has('trigger'))) {
      diag('error', 'MISSING_REFERENCE', useEventPosition
        ? 'Emitter uses event position but has no trigger; connect a trigger, anchor or paths.'
        : 'Emitter needs exactly one position source: connect an anchor or paths input.', path, nodeId);
    }
    if (!has('trigger') && !has('window')) {
      diag('error', 'MISSING_REFERENCE', 'Emitter has neither a trigger nor a window, so it never emits; connect one.', path, nodeId);
      return;
    }
    if (maybeNonzero('rate') && !has('window')) diag('error', 'MISSING_REFERENCE', 'Emitter rate is nonzero but no window is connected.', `${path}.params.rate`, nodeId);
    if (maybeNonzero('burst') && !has('trigger')) diag('error', 'MISSING_REFERENCE', 'Emitter burst is nonzero but no trigger is connected. For continuous emission set Burst to 0 (Rate + Window); for a burst connect a Schedule start or another event to Trigger.', `${path}.params.burst`, nodeId);
  }

  if (errors.length) return { ok: false, errors };

  const graphIds = doc.graphs.map(g => g.id).filter(id => id !== doc.rootGraphId).sort(byCodeUnit);
  const graphs: AnalyzedGraph[] = [doc.rootGraphId, ...graphIds].map(graphId => {
    const g = doc.graphs.find(x => x.id === graphId) as EffectDocumentV2['graphs'][number];
    const nodeOrder = orders.get(graphId) as string[];
    return {
      graphId,
      nodeOrder: [...nodeOrder],
      edges: structuredClone([...g.edges].sort(edgeOrder)),
      reachableNodeIds: nodeOrder.filter(id => reachable.has(id)),
      signatures: g.nodes.map(n => nodes.get(n.id)?.sig).filter((s): s is ResolvedSignature => s !== undefined)
        .sort((a, b) => byCodeUnit(a.nodeId, b.nodeId)).map(s => structuredClone(s)),
    };
  });
  return {
    ok: true,
    value: { document: structuredClone(doc), graphs, parameters: structuredClone(resolved.value), rootGraphId: doc.rootGraphId },
    warnings,
  };
}

/** A port whose domains are exactly {constant} (missing domains are treated as unknown, not constant). */
function isConstantOnly(p: PortSpec): boolean {
  return Array.isArray(p.domains) && p.domains.length > 0 && p.domains.every(d => d === 'constant');
}
