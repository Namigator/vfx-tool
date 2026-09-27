// Ready-made components (01 "Simple surface", 12 "Add component"): complete, pre-wired node templates
// inserted into a document's root graph. Node ids get a unique prefix; the reserved endpoints
// node-source / node-target / node-output bind to the document's Source anchor, Target anchor and
// EffectOutput (created if missing). Pure: returns a new document, never mutates the input.
import type { EffectDocumentV2, GraphDefinition, NodeDefinition, ParameterValue, Vec3 } from '../model/types.ts';
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

const isAudioType = (type: string) => type.startsWith('Audio');

/**
 * Inserts `componentId`. Flat (default): every node goes into the root graph. `group: true` (06 "Group"):
 * the component's visual nodes go into their own graph wrapped by one Group node in the root (Source/Target
 * become Anchor nodes inside; knobs become the Group's exposed controls, scope = the child graph). Audio nodes
 * stay in the root (one shared audio chain per document; the audio compiler does not take grouped chains), and
 * every link from inside the group to the root — EffectOutput ports, Schedule cues for sounds — becomes an
 * interface output through a GroupOutput bridge. Returns the new document, the prefix and the Group node id.
 */
export function insertComponent(doc: EffectDocumentV2, componentId: string, prefix?: string, opts: { group?: boolean } = {}): { doc: EffectDocumentV2; prefix: string; groupNodeId?: string } {
  const c = getComponent(componentId);
  const d = structuredClone(doc);
  const root = d.graphs.find(x => x.id === d.rootGraphId);
  if (!root) throw new Error('Document has no root graph.');
  const grouped = opts.group === true;
  const specs = createRegistry();
  const spec = (type: string) => { const s = [...specs.values()].find(x => x.type === type); if (!s) throw new Error(`Component uses unknown node type "${type}".`); return s; };
  const taken = new Set([...d.graphs.flatMap(x => x.nodes.map(n => n.id)), ...d.graphs.flatMap(x => x.edges.map(e => e.id)), ...d.anchors.map(a => a.id)]);
  let p = prefix ?? c.id;
  for (let i = 2; c.nodes.some(n => taken.has(`${p}-${n.id}`)) || taken.has(`${p}-anchor`) || (grouped && (taken.has(p) || d.graphs.some(x => x.id === `graph-${p}`))); i++) p = `${prefix ?? c.id}-${i}`;
  const child: GraphDefinition | undefined = grouped ? { id: `graph-${p}`, inputs: [], outputs: [], nodes: [], edges: [] } : undefined;
  if (child) { d.graphs.push(child); d.editor.graphs[child.id] = { nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } }; }
  /** Graph a template node lives in: grouped visual nodes go to the child, audio (and everything when flat) to the root. */
  const homeOfType = (type: string) => (child && !isAudioType(type) ? child : root);
  const newNode = (g: GraphDefinition, id: string, type: string, label: string, params: Record<string, ParameterValue>) => {
    const s = spec(type);
    g.nodes.push({ id, type: s.type, definitionVersion: s.definitionVersion, label, enabled: true, randomStreamId: `rs-${id}`, params });
  };

  // Endpoints: Source/Target Anchor nodes (reused in the root; own copies inside a group) and the root EffectOutput.
  const endpoint = new Map<string, string>(), endpointGraph = new Map<string, GraphDefinition>();
  for (const [key, want] of Object.entries(RESERVED)) {
    const g = want.type === 'EffectOutput' ? root : homeOfType(want.type);
    const found = g.nodes.find(n => n.type === want.type && (!want.anchorId || n.params.anchorId === want.anchorId));
    endpointGraph.set(key, g);
    if (found) { endpoint.set(key, found.id); continue; }
    const nid = taken.has(key) || g !== root ? `${p}-${key.replace(/^node-/, '')}` : key;
    newNode(g, nid, want.type, want.anchorId ?? 'Output', want.anchorId ? { anchorId: want.anchorId } : {});
    endpoint.set(key, nid);
    if (want.anchorId && !d.anchors.some(a => a.id === want.anchorId)) d.anchors.push({ id: want.anchorId, name: want.anchorId, position: want.anchorId === 'source' ? [-2, 1, 0] : [2, 1, 0] });
  }
  // One audio chain per document: template AudioMix / AudioOutput nodes reuse the document's existing ones.
  for (const type of ['AudioMix', 'AudioOutput']) {
    const existing = root.nodes.find(n => n.type === type), mine = c.nodes.find(n => n.type === type);
    if (existing && mine) { endpoint.set(mine.id, existing.id); endpointGraph.set(mine.id, root); }
  }
  const anchorIds = new Map(c.anchors.map(a => [a.id, `${p}-${a.id}`]));
  for (const a of c.anchors) d.anchors.push({ id: anchorIds.get(a.id)!, name: `${c.label} ${a.id}`, position: [...a.position] as Vec3 });
  const nodeId = (id: string) => endpoint.get(id) ?? `${p}-${id}`;
  const graphOfTemplate = (id: string) => endpointGraph.get(id) ?? homeOfType(c.nodes.find(n => n.id === id)?.type ?? '');
  const placed = new Map<string, number>();
  c.nodes.forEach(n => {
    if (endpoint.has(n.id)) return; // Reused audio mix/output.
    const g = homeOfType(n.type), id = nodeId(n.id);
    const params = structuredClone(n.params ?? {}) as Record<string, ParameterValue>;
    if (n.type === 'Anchor' && typeof params.anchorId === 'string' && anchorIds.has(params.anchorId)) params.anchorId = anchorIds.get(params.anchorId)!;
    newNode(g, id, n.type, `${c.label}: ${n.id}`, params);
    const layout = d.editor.graphs[g.id]?.nodes;
    if (layout) {
      const i = placed.get(g.id) ?? 0; placed.set(g.id, i + 1);
      const baseY = i === 0 ? Math.max(0, ...Object.values(layout).map(v => v.y)) + (g === root ? 220 : 0) : (layout[`__base_${g.id}`]?.y ?? 0);
      if (i === 0) layout[`__base_${g.id}`] = { x: 0, y: baseY };
      layout[id] = { x: 260 * (i % 6), y: baseY + 170 * Math.floor(i / 6) };
    }
  });
  for (const g of d.graphs) { const l = d.editor.graphs[g.id]?.nodes; if (l) delete l[`__base_${g.id}`]; }

  const addEdge = (g: GraphDefinition, base: string, source: { nodeId: string; port: string }, target: { nodeId: string; port: string }) => {
    if (g.edges.some(e => e.source.nodeId === source.nodeId && e.source.port === source.port && e.target.nodeId === target.nodeId && e.target.port === target.port)) return; // Shared chain already wired.
    const order = g.edges.filter(e => e.target.nodeId === target.nodeId && e.target.port === target.port).length;
    let id = base.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60);
    for (let i = 2; d.graphs.some(x => x.edges.some(e => e.id === id)); i++) id = `${id.replace(/-\d+$/, '')}-${i}`;
    g.edges.push({ id, source, target, order });
  };
  /** Interface output of the child for a crossing link, with its GroupOutput bridge; returns the port id. */
  const exposeOutput = (portId: string, type: string) => {
    if (!child!.outputs.some(o => o.id === portId)) {
      child!.outputs.push({ id: portId, label: portId[0].toUpperCase() + portId.slice(1), type: type as 'visual', cardinality: 'many', required: false, direction: 'output' });
      newNode(child!, `${p}-out-${portId}`, 'GroupOutput', `Out: ${portId}`, { portId });
    }
    return portId;
  };
  const crossings: { port: string; target: { nodeId: string; port: string } }[] = [];
  for (const [from, to] of c.edges) {
    const [fn, fp] = [from.slice(0, from.lastIndexOf('.')), from.slice(from.lastIndexOf('.') + 1)];
    const [tn, tp] = [to.slice(0, to.lastIndexOf('.')), to.slice(to.lastIndexOf('.') + 1)];
    const sg = graphOfTemplate(fn), tg = graphOfTemplate(tn);
    const source = { nodeId: nodeId(fn), port: fp }, target = { nodeId: nodeId(tn), port: tp };
    if (sg === tg) { addEdge(sg, `${p}-e-${fn}-${tn}`, source, target); continue; }
    if (sg !== child) throw new Error(`Component "${c.id}": link ${from} → ${to} would enter the group; not supported.`);
    // Leaving the group: EffectOutput ports keep their name; other links get one port per source output.
    const srcType = c.nodes.find(n => n.id === fn)!.type, portType = spec(srcType).outputs.find(o => o.id === fp)?.type ?? 'event';
    const port = exposeOutput(tn === 'node-output' ? tp : `${fn}-${fp}`.replace(/[^A-Za-z0-9_-]/g, '-'), portType);
    addEdge(child!, `${p}-e-${fn}-out-${port}`, source, { nodeId: `${p}-out-${port}`, port: 'in' });
    crossings.push({ port, target });
  }
  // Start at (user feedback 2026-09-27: components must be sequenceable, e.g. impact after charge): one knob shifts
  // every Schedule of the component together, keeping their authored spacing (binding offset = authored start).
  const scheds = c.nodes.filter(n => n.type === 'Schedule');
  if (scheds.length) {
    const offs = scheds.map(n => Number(n.params?.startTicks ?? 0)), scope = graphOfTemplate(scheds[0].id);
    d.controls.push({
      id: `ctl-${p}-start-at`, scopeGraphId: scope.id, label: 'Start at', type: 'integer', unit: 'tick', value: 0, default: 0, min: 0, max: 600 - Math.max(...offs), step: 1,
      section: p === c.id ? c.label : `${c.label} (${p})`, description: 'Delays the whole component (60 ticks = 1 second) so it can play after another one.', editPolicy: 'resample',
      bindings: scheds.map((n, i) => ({ nodeId: nodeId(n.id), parameter: 'startTicks', ...(offs[i] ? { offset: offs[i] } : {}) })),
    });
  }
  // Knobs become document controls bound to the component's (prefixed) nodes; type/unit/bounds come from
  // the first binding's parameter spec, bounds widened so every scaled binding stays inside its own range.
  for (const k of c.knobs) {
    const first = k.bindings[0], scope = graphOfTemplate(first.node), node = scope.nodes.find(n => n.id === nodeId(first.node))!;
    if (k.bindings.some(b => graphOfTemplate(b.node) !== scope)) throw new Error(`Knob "${k.id}" binds nodes on both sides of the group.`);
    const ps = spec(node.type).parameters.find(x => x.id === first.parameter);
    if (!ps || (ps.type !== 'number' && ps.type !== 'integer')) throw new Error(`Knob "${k.id}" must bind a number parameter.`);
    const s0 = first.scale ?? 1;
    let min = (ps.min ?? 0) / s0, max = (ps.max ?? Math.max(1, k.value * 4)) / s0;
    for (const b of k.bindings) {
      const bs = spec(scope.nodes.find(n => n.id === nodeId(b.node))!.type).parameters.find(x => x.id === b.parameter);
      if (bs?.min !== undefined) min = Math.max(min, bs.min / (b.scale ?? 1));
      if (bs?.max !== undefined) max = Math.min(max, bs.max / (b.scale ?? 1));
    }
    const value = ps.type === 'integer' ? Math.round(k.value) : k.value;
    d.controls.push({
      id: `ctl-${p}-${k.id}`, scopeGraphId: scope.id, label: k.label, type: ps.type, unit: ps.unit, value, default: value, min, max,
      ...(ps.type === 'integer' ? { step: 1 } : {}), section: p === c.id ? c.label : `${c.label} (${p})`, description: `${c.label}: ${k.bindings.map(b => `${b.node}.${b.parameter}${b.scale ? ` ×${b.scale}` : ''}`).join(', ')}`,
      editPolicy: ps.editPolicy, bindings: k.bindings.map(b => ({ nodeId: nodeId(b.node), parameter: b.parameter, ...(b.scale ? { scale: b.scale } : {}) })),
    });
  }
  if (c.durationTicks > d.durationTicks) d.durationTicks = c.durationTicks;
  if (!child) return { doc: d, prefix: p };

  // Root side: the Group node, wired from each interface output to what the component fed outside.
  const groupId = p;
  newNode(root, groupId, 'Group', c.label, { graphId: child.id });
  for (const x of crossings) addEdge(root, `${p}-e-group-${x.port}`, { nodeId: groupId, port: x.port }, x.target);
  const rl = d.editor.graphs[root.id]?.nodes;
  if (rl) rl[groupId] = { x: -300, y: Math.max(0, ...Object.values(rl).map(v => v.y)) + 160 };
  return { doc: d, prefix: p, groupNodeId: groupId };
}
