// 12-EDITOR graph operations shared by keyboard shortcuts, the toolbar and the context menu: Duplicate (Ctrl/Cmd+D)
// and Copy/Paste as application JSON (Ctrl/Cmd+C / V) "with schema validation and asset reference reconciliation".
// Pure: each returns the next document (callers commit it as one undoable edit) or a refusal with the reason.
import type { AssetReference, EdgeDefinition, EffectDocumentV2, NodeDefinition } from '../model/types.ts';
import { validateDocument } from '../model/document.ts';
import { createRegistry } from '../graph/registry.ts';
import { GROUP_NODE_TYPE } from '../graph/signature.ts';
import { insertUserComponent, saveGroupAsComponent, type UserComponent } from '../graph/userComponents.ts';

export const CLIPBOARD_FORMAT = 'vfx-studio-selection';
export type ClipboardSelection = {
  format: typeof CLIPBOARD_FORMAT; version: 1;
  /** Plain nodes and the edges between them (edges to nodes outside the selection are not copied). */
  nodes: NodeDefinition[]; edges: EdgeDefinition[]; layout: Record<string, { x: number; y: number }>;
  /** Selected Group nodes travel as self-contained components (their graphs, knobs, anchors, assets). */
  groups: UserComponent[];
  /** Asset records the copied nodes reference (bytes stay in the local store; paste reports missing ones). */
  assets: AssetReference[];
};
export type OpResult = { ok: true; doc: EffectDocumentV2; newIds: string[]; notes: string[] } | { ok: false; message: string };

const PROTECTED = new Set(['EffectOutput', 'GroupInput', 'GroupOutput']);
const registry = createRegistry();

function freshId(base: string, taken: Set<string>): string {
  const stem = base.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'node';
  for (let i = 2; ; i++) { const id = `${stem}_${i}`; if (!taken.has(id)) { taken.add(id); return id; } }
}

/** Copies the chosen nodes of one graph into a clipboard payload. */
export function copySelection(doc: EffectDocumentV2, graphId: string, ids: readonly string[]): { ok: true; value: ClipboardSelection } | { ok: false; message: string } {
  const g = doc.graphs.find(x => x.id === graphId);
  if (!g) return { ok: false, message: `Graph "${graphId}" does not exist.` };
  const chosen = g.nodes.filter(n => ids.includes(n.id));
  const blocked = chosen.filter(n => PROTECTED.has(n.type));
  const plain = chosen.filter(n => !PROTECTED.has(n.type) && n.type !== GROUP_NODE_TYPE);
  const groups: UserComponent[] = [];
  for (const n of chosen.filter(x => x.type === GROUP_NODE_TYPE)) {
    const r = saveGroupAsComponent(doc, n.id, n.label || n.id);
    if (!r.ok) return { ok: false, message: r.message };
    groups.push(r.value);
  }
  if (!plain.length && !groups.length) return { ok: false, message: blocked.length ? `${blocked.map(n => n.type).join(', ')} cannot be copied.` : 'Nothing selected to copy.' };
  const inSet = new Set(plain.map(n => n.id));
  const assetIds = new Set(plain.flatMap(n => Object.values(n.params)).filter((v): v is string => typeof v === 'string' && doc.assets.some(a => a.id === v)));
  const layout = doc.editor.graphs[graphId]?.nodes ?? {};
  return {
    ok: true,
    value: {
      format: CLIPBOARD_FORMAT, version: 1,
      nodes: structuredClone(plain), edges: structuredClone(g.edges.filter(e => inSet.has(e.source.nodeId) && inSet.has(e.target.nodeId))),
      layout: Object.fromEntries(plain.filter(n => layout[n.id]).map(n => [n.id, { ...layout[n.id] }])),
      groups, assets: structuredClone(doc.assets.filter(a => assetIds.has(a.id))),
    },
  };
}

/** Parses clipboard text; anything that is not a selection payload is refused with a reason. */
export function parseClipboard(text: string): { ok: true; value: ClipboardSelection } | { ok: false; message: string } {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return { ok: false, message: 'The clipboard does not hold VFX Studio nodes.' }; }
  const s = v as Partial<ClipboardSelection>;
  if (!s || s.format !== CLIPBOARD_FORMAT || s.version !== 1 || !Array.isArray(s.nodes) || !Array.isArray(s.edges) || !Array.isArray(s.groups) || !Array.isArray(s.assets) || typeof s.layout !== 'object')
    return { ok: false, message: 'The clipboard does not hold VFX Studio nodes (or holds them in an unknown version).' };
  return { ok: true, value: s as ClipboardSelection };
}

/**
 * Pastes a payload into `graphId` with fresh node/edge/random-stream IDs (so copies never share randomness), offset
 * from the originals, then validates the whole document; an invalid paste is refused, never partly applied.
 */
export function pasteSelection(doc: EffectDocumentV2, graphId: string, clip: ClipboardSelection, offset = { x: 40, y: 40 }): OpResult {
  let d = structuredClone(doc);
  const g = d.graphs.find(x => x.id === graphId);
  if (!g) return { ok: false, message: `Graph "${graphId}" does not exist.` };
  const bad = clip.nodes.find(n => !registry.has(`${n.type}@${n.definitionVersion}`) || PROTECTED.has(n.type) || n.type === GROUP_NODE_TYPE);
  if (bad) return { ok: false, message: `Cannot paste node "${bad.id}" of type ${bad.type}.` };
  const taken = new Set([...d.graphs.flatMap(x => [x.id, ...x.nodes.flatMap(n => [n.id, n.randomStreamId]), ...x.edges.map(e => e.id)]), ...d.controls.map(c => c.id), ...d.anchors.map(a => a.id)]);
  const map = new Map<string, string>(), newIds: string[] = [], notes: string[] = [];
  for (const n of clip.nodes) {
    const id = freshId(n.id.replace(/_\d+$/, ''), taken);
    map.set(n.id, id); newIds.push(id);
    g.nodes.push({ ...structuredClone(n), id, randomStreamId: freshId(`rs-${id}`, taken) });
    const p = clip.layout[n.id];
    if (p) { d.editor.graphs[graphId] ??= { nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } }; d.editor.graphs[graphId].nodes[id] = { x: p.x + offset.x, y: p.y + offset.y }; }
  }
  for (const e of clip.edges) {
    const s = map.get(e.source.nodeId), t = map.get(e.target.nodeId);
    if (!s || !t) continue;
    g.edges.push({ ...structuredClone(e), id: freshId(`e_${s}_${t}`, taken), source: { ...e.source, nodeId: s }, target: { ...e.target, nodeId: t } });
  }
  for (const a of clip.assets) if (!d.assets.some(x => x.id === a.id)) { d.assets.push(structuredClone(a)); notes.push(`Added the asset record for ${a.provenance.originalFilename}.`); }
  for (const comp of clip.groups) {
    const r = insertUserComponent(d, comp, graphId);
    d = r.doc; newIds.push(r.groupNodeId);
  }
  const v = validateDocument(d, { registry });
  if (!v.ok) return { ok: false, message: `Paste refused: ${v.errors[0]?.message ?? 'the result would be invalid'}` };
  return { ok: true, doc: d, newIds, notes };
}

/** Duplicate = copy + paste into the same graph (Group nodes become independent copies of their component). */
export function duplicateSelection(doc: EffectDocumentV2, graphId: string, ids: readonly string[]): OpResult {
  const c = copySelection(doc, graphId, ids);
  return c.ok ? pasteSelection(doc, graphId, c.value) : c;
}
