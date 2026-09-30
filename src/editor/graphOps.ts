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
export function pasteSelection(doc: EffectDocumentV2, graphId: string, clip: ClipboardSelection, offset = { x: 40, y: 40 }, opts: { preservePattern?: boolean } = {}): OpResult {
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
    // 07/22 F05: a copy gets its own random stream (a different pattern); Preserve pattern keeps the stream, so the copy
    // samples the same random quantities while its node (and so every particle object ID) stays distinct.
    g.nodes.push({ ...structuredClone(n), id, randomStreamId: opts.preservePattern ? n.randomStreamId : freshId(`rs-${id}`, taken) });
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
export function duplicateSelection(doc: EffectDocumentV2, graphId: string, ids: readonly string[], opts: { preservePattern?: boolean } = {}): OpResult {
  const c = copySelection(doc, graphId, ids);
  return c.ok ? pasteSelection(doc, graphId, c.value, undefined, opts) : c;
}

/**
 * 06 "Remove and reconnect": deletes one node and joins each of its downstream connections to the upstream source
 * that fed it with the same port type (e.g. drop a Drag from Emitter → Drag → Billboard to get Emitter → Billboard).
 * Connections without a same-typed upstream are simply removed (consumers keep their literals). Validated; refused
 * rather than partly applied.
 */
export function removeAndReconnect(doc: EffectDocumentV2, graphId: string, nodeId: string): OpResult {
  const d = structuredClone(doc);
  const g = d.graphs.find(x => x.id === graphId);
  const n = g?.nodes.find(x => x.id === nodeId);
  if (!g || !n) return { ok: false, message: `Node "${nodeId}" is not in graph "${graphId}".` };
  if (PROTECTED.has(n.type) || n.type === GROUP_NODE_TYPE) return { ok: false, message: `${n.type} cannot be removed with reconnect.` };
  const specOf = (x: NodeDefinition | undefined) => (x ? registry.get(`${x.type}@${x.definitionVersion}`) : undefined);
  const spec = specOf(n);
  const typeOut = (e: EdgeDefinition) => specOf(g.nodes.find(x => x.id === e.source.nodeId))?.outputs.find(p => p.id === e.source.port)?.type;
  const incoming = g.edges.filter(e => e.target.nodeId === nodeId), outgoing = g.edges.filter(e => e.source.nodeId === nodeId);
  const notes: string[] = [];
  const taken = new Set(d.graphs.flatMap(x => x.edges.map(e => e.id)));
  const added: EdgeDefinition[] = [];
  for (const o of outgoing) {
    const t = spec?.outputs.find(p => p.id === o.source.port)?.type;
    const up = incoming.find(i => spec?.inputs.find(p => p.id === i.target.port)?.type === t && typeOut(i) === t);
    if (!up) { notes.push(`"${o.target.nodeId}.${o.target.port}" lost its ${o.source.port} input (nothing of that type fed ${n.label}).`); continue; }
    added.push({ ...structuredClone(o), id: freshId(`e_${up.source.nodeId}_${o.target.nodeId}`, taken), source: { ...up.source } });
  }
  g.nodes = g.nodes.filter(x => x.id !== nodeId);
  g.edges = [...g.edges.filter(e => e.source.nodeId !== nodeId && e.target.nodeId !== nodeId), ...added];
  delete d.editor.graphs[graphId]?.nodes[nodeId];
  const v = validateDocument(d, { registry });
  if (!v.ok) return { ok: false, message: `Remove and reconnect refused: ${v.errors[0]?.message ?? 'the result would be invalid'}` };
  return { ok: true, doc: d, newIds: added.map(e => e.id), notes };
}
