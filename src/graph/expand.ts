// Deterministic group expansion (WP02B-WP03-WORKER-CONTRACT.md, claude-model). Input is a successful
// GraphAnalysis. Group, GroupInput and GroupOutput nodes disappear; every ordinary node of the root graph
// and of every embedded graph reachable through Group references (enabled or not, demanded or not) is
// kept with its original ID, random stream and parameters. Edges become connection records whose source
// is resolved through bridge wiring. No nodes are synthesized. Pure: no DOM, React or Three.
//
// NOT done here (next lowering stage): disabled modifier/provider rewriting, control-driver/expression
// evaluation, affine control resolution and CompiledEffect lowering.
//
// Decisions:
// - An edge whose resolution reaches no wire (optional interface without default, disabled Group output)
//   keeps one record with source kind 'empty' and its traversed edge IDs, so no edge is dropped silently.
//   Lowering must filter 'empty' records out of many-input runtime lists.
// - Missing required wiring is an error when the consumer is demanded (analysis reachability), otherwise
//   a warning plus an 'empty' record.
// - Edges into Group interface inputs are expressed only through the GroupInput readers that consume
//   them; an interface input with no reader keeps its authored edge and gets an unused-wiring warning.
// - Each instantiated graph has at most one GroupOutput bridge per exposed output, consumed or not.
// - Control-driver sources count toward the connection budget. Effectively disabled Groups (own flag or
//   an ancestor) emit no controlDrivers; their authored wiring stays in the document.
import type {
  Diagnostic, EdgeDefinition, EffectDocumentV2, ErrorCode, GraphDefinition, NodeDefinition, ParameterValue,
  ValidationResult,
} from '../model/types.ts';
import { MAX_EXPANDED_EDGES, MAX_EXPANDED_NODES } from '../model/types.ts';
import type { ResolvedParameter } from '../model/controls.ts';
import type { GraphAnalysis } from './analyze.ts';
import {
  BRIDGE_PORT_PARAM, GROUP_GRAPH_PARAM, GROUP_INPUT_NODE_TYPE, GROUP_INPUT_PORT, GROUP_NODE_TYPE,
  GROUP_OUTPUT_NODE_TYPE, GROUP_OUTPUT_PORT, type ResolvedSignature,
} from './signature.ts';

export type ExpandedNode = {
  node: NodeDefinition; graphId: string; groupPath: string[]; effectiveEnabled: boolean; signature: ResolvedSignature;
};
export type ExpandedSource =
  | { kind: 'node'; nodeId: string; port: string }
  | { kind: 'literal'; value: ParameterValue }
  | { kind: 'empty' };
export type ExpandedConnection = {
  target: { nodeId: string; port: string }; source: ExpandedSource; orderPath: number[]; sourceEdgeIds: string[];
};
export type ExpandedGraph = {
  nodes: ExpandedNode[];
  connections: ExpandedConnection[];
  controlDrivers: { controlId: string; groupNodeId: string; sources: ExpandedSource[] }[];
  parameters: ResolvedParameter[];
  /** Resolved values of Group instances' exposed child controls (06 parent → group → internal); read by PublicParameter. */
  groupControls: ResolvedParameter[];
  rootOutputNodeId: string;
};

const EFFECT_OUTPUT = 'EffectOutput';
const BRIDGE_TYPES = [GROUP_NODE_TYPE, GROUP_INPUT_NODE_TYPE, GROUP_OUTPUT_NODE_TYPE];

type Info = { node: NodeDefinition; graph: GraphDefinition; groupPath: string[]; enabled: boolean };
type Trace = { source: ExpandedSource; orderPath: number[]; sourceEdgeIds: string[] };

class Abort extends Error {
  diagnostic: Diagnostic;
  constructor(d: Diagnostic) { super(d.message); this.diagnostic = d; }
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function compareNumbers(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
function compareStrings(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = byCodeUnit(a[i], b[i]); if (c) return c; }
  return a.length - b.length;
}

export function expandGroups(analysis: GraphAnalysis): ValidationResult<ExpandedGraph> {
  try {
    return expand(analysis);
  } catch (e) {
    if (e instanceof Abort) return { ok: false, errors: [e.diagnostic] };
    throw e;
  }
}

function expand(analysis: GraphAnalysis): ValidationResult<ExpandedGraph> {
  const doc: EffectDocumentV2 = analysis.document;
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const diag = (severity: Diagnostic['severity'], code: ErrorCode, message: string, nodeId?: string) => {
    const d: Diagnostic = { code, message, severity };
    if (nodeId !== undefined) d.nodeId = nodeId;
    (severity === 'error' ? errors : warnings).push(d);
  };
  const abort = (code: ErrorCode, message: string, nodeId?: string): never => {
    const d: Diagnostic = { code, message, severity: 'error' };
    if (nodeId !== undefined) d.nodeId = nodeId;
    throw new Abort(d);
  };

  const graphById = new Map(doc.graphs.map(g => [g.id, g]));
  const signatures = new Map<string, ResolvedSignature>();
  const reachable = new Set<string>();
  const incoming = new Map<string, EdgeDefinition[]>();
  for (const g of analysis.graphs) {
    for (const s of g.signatures) signatures.set(s.nodeId, s);
    for (const id of g.reachableNodeIds) reachable.add(id);
    // Analysis edges are sorted by target, port, order, ID.
    for (const e of g.edges) { const l = incoming.get(e.target.nodeId); if (l) l.push(e); else incoming.set(e.target.nodeId, [e]); }
  }

  // ---------- collect instantiated graphs and ordinary nodes ----------
  const infos = new Map<string, Info>();
  /** Embedded graph ID → instantiating Group node ID. */
  const instantiator = new Map<string, string>();
  let ordinaryCount = 0;
  const walk = (graphId: string, groupPath: string[], enabled: boolean, stack: string[]) => {
    if (stack.includes(graphId)) abort('GROUP_RECURSION', `Group graph "${graphId}" instantiates itself: ${[...stack, graphId].join(' -> ')}.`, groupPath[groupPath.length - 1]);
    const g = graphById.get(graphId);
    if (!g) return abort('MISSING_REFERENCE', `Graph "${graphId}" does not exist.`, groupPath[groupPath.length - 1]);
    const nodes = [...g.nodes].sort((a, b) => byCodeUnit(a.id, b.id));
    for (const node of nodes) {
      infos.set(node.id, { node, graph: g, groupPath, enabled: enabled && node.enabled });
      if (BRIDGE_TYPES.includes(node.type)) continue;
      if (++ordinaryCount > MAX_EXPANDED_NODES) abort('BUDGET_EXCEEDED', `Expansion exceeds ${MAX_EXPANDED_NODES} nodes.`, node.id);
    }
    // Bridge ambiguity is checked per instantiated graph, whether or not the output is consumed.
    const bridgesByPort = new Map<string, string[]>();
    for (const node of nodes) {
      if (node.type !== GROUP_OUTPUT_NODE_TYPE) continue;
      const portId = String(node.params[BRIDGE_PORT_PARAM]);
      const l = bridgesByPort.get(portId);
      if (l) l.push(node.id); else bridgesByPort.set(portId, [node.id]);
    }
    for (const portId of [...bridgesByPort.keys()].sort(byCodeUnit)) {
      const bridges = bridgesByPort.get(portId) as string[];
      if (bridges.length > 1) {
        abort('MULTIPLE_DRIVERS', `Exposed output "${portId}" of graph "${graphId}" has ${bridges.length} GroupOutput bridges (${bridges.join(', ')}); keep one.`, bridges[1]);
      }
    }
    for (const node of nodes) {
      if (node.type !== GROUP_NODE_TYPE) continue;
      const child = node.params[GROUP_GRAPH_PARAM];
      if (typeof child !== 'string') { abort('MISSING_REFERENCE', `Group "${node.id}" has no graph reference.`, node.id); continue; }
      if (instantiator.has(child)) abort('GROUP_RECURSION', `Graph "${child}" is instantiated by both "${instantiator.get(child)}" and "${node.id}".`, node.id);
      instantiator.set(child, node.id);
      walk(child, [...groupPath, node.id], enabled && node.enabled, [...stack, graphId]);
    }
  };
  walk(analysis.rootGraphId, [], true, []);

  // ---------- source resolution ----------
  let recordCount = 0;
  const countRecord = (nodeId: string) => {
    if (++recordCount > MAX_EXPANDED_EDGES) abort('BUDGET_EXCEEDED', `Expansion exceeds ${MAX_EXPANDED_EDGES} connection records.`, nodeId);
  };

  /** Resolves one authored edge (already appended to orderPath/ids) to its ultimate sources. */
  const resolve = (e: EdgeDefinition, orderPath: number[], ids: string[], demanded: boolean, consumer: string): Trace[] => {
    const src = infos.get(e.source.nodeId);
    if (!src) return abort('MISSING_REFERENCE', `Edge "${e.id}" source "${e.source.nodeId}" is not in an instantiated graph.`, consumer);
    const n = src.node;
    // Budget is charged per resolved source as it is produced, before any further fanout.
    const leaf = (source: ExpandedSource): Trace[] => {
      countRecord(consumer);
      return [{ source, orderPath, sourceEdgeIds: ids }];
    };
    const missing = (message: string): Trace[] => {
      diag(demanded ? 'error' : 'warning', 'MISSING_REFERENCE', message, n.id);
      return leaf({ kind: 'empty' });
    };
    const follow = (edges: EdgeDefinition[]): Trace[] => {
      const out: Trace[] = [];
      for (const up of edges) {
        if (ids.includes(up.id)) abort('GRAPH_CYCLE', `Expansion revisits edge "${up.id}": ${[...ids, up.id].join(' -> ')}.`, up.target.nodeId);
        out.push(...resolve(up, [...orderPath, up.order], [...ids, up.id], demanded, consumer));
      }
      return out;
    };

    if (n.type === GROUP_NODE_TYPE) {
      const child = graphById.get(n.params[GROUP_GRAPH_PARAM] as string) as GraphDefinition;
      const port = child.outputs.find(p => p.id === e.source.port);
      if (!port) return abort('MISSING_REFERENCE', `Group "${n.id}" has no exposed output "${e.source.port}".`, n.id);
      if (!src.enabled) return leaf({ kind: 'empty' }); // Disabled Group: never execute hidden children.
      const bridges = child.nodes.filter(x => x.type === GROUP_OUTPUT_NODE_TYPE && x.params[BRIDGE_PORT_PARAM] === port.id)
        .map(x => x.id).sort(byCodeUnit);
      if (bridges.length > 1) {
        abort('MULTIPLE_DRIVERS', `Exposed output "${port.id}" of Group "${n.id}" has ${bridges.length} GroupOutput bridges (${bridges.join(', ')}); keep one.`, bridges[1]);
      }
      if (bridges.length === 0) {
        if (!port.required) return leaf({ kind: 'empty' });
        return missing(`Required exposed output "${port.id}" of Group "${n.id}" has no GroupOutput bridge in graph "${child.id}".`);
      }
      const wires = (incoming.get(bridges[0]) ?? []).filter(x => x.target.port === GROUP_OUTPUT_PORT);
      if (wires.length === 0) {
        if (!port.required) return leaf({ kind: 'empty' });
        diag(demanded ? 'error' : 'warning', 'MISSING_REFERENCE', `Required GroupOutput "${bridges[0]}" (port "${port.id}") is not connected.`, bridges[0]);
        return leaf({ kind: 'empty' });
      }
      return follow(wires);
    }
    if (n.type === GROUP_INPUT_NODE_TYPE) {
      const groupId = instantiator.get(src.graph.id);
      if (groupId === undefined) return missing(`GroupInput "${n.id}" is in graph "${src.graph.id}", which no Group instantiates.`);
      const portId = n.params[BRIDGE_PORT_PARAM];
      const port = src.graph.inputs.find(p => p.id === portId);
      if (!port) return abort('MISSING_REFERENCE', `GroupInput "${n.id}" names missing interface input "${String(portId)}".`, n.id);
      const wires = (incoming.get(groupId) ?? []).filter(x => x.target.port === port.id);
      if (wires.length) return follow(wires);
      if (port.defaultValue !== undefined) return leaf({ kind: 'literal', value: structuredClone(port.defaultValue) });
      if (!port.required) return leaf({ kind: 'empty' });
      diag(demanded ? 'error' : 'warning', 'MISSING_REFERENCE', `Required input "${port.id}" of Group "${groupId}" is not connected.`, groupId);
      return leaf({ kind: 'empty' });
    }
    if (n.type === GROUP_OUTPUT_NODE_TYPE) return abort('MISSING_REFERENCE', `GroupOutput "${n.id}" has no output ports; edge "${e.id}" is invalid.`, n.id);
    return leaf({ kind: 'node', nodeId: n.id, port: e.source.port });
  };

  const connections: ExpandedConnection[] = [];
  const controlDrivers: ExpandedGraph['controlDrivers'] = [];
  const nodes: ExpandedNode[] = [];
  const ids = [...infos.keys()].sort(byCodeUnit);
  for (const id of ids) {
    const info = infos.get(id) as Info;
    const n = info.node;
    if (n.type === GROUP_INPUT_NODE_TYPE || n.type === GROUP_OUTPUT_NODE_TYPE) continue;
    const demanded = reachable.has(id);
    if (n.type === GROUP_NODE_TYPE) {
      const child = graphById.get(n.params[GROUP_GRAPH_PARAM] as string) as GraphDefinition;
      const byControl = new Map<string, Trace[]>();
      for (const e of incoming.get(id) ?? []) {
        if (child.inputs.some(p => p.id === e.target.port)) {
          // Consumed through GroupInput readers; an unread input keeps its authored edge but is reported.
          const read = child.nodes.some(x => x.type === GROUP_INPUT_NODE_TYPE && x.params[BRIDGE_PORT_PARAM] === e.target.port);
          if (!read) diag('warning', 'MISSING_REFERENCE', `Edge "${e.id}" wires input "${e.target.port}" of Group "${id}", but no GroupInput in graph "${child.id}" reads it; the wiring is unused.`, id);
          continue;
        }
        if (!doc.controls.some(c => c.scopeGraphId === child.id && c.id === e.target.port)) {
          abort('MISSING_REFERENCE', `Edge "${e.id}" targets unknown port "${e.target.port}" of Group "${id}".`, id);
        }
        if (!info.enabled) continue; // Effectively disabled Group: control drivers are not executed.
        const traces = resolve(e, [e.order], [e.id], demanded, id);
        const l = byControl.get(e.target.port) ?? [];
        l.push(...traces);
        byControl.set(e.target.port, l);
      }
      for (const controlId of [...byControl.keys()].sort(byCodeUnit)) {
        const traces = sortTraces(byControl.get(controlId) as Trace[]);
        controlDrivers.push({ controlId, groupNodeId: id, sources: traces.map(t => t.source) });
      }
      continue;
    }
    const signature = signatures.get(id);
    if (!signature) return abort('MISSING_REFERENCE', `Node "${id}" has no resolved signature.`, id);
    nodes.push({ node: structuredClone(n), graphId: info.graph.id, groupPath: [...info.groupPath], effectiveEnabled: info.enabled, signature: structuredClone(signature) });
    for (const e of incoming.get(id) ?? []) {
      for (const t of resolve(e, [e.order], [e.id], demanded, id)) {
        connections.push({ target: { nodeId: id, port: e.target.port }, ...t });
      }
    }
  }
  if (errors.length) return { ok: false, errors };

  connections.sort((a, b) => byCodeUnit(a.target.nodeId, b.target.nodeId) || byCodeUnit(a.target.port, b.target.port) ||
    compareNumbers(a.orderPath, b.orderPath) || compareStrings(a.sourceEdgeIds, b.sourceEdgeIds));

  const outputs = (graphById.get(analysis.rootGraphId) as GraphDefinition).nodes.filter(x => x.type === EFFECT_OUTPUT).map(x => x.id).sort(byCodeUnit);
  if (outputs.length !== 1) {
    return { ok: false, errors: [{ code: outputs.length ? 'MULTIPLE_DRIVERS' : 'MISSING_REFERENCE', severity: 'error',
      message: `The root graph must contain exactly one EffectOutput; found ${outputs.length}.` }] };
  }

  const kept = new Set(nodes.map(x => x.node.id));
  const parameters = analysis.parameters.filter(p => kept.has(p.nodeId))
    .sort((a, b) => byCodeUnit(a.nodeId, b.nodeId) || byCodeUnit(a.parameter, b.parameter));
  const groupIds = new Set(analysis.document.graphs.flatMap(g => g.nodes).filter(n => n.type === GROUP_NODE_TYPE).map(n => n.id));
  const groupControls = analysis.parameters.filter(p => groupIds.has(p.nodeId));
  return {
    ok: true,
    // Nodes and literal leaves are cloned where they are built; the rest refers into the analysis, which is shared
    // read-only with the compilers (graph/prepare.ts), so a second whole-graph clone is not needed.
    value: { nodes, connections, controlDrivers, parameters, groupControls, rootOutputNodeId: outputs[0] },
    warnings,
  };
}

function sortTraces(traces: Trace[]): Trace[] {
  return [...traces].sort((a, b) => compareNumbers(a.orderPath, b.orderPath) || compareStrings(a.sourceEdgeIds, b.sourceEdgeIds));
}
