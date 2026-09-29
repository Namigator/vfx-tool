// Pure effective-value resolution for the node inspector (12-EDITOR "Inspector"). Wraps model/controls.ts
// resolveParameters so control-driven fields show the mapped control value (including Group control
// overrides) instead of the unused stored/default fallback. Connection-driven fields have no editor-time
// value; they are reported as runtime-unknown. No DOM, React or Three dependencies.
import type { EffectDocumentV2, NodeSpec, ParameterValue } from '../model/types.ts';
import { registryKey, resolveParameters } from '../model/controls.ts';

export type InspectorValue =
  /** Authored literal or registry default; editable unless structural. */
  | { kind: 'literal' | 'default'; value: ParameterValue }
  /** Resolved (scaled/offset) public-control value. */
  | { kind: 'control'; value: ParameterValue; controlLabel: string }
  /** Driven by a graph edge; the value exists only at runtime. */
  | { kind: 'connection'; from: string; fromNodeId?: string }
  /** Control-driven but resolution failed; never substitute the fallback. */
  | { kind: 'unavailable'; controlLabel: string; reason: string };

export function inspectorValues(
  doc: EffectDocumentV2,
  registry: ReadonlyMap<string, NodeSpec>,
  graphId: string,
  nodeId: string,
  controlOverrides?: ReadonlyMap<string, ParameterValue>,
): Map<string, InspectorValue> {
  const out = new Map<string, InspectorValue>();
  const graph = doc.graphs.find(g => g.id === graphId);
  const node = graph?.nodes.find(n => n.id === nodeId);
  const spec = node && registry.get(registryKey(node.type, node.definitionVersion));
  if (!graph || !node || !spec) return out;
  const ids = new Set(spec.parameters.map(p => p.id));

  const connected = new Map<string, string>(), connectedNode = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.target.nodeId !== node.id || !ids.has(e.target.port) || connected.has(e.target.port)) continue;
    const src = graph.nodes.find(n => n.id === e.source.nodeId);
    connected.set(e.target.port, `${src?.label || e.source.nodeId}.${e.source.port}`);
    connectedNode.set(e.target.port, e.source.nodeId);
  }
  const bound = new Map<string, string>();
  for (const c of doc.controls) {
    for (const b of c.bindings) {
      if (b.nodeId === node.id && ids.has(b.parameter) && !bound.has(b.parameter)) bound.set(b.parameter, c.label || c.id);
    }
  }

  const needResolve = [...bound.keys()].some(p => !connected.has(p));
  const res = needResolve ? resolveParameters(doc, registry, controlOverrides ? { controlOverrides } : {}) : undefined;
  let reason = '';
  if (res && !res.ok) {
    const d = res.errors.find(e => e.nodeId === node.id) ?? res.errors[0];
    reason = d ? d.message : 'Parameters could not be resolved.';
  }

  for (const p of spec.parameters) {
    const from = connected.get(p.id);
    if (from !== undefined) { out.set(p.id, { kind: 'connection', from, fromNodeId: connectedNode.get(p.id) }); continue; }
    const controlLabel = bound.get(p.id);
    if (controlLabel !== undefined) {
      const r = res?.ok ? res.value.find(v => v.nodeId === node.id && v.parameter === p.id) : undefined;
      if (r && r.source.kind === 'control') out.set(p.id, { kind: 'control', value: r.value, controlLabel });
      else out.set(p.id, { kind: 'unavailable', controlLabel, reason: reason || 'Control value is not resolved for this node.' });
      continue;
    }
    out.set(p.id, Object.prototype.hasOwnProperty.call(node.params, p.id)
      ? { kind: 'literal', value: node.params[p.id] }
      : { kind: 'default', value: p.default });
  }
  return out;
}
