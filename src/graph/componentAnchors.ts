// Which document anchors an inserted component (Group) starts from and aims at, and re-pointing them (user 2026-10-21:
// "I still don't see an easy way to connect them to different anchors"). Covers both layouts insertComponent made:
// Source/Target anchor inputs on the Group box (wired from an Anchor node next to it), and older groups that keep
// their own Anchor copies inside (ids ending in -source / -target).
import type { EffectDocumentV2 } from '../model/types.ts';

export type AnchorRole = 'source' | 'target';
export type AnchorSlot = { role: AnchorRole; anchorId: string | undefined };

const ROLES: AnchorRole[] = ['source', 'target'];

function locate(doc: EffectDocumentV2, groupNodeId: string) {
  const parent = doc.graphs.find(g => g.nodes.some(n => n.id === groupNodeId && n.type === 'Group'));
  const group = parent?.nodes.find(n => n.id === groupNodeId);
  const child = doc.graphs.find(g => g.id === group?.params.graphId);
  return parent && group && child ? { parent, child } : undefined;
}

/** Anchor nodes inside the group (nested groups included) playing `role` in the older layout. */
function innerAnchors(doc: EffectDocumentV2, graphId: string, role: AnchorRole, seen = new Set<string>()): { graphId: string; nodeId: string }[] {
  const g = doc.graphs.find(x => x.id === graphId);
  if (!g || seen.has(graphId)) return [];
  seen.add(graphId);
  return g.nodes.flatMap(n => n.type === 'Anchor' && n.id.endsWith(`-${role}`) ? [{ graphId, nodeId: n.id }]
    : n.type === 'Group' ? innerAnchors(doc, String(n.params.graphId), role, seen) : []);
}

/** The component's Source/Target slots and the document anchor each follows now (empty when it has none). */
export function componentAnchorSlots(doc: EffectDocumentV2, groupNodeId: string): AnchorSlot[] {
  const at = locate(doc, groupNodeId);
  if (!at) return [];
  return ROLES.flatMap(role => {
    if (at.child.inputs.some(p => p.id === role && p.type === 'anchor')) {
      const e = at.parent.edges.find(x => x.target.nodeId === groupNodeId && x.target.port === role);
      const from = e && at.parent.nodes.find(n => n.id === e.source.nodeId);
      return [{ role, anchorId: from?.type === 'Anchor' ? String(from.params.anchorId) : undefined }];
    }
    const inner = innerAnchors(doc, at.child.id, role);
    if (!inner.length) return [];
    const n = doc.graphs.find(g => g.id === inner[0].graphId)!.nodes.find(x => x.id === inner[0].nodeId)!;
    return [{ role, anchorId: String(n.params.anchorId) }];
  });
}

/** A copy of `doc` where the component's `role` follows document anchor `anchorId`. */
export function setComponentAnchor(doc: EffectDocumentV2, groupNodeId: string, role: AnchorRole, anchorId: string): EffectDocumentV2 {
  const d = structuredClone(doc), at = locate(d, groupNodeId);
  if (!at) throw new Error(`"${groupNodeId}" is not a component (Group) node.`);
  if (!d.anchors.some(a => a.id === anchorId)) throw new Error(`Anchor "${anchorId}" does not exist.`);
  if (at.child.inputs.some(p => p.id === role && p.type === 'anchor')) {
    // Reuse the Anchor node for that anchor next to the group, or add one beside the group box.
    let from = at.parent.nodes.find(n => n.type === 'Anchor' && n.params.anchorId === anchorId && n.enabled)?.id;
    if (!from) {
      const ids = new Set(d.graphs.flatMap(g => g.nodes.map(n => n.id)));
      from = `${anchorId}-node`;
      for (let i = 2; ids.has(from); i++) from = `${anchorId}-node-${i}`;
      const name = d.anchors.find(a => a.id === anchorId)!.name;
      at.parent.nodes.push({ id: from, type: 'Anchor', definitionVersion: 1, label: name, enabled: true, randomStreamId: `rs-${from}`, params: { anchorId } });
      const layout = d.editor.graphs[at.parent.id]?.nodes, g = layout?.[groupNodeId];
      if (layout) layout[from] = { x: (g?.x ?? 0) - 320, y: (g?.y ?? 0) + (role === 'target' ? 120 : 0) };
    }
    at.parent.edges = at.parent.edges.filter(e => !(e.target.nodeId === groupNodeId && e.target.port === role));
    let id = `${groupNodeId}-e-${role}-in`;
    for (let i = 2; d.graphs.some(g => g.edges.some(e => e.id === id)); i++) id = `${groupNodeId}-e-${role}-in-${i}`;
    at.parent.edges.push({ id, source: { nodeId: from, port: 'out' }, target: { nodeId: groupNodeId, port: role }, order: 0 });
    return d;
  }
  for (const x of innerAnchors(d, at.child.id, role)) d.graphs.find(g => g.id === x.graphId)!.nodes.find(n => n.id === x.nodeId)!.params.anchorId = anchorId;
  return d;
}

/** The Group node a Controls section belongs to (its controls are scoped to the group's graph), if any. */
export function groupOfScope(doc: EffectDocumentV2, scopeGraphIds: string[]): string | undefined {
  const groups = doc.graphs.flatMap(g => g.nodes.filter(n => n.type === 'Group' && scopeGraphIds.includes(String(n.params.graphId))).map(n => ({ n, top: g.id === doc.rootGraphId })));
  return (groups.find(x => x.top) ?? groups[0])?.n.id;
}
