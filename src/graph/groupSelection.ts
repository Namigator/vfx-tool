// Wrap selection as group (06 "Group", 12 editor): moves selected nodes of one graph into a new child graph
// instantiated by one Group node in their place. Links that cross the boundary become interface ports with
// GroupInput/GroupOutput bridges; knobs that only drive moved nodes move with them (exposed on the Group).
// Pure: returns a new document or the reason the selection cannot be grouped; the input is never mutated.
import type { EffectDocumentV2, EdgeDefinition, GraphDefinition, InterfacePort, NodeDefinition, PortSpec } from '../model/types.ts';
import { GROUP_NODE_TYPE } from '../model/controls.ts';
import { analyzeGraph } from './analyze.ts';
import { createRegistry } from './registry.ts';

export type GroupSelectionResult =
  | { ok: true; doc: EffectDocumentV2; groupNodeId: string; childGraphId: string }
  | { ok: false; message: string };

const NOT_GROUPABLE = new Set(['EffectOutput', 'GroupInput', 'GroupOutput']);
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '-');

export function groupSelection(doc: EffectDocumentV2, graphId: string, nodeIds: readonly string[], label = 'Group'): GroupSelectionResult {
  const d = structuredClone(doc);
  const g = d.graphs.find(x => x.id === graphId);
  if (!g) return { ok: false, message: `Graph "${graphId}" does not exist.` };
  const picked = new Set(nodeIds);
  if (!picked.size) return { ok: false, message: 'Select at least one node to group (Shift+click adds nodes).' };
  const moved = g.nodes.filter(n => picked.has(n.id));
  if (moved.length !== picked.size) return { ok: false, message: 'Some selected nodes are not in this graph.' };
  const blocked = moved.find(n => NOT_GROUPABLE.has(n.type));
  if (blocked) return { ok: false, message: `${blocked.label || blocked.type} cannot go inside a group (it is the graph's ${blocked.type === 'EffectOutput' ? 'output' : 'group bridge'}).` };
  const audio = moved.find(n => n.type.startsWith('Audio'));
  if (audio) return { ok: false, message: `Sound nodes stay outside groups (the sound mix reads the main graph only): deselect ${audio.label || audio.id}.` };

  // Knobs: a control whose bindings touch moved nodes must drive only moved nodes, then it moves into the group.
  const movedControls = d.controls.filter(c => c.scopeGraphId === graphId && c.bindings.some(b => picked.has(b.nodeId)));
  const split = movedControls.find(c => c.bindings.some(b => !picked.has(b.nodeId)));
  if (split) return { ok: false, message: `Knob "${split.label}" drives nodes inside and outside the selection; select all of them or none.` };

  // Port types come from the analysed signatures (per-instance types such as signal units included).
  const analysis = analyzeGraph(doc, { registry: createRegistry() });
  if (!analysis.ok) return { ok: false, message: `Fix the graph's errors before grouping: ${analysis.errors[0]?.message ?? 'invalid document'}.` };
  const sigs = analysis.value.graphs.find(x => x.graphId === graphId)?.signatures ?? [];
  const portOf = (nodeId: string, port: string, dir: 'inputs' | 'outputs') => sigs.find(s => s.nodeId === nodeId)?.[dir].find(p => p.id === port);

  const taken = new Set([...d.graphs.flatMap(x => [x.id, ...x.nodes.map(n => n.id), ...x.edges.map(e => e.id)])]);
  const fresh = (base: string) => { let id = safe(base); for (let i = 2; taken.has(id); i++) id = `${safe(base)}-${i}`; taken.add(id); return id; };
  const groupId = fresh('group'), childId = fresh(`graph-${groupId}`);
  const child: GraphDefinition = { id: childId, inputs: [], outputs: [], nodes: moved, edges: [] };
  const groupNode: NodeDefinition = { id: groupId, type: GROUP_NODE_TYPE, definitionVersion: 1, label, enabled: true, randomStreamId: `rs-${groupId}`, params: { graphId: childId } };
  const kept: EdgeDefinition[] = [];
  const inputs = new Map<string, string>(), outputs = new Map<string, string>(); // "node\0port" -> interface port id
  const bridge = (type: 'GroupInput' | 'GroupOutput', portId: string): string => {
    const id = fresh(`${groupId}-${type === 'GroupInput' ? 'in' : 'out'}-${portId}`);
    child.nodes.push({ id, type, definitionVersion: 1, label: `${type === 'GroupInput' ? 'In' : 'Out'}: ${portId}`, enabled: true, randomStreamId: `rs-${id}`, params: { portId } });
    return id;
  };
  /** Interface port typed like the port it stands for (type, and unit/domains for signals). */
  const addPort = (list: InterfacePort[], id: string, from: PortSpec | undefined, direction: 'input' | 'output', labelText: string, cardinality: InterfacePort['cardinality']) =>
    list.push({ id, label: labelText, type: from?.type ?? 'event', ...(from?.unit ? { unit: from.unit } : {}), ...(from?.domains ? { domains: [...from.domains] } : {}), cardinality, required: false, direction });
  const bridges = new Map<string, string>(); // port id -> bridge node id

  for (const e of g.edges) {
    const sIn = picked.has(e.source.nodeId), tIn = picked.has(e.target.nodeId);
    if (sIn && tIn) { child.edges.push(e); continue; }
    if (!sIn && !tIn) { kept.push(e); continue; }
    if (sIn) {
      // Leaving: one interface output per inside source port; the root edge now starts at the Group.
      const key = `${e.source.nodeId}\u0000${e.source.port}`;
      let port = outputs.get(key);
      if (!port) {
        port = fresh(`${e.source.nodeId}-${e.source.port}`);
        outputs.set(key, port);
        addPort(child.outputs, port, portOf(e.source.nodeId, e.source.port, 'outputs'), 'output', `${e.source.nodeId}.${e.source.port}`, 'many');
        const b = bridge('GroupOutput', port);
        bridges.set(port, b);
        child.edges.push({ id: fresh(`${b}-e`), source: { ...e.source }, target: { nodeId: b, port: 'in' }, order: 0 });
      }
      kept.push({ ...e, source: { nodeId: groupId, port } });
    } else {
      // Entering: one interface input per outside source port, read inside by a GroupInput bridge.
      const key = `${e.source.nodeId}\u0000${e.source.port}`;
      let port = inputs.get(key);
      if (!port) {
        port = fresh(`${e.source.nodeId}-${e.source.port}`);
        inputs.set(key, port);
        const tp = portOf(e.target.nodeId, e.target.port, 'inputs');
        addPort(child.inputs, port, portOf(e.source.nodeId, e.source.port, 'outputs') ?? tp, 'input', `${e.source.nodeId}.${e.source.port}`, 'one');
        bridges.set(port, bridge('GroupInput', port));
        kept.push({ id: fresh(`${groupId}-e-${port}`), source: { ...e.source }, target: { nodeId: groupId, port }, order: 0 });
      }
      child.edges.push({ ...e, source: { nodeId: bridges.get(port)!, port: 'out' } });
    }
  }

  g.nodes = [...g.nodes.filter(n => !picked.has(n.id)), groupNode];
  g.edges = kept;
  d.graphs.push(child);
  for (const c of movedControls) c.scopeGraphId = childId;

  // Layout: the Group sits where the selection was; inside, nodes keep their arrangement, bridges at the edges.
  const layout = d.editor.graphs[graphId]?.nodes ?? {};
  const pts = moved.map(n => layout[n.id]).filter((p): p is { x: number; y: number } => p !== undefined);
  const cx = pts.length ? pts.reduce((a, p) => a + p.x, 0) / pts.length : 0, cy = pts.length ? pts.reduce((a, p) => a + p.y, 0) / pts.length : 0;
  const minX = pts.length ? Math.min(...pts.map(p => p.x)) : 0, maxX = pts.length ? Math.max(...pts.map(p => p.x)) : 0, minY = pts.length ? Math.min(...pts.map(p => p.y)) : 0;
  const inner: Record<string, { x: number; y: number }> = {};
  for (const n of moved) { if (layout[n.id]) inner[n.id] = { ...layout[n.id] }; delete layout[n.id]; }
  [...child.inputs].forEach((p, i) => { inner[bridges.get(p.id)!] = { x: minX - 300, y: minY + 140 * i }; });
  [...child.outputs].forEach((p, i) => { inner[bridges.get(p.id)!] = { x: maxX + 300, y: minY + 140 * i }; });
  layout[groupId] = { x: Math.round(cx), y: Math.round(cy) };
  if (d.editor.graphs[graphId]) d.editor.graphs[graphId].nodes = layout;
  d.editor.graphs[childId] = { nodes: inner, viewport: { x: 0, y: 0, zoom: 1 } };
  return { ok: true, doc: d, groupNodeId: groupId, childGraphId: childId };
}
