// 06 Solo: "a preview mask, not authored enable state. It filters visible/audible sink layers; dependency simulation
// still executes, preserving timing. Multiple solo nodes form a union. Disabled nodes do not become enabled merely
// because Solo is selected." A soloed component (Group) solos every sink inside it, nested groups included.
import type { EffectDocumentV2 } from '../model/types.ts';

/** Node types that draw something (the layers Solo can show or hide). */
export const SOLO_SINK_TYPES = new Set(['BillboardRenderer', 'SpriteRenderer', 'RibbonRenderer', 'ParticleTrail', 'MotionTrail', 'MeshRenderer', 'PropMesh', 'PointLight']);

export const canSolo = (type: string) => type === 'Group' || SOLO_SINK_TYPES.has(type);

/** Sink node IDs to keep visible, or null when nothing is soloed (no mask). */
export function soloMask(doc: EffectDocumentV2, soloed: ReadonlySet<string>): Set<string> | null {
  if (!soloed.size) return null;
  const byId = new Map(doc.graphs.flatMap(g => g.nodes.map(n => [n.id, n] as const)));
  const graphs = new Map(doc.graphs.map(g => [g.id, g]));
  const keep = new Set<string>(), seen = new Set<string>();
  const add = (id: string) => {
    const n = byId.get(id);
    if (!n || seen.has(id)) return;
    seen.add(id);
    if (SOLO_SINK_TYPES.has(n.type)) keep.add(id);
    if (n.type === 'Group' && typeof n.params.graphId === 'string') for (const c of graphs.get(n.params.graphId)?.nodes ?? []) add(c.id);
  };
  for (const id of soloed) add(id);
  return keep;
}
