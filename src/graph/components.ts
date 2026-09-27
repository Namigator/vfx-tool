// Ready-made components (01 "Simple surface", 12 "Add component"): complete, pre-wired node templates
// inserted into a document's root graph. Node ids get a unique prefix; the reserved endpoints
// node-source / node-target / node-output bind to the document's Source anchor, Target anchor and
// EffectOutput (created if missing). Pure: returns a new document, never mutates the input.
import type { EffectDocumentV2, NodeDefinition, ParameterValue, Vec3 } from '../model/types.ts';
import { createRegistry } from './registry.ts';
import { COMPONENT_TEMPLATES } from './components.generated.ts';

export type ComponentTemplate = {
  id: string; label: string; description: string;
  /** Minimum document duration the component needs (0 = no requirement). */
  durationTicks: number;
  /** Extra anchors the component positions itself (ids get the prefix). */
  anchors: { id: string; position: Vec3 }[];
  nodes: { id: string; type: string; params?: Record<string, unknown> }[];
  /** [from "node.port", to "node.port"]. */
  edges: [string, string][];
  /** Published big knobs (01 "4–8 primary controls"): document controls bound to component node params. */
  knobs: { id: string; label: string; value: number; bindings: { node: string; parameter: string; scale?: number }[] }[];
};

export { COMPONENT_TEMPLATES };

const RESERVED: Record<string, { type: string; anchorId?: string }> = {
  'node-source': { type: 'Anchor', anchorId: 'source' },
  'node-target': { type: 'Anchor', anchorId: 'target' },
  'node-output': { type: 'EffectOutput' },
};

export function getComponent(id: string): ComponentTemplate {
  const c = COMPONENT_TEMPLATES.find(t => t.id === id);
  if (!c) throw new Error(`Unknown component "${id}". Known: ${COMPONENT_TEMPLATES.map(t => t.id).join(', ')}`);
  return c;
}

/** Inserts `componentId` into the root graph. Returns the new document and the prefix used. */
export function insertComponent(doc: EffectDocumentV2, componentId: string, prefix?: string): { doc: EffectDocumentV2; prefix: string } {
  const c = getComponent(componentId);
  const d = structuredClone(doc);
  const g = d.graphs.find(x => x.id === d.rootGraphId);
  if (!g) throw new Error('Document has no root graph.');
  const specs = createRegistry();
  const spec = (type: string) => { const s = [...specs.values()].find(x => x.type === type); if (!s) throw new Error(`Component uses unknown node type "${type}".`); return s; };
  const taken = new Set([...d.graphs.flatMap(x => x.nodes.map(n => n.id)), ...d.graphs.flatMap(x => x.edges.map(e => e.id)), ...d.anchors.map(a => a.id)]);
  let p = prefix ?? c.id;
  for (let i = 2; c.nodes.some(n => taken.has(`${p}-${n.id}`)) || taken.has(`${p}-anchor`); i++) p = `${prefix ?? c.id}-${i}`;

  // Endpoints: reuse the document's Source/Target Anchor nodes and EffectOutput, creating any that are missing.
  const endpoint = new Map<string, string>();
  for (const [key, want] of Object.entries(RESERVED)) {
    const found = g.nodes.find(n => n.type === want.type && (!want.anchorId || n.params.anchorId === want.anchorId));
    if (found) { endpoint.set(key, found.id); continue; }
    const s = spec(want.type), nid = taken.has(key) ? `${p}-${key}` : key;
    g.nodes.push({ id: nid, type: s.type, definitionVersion: s.definitionVersion, label: want.anchorId ?? 'Output', enabled: true, randomStreamId: `rs-${nid}`, params: want.anchorId ? { anchorId: want.anchorId } : {} });
    endpoint.set(key, nid);
    if (want.anchorId && !d.anchors.some(a => a.id === want.anchorId)) d.anchors.push({ id: want.anchorId, name: want.anchorId, position: want.anchorId === 'source' ? [-2, 1, 0] : [2, 1, 0] });
  }
  // One audio chain per document: template AudioMix / AudioOutput nodes reuse the document's existing ones.
  for (const type of ['AudioMix', 'AudioOutput']) {
    const existing = g.nodes.find(n => n.type === type), mine = c.nodes.find(n => n.type === type);
    if (existing && mine) endpoint.set(mine.id, existing.id);
  }
  const anchorIds = new Map(c.anchors.map(a => [a.id, `${p}-${a.id}`]));
  for (const a of c.anchors) d.anchors.push({ id: anchorIds.get(a.id)!, name: `${c.label} ${a.id}`, position: [...a.position] as Vec3 });
  const nodeId = (id: string) => endpoint.get(id) ?? `${p}-${id}`;
  const layout = d.editor.graphs[g.id]?.nodes;
  const baseY = layout ? Math.max(0, ...Object.values(layout).map(v => v.y)) + 220 : 0;
  c.nodes.forEach((n, i) => {
    if (endpoint.has(n.id)) return; // Reused audio mix/output.
    const s = spec(n.type), id = nodeId(n.id);
    const params = structuredClone(n.params ?? {}) as Record<string, ParameterValue>;
    if (n.type === 'Anchor' && typeof params.anchorId === 'string' && anchorIds.has(params.anchorId)) params.anchorId = anchorIds.get(params.anchorId)!;
    const def: NodeDefinition = { id, type: s.type, definitionVersion: s.definitionVersion, label: `${c.label}: ${n.id}`, enabled: true, randomStreamId: `rs-${id}`, params };
    g.nodes.push(def);
    if (layout) layout[id] = { x: 260 * (i % 6), y: baseY + 170 * Math.floor(i / 6) };
  });
  for (const [from, to] of c.edges) {
    const [fn, fp] = [from.slice(0, from.lastIndexOf('.')), from.slice(from.lastIndexOf('.') + 1)];
    const [tn, tp] = [to.slice(0, to.lastIndexOf('.')), to.slice(to.lastIndexOf('.') + 1)];
    const source = { nodeId: nodeId(fn), port: fp }, target = { nodeId: nodeId(tn), port: tp };
    if (g.edges.some(e => e.source.nodeId === source.nodeId && e.source.port === source.port && e.target.nodeId === target.nodeId && e.target.port === target.port)) continue; // Shared chain already wired.
    const order = g.edges.filter(e => e.target.nodeId === target.nodeId && e.target.port === target.port).length;
    let id = `${p}-e-${fn}-${tn}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60);
    for (let i = 2; g.edges.some(e => e.id === id); i++) id = `${id.replace(/-\d+$/, '')}-${i}`;
    g.edges.push({ id, source, target, order });
  }
  // Knobs become document controls bound to the component's (prefixed) nodes; type/unit/bounds come from
  // the first binding's parameter spec, bounds widened so every scaled binding stays inside its own range.
  for (const k of c.knobs) {
    const first = k.bindings[0], node = g.nodes.find(n => n.id === nodeId(first.node))!;
    const ps = spec(node.type).parameters.find(x => x.id === first.parameter);
    if (!ps || (ps.type !== 'number' && ps.type !== 'integer')) throw new Error(`Knob "${k.id}" must bind a number parameter.`);
    const s0 = first.scale ?? 1;
    let min = (ps.min ?? 0) / s0, max = (ps.max ?? Math.max(1, k.value * 4)) / s0;
    for (const b of k.bindings) {
      const bs = spec(g.nodes.find(n => n.id === nodeId(b.node))!.type).parameters.find(x => x.id === b.parameter);
      if (bs?.min !== undefined) min = Math.max(min, bs.min / (b.scale ?? 1));
      if (bs?.max !== undefined) max = Math.min(max, bs.max / (b.scale ?? 1));
    }
    const value = ps.type === 'integer' ? Math.round(k.value) : k.value;
    d.controls.push({
      id: `ctl-${p}-${k.id}`, scopeGraphId: g.id, label: k.label, type: ps.type, unit: ps.unit, value, default: value, min, max,
      ...(ps.type === 'integer' ? { step: 1 } : {}), section: p === c.id ? c.label : `${c.label} (${p})`, description: `${c.label}: ${k.bindings.map(b => `${b.node}.${b.parameter}${b.scale ? ` ×${b.scale}` : ''}`).join(', ')}`,
      editPolicy: ps.editPolicy, bindings: k.bindings.map(b => ({ nodeId: nodeId(b.node), parameter: b.parameter, ...(b.scale ? { scale: b.scale } : {}) })),
    });
  }
  if (c.durationTicks > d.durationTicks) d.durationTicks = c.durationTicks;
  return { doc: d, prefix: p };
}
