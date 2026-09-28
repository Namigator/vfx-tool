// Reusable groups (17 A-05 "Save a reusable group, insert twice, edit one instance, the other is unchanged"):
// a Group's child graph (with nested groups), the knobs scoped to it, the anchors and imported assets it uses
// are saved as a user component; inserting one makes an independent copy with fresh ids. Pure functions; the
// browser store for saved components lives in model/assetStore.ts (openProjectStorage).
import type { AnchorDefinition, AssetReference, EffectDocumentV2, GraphDefinition, PublicControl } from '../model/types.ts';
import { GROUP_NODE_TYPE } from '../model/controls.ts';

export type UserComponent = {
  id: string; name: string; savedAt: string;
  /** Child graph of the saved Group first, then every nested group graph. */
  graphs: GraphDefinition[];
  controls: PublicControl[];
  anchors: AnchorDefinition[];
  assets: AssetReference[];
  layouts: Record<string, Record<string, { x: number; y: number }>>;
  durationTicks: number;
};

export const USER_COMPONENTS_KEY = 'vfx-studio.v2.user-components';
const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-component';

/** Snapshot of a Group node as a reusable component. */
export function saveGroupAsComponent(doc: EffectDocumentV2, groupNodeId: string, name: string, now = new Date()): { ok: true; value: UserComponent } | { ok: false; message: string } {
  const group = doc.graphs.flatMap(g => g.nodes).find(n => n.id === groupNodeId);
  if (!group || group.type !== GROUP_NODE_TYPE) return { ok: false, message: 'Select a Group node to save it as a component.' };
  const graphs: GraphDefinition[] = [], seen = new Set<string>();
  const collect = (id: unknown) => {
    const g = doc.graphs.find(x => x.id === id);
    if (!g || seen.has(g.id)) return;
    seen.add(g.id); graphs.push(structuredClone(g));
    for (const n of g.nodes) if (n.type === GROUP_NODE_TYPE) collect(n.params.graphId);
  };
  collect(group.params.graphId);
  if (!graphs.length) return { ok: false, message: 'This Group has no internal graph.' };
  const nodes = graphs.flatMap(g => g.nodes);
  const anchorIds = new Set(nodes.filter(n => n.type === 'Anchor').map(n => n.params.anchorId));
  const assetIds = new Set(nodes.flatMap(n => [n.params.textureAsset, n.params.meshAsset]).filter(v => typeof v === 'string' && v));
  const layouts: UserComponent['layouts'] = {};
  for (const g of graphs) layouts[g.id] = structuredClone(doc.editor.graphs[g.id]?.nodes ?? {});
  return {
    ok: true,
    value: {
      id: `${safe(name)}-${now.getTime().toString(36)}`, name: name.trim() || group.label || 'My component', savedAt: now.toISOString(),
      graphs, controls: structuredClone(doc.controls.filter(c => seen.has(c.scopeGraphId))),
      anchors: structuredClone(doc.anchors.filter(a => anchorIds.has(a.id))),
      assets: structuredClone(doc.assets.filter(a => assetIds.has(a.id))),
      layouts, durationTicks: doc.durationTicks,
    },
  };
}

/** Inserts an independent copy of `comp` as one new Group node in `graphId` (its interface ports start unwired). */
export function insertUserComponent(doc: EffectDocumentV2, comp: UserComponent, graphId: string = doc.rootGraphId): { doc: EffectDocumentV2; groupNodeId: string } {
  const d = structuredClone(doc);
  const target = d.graphs.find(g => g.id === graphId);
  if (!target) throw new Error(`Graph "${graphId}" does not exist.`);
  const taken = new Set([...d.graphs.flatMap(g => [g.id, ...g.nodes.map(n => n.id), ...g.edges.map(e => e.id)]), ...d.controls.map(c => c.id)]);
  const base = safe(comp.name);
  let p = base;
  for (let i = 2; taken.has(p) || comp.graphs.some(g => taken.has(`${p}-${g.id}`)); i++) p = `${base}-${i}`;
  const gid = (id: string) => `${p}-${id}`, nid = (id: string) => `${p}-${id}`, cid = (id: string) => `${p}-${id}`;
  const graphIds = new Set(comp.graphs.map(g => g.id));
  const groupNodeIds = new Set(comp.graphs.flatMap(g => g.nodes.filter(n => n.type === GROUP_NODE_TYPE).map(n => n.id)));
  for (const g of comp.graphs) {
    d.graphs.push({
      ...structuredClone(g), id: gid(g.id),
      nodes: g.nodes.map(n => ({
        ...structuredClone(n), id: nid(n.id), randomStreamId: `rs-${nid(n.id)}`,
        params: n.type === GROUP_NODE_TYPE && typeof n.params.graphId === 'string' && graphIds.has(n.params.graphId) ? { ...structuredClone(n.params), graphId: gid(n.params.graphId) } : structuredClone(n.params),
      })),
      edges: g.edges.map(e => ({ ...structuredClone(e), id: `${p}-${e.id}`, source: { ...e.source, nodeId: nid(e.source.nodeId) }, target: { ...e.target, nodeId: nid(e.target.nodeId) } })),
    });
    d.editor.graphs[gid(g.id)] = { nodes: Object.fromEntries(Object.entries(comp.layouts[g.id] ?? {}).map(([k, v]) => [nid(k), { ...v }])), viewport: { x: 0, y: 0, zoom: 1 } };
  }
  const section = `${comp.name} (${p})`;
  for (const c of comp.controls) {
    d.controls.push({
      ...structuredClone(c), id: cid(c.id), scopeGraphId: gid(c.scopeGraphId), section,
      // A binding to a nested Group's exposed control names that control's id as the parameter.
      bindings: c.bindings.map(b => ({ ...b, nodeId: nid(b.nodeId), parameter: groupNodeIds.has(b.nodeId) ? cid(b.parameter) : b.parameter })),
    });
  }
  for (const a of comp.anchors) if (!d.anchors.some(x => x.id === a.id)) d.anchors.push(structuredClone(a));
  for (const a of comp.assets) if (!d.assets.some(x => x.id === a.id)) d.assets.push(structuredClone(a));
  const groupNodeId = p;
  target.nodes.push({ id: groupNodeId, type: GROUP_NODE_TYPE, definitionVersion: 1, label: comp.name, enabled: true, randomStreamId: `rs-${groupNodeId}`, params: { graphId: gid(comp.graphs[0].id) } });
  // Visual/presentation outputs feed this graph's EffectOutput (when it has one) so the copy shows at once.
  const out = target.nodes.find(n => n.type === 'EffectOutput');
  if (out) for (const port of comp.graphs[0].outputs) {
    if (port.type !== 'visual' && port.type !== 'presentation') continue;
    const order = target.edges.filter(e => e.target.nodeId === out.id && e.target.port === port.type).length;
    target.edges.push({ id: `${p}-e-out-${port.id}`, source: { nodeId: groupNodeId, port: port.id }, target: { nodeId: out.id, port: port.type }, order });
  }
  const layout = d.editor.graphs[graphId]?.nodes;
  if (layout) layout[groupNodeId] = { x: -300, y: Math.max(0, ...Object.values(layout).map(v => v.y)) + 160 };
  if (comp.durationTicks > d.durationTicks) d.durationTicks = comp.durationTicks;
  return { doc: d, groupNodeId };
}
