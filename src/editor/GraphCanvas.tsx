// Controlled node canvas for one graph of an EffectDocumentV2 (12-EDITOR). The document prop is
// authoritative: every authored change leaves through onEdit as history patches, and React Flow change
// events never mutate it. Only the in-progress drag preview and edge selection are local state.
// Keyboard (12): Delete, Enter opens a group, Ctrl/Cmd+D duplicate, Ctrl/Cmd+G group, Ctrl/Cmd+C/V copy/paste, Escape
// clears the selection (then goes up a level), F fits. Drag on empty canvas box-selects; middle/right drag or Space pans.
import { NODE_CATEGORIES, NODE_INFO, nodeDoc } from '../graph/nodeDocs.ts';
import { COMPONENT_TEMPLATES, componentPlacement, eventSources, getComponent, insertComponent, startComponentOnEvent } from '../graph/components.ts';
import { groupSelection } from '../graph/groupSelection.ts';
import { insertUserComponent, saveGroupAsComponent } from '../graph/userComponents.ts';
import { removeUserComponent, saveUserComponent, useUserComponents } from './userComponentStore.ts';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Handle, Panel, SelectionMode, Position, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps, type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './graph-canvas.css';
import type { Patch as HistoryPatch } from './history.ts';
import type { Diagnostic, EdgeDefinition, EffectDocumentV2, GraphDefinition, NodeDefinition, NodeSpec, PortSpec } from '../model/types.ts';
import { registryKey } from '../model/controls.ts';
import { createRegistry } from '../graph/registry.ts';
import { GROUP_NODE_TYPE, resolveSignature, type ResolvedSignature } from '../graph/signature.ts';
import { analyzeGraph } from '../graph/analyze.ts';
import { prepareDocument } from '../graph/prepare.ts';
import { copySelection, duplicateSelection, parseClipboard, pasteSelection, removeAndReconnect } from './graphOps.ts';
import { canSolo } from '../graph/solo.ts';
import { tidyLayout } from '../model/tidyLayout.ts';

export type GraphCanvasProps = {
  document: EffectDocumentV2;
  graphId: string;
  selectedNodeId?: string;
  onSelectNode: (id: string | null) => void;
  onEdit: (label: string, patches: HistoryPatch[]) => void;
  /** 06 Solo (preview-only): shown and toggled on node cards. */
  soloed?: ReadonlySet<string>;
  onToggleSolo?: (id: string) => void;
  /** Changes when the surrounding layout changes size a lot (maximize/restore); the graph refits to the new space. */
  refitKey?: string;
  /** Bumped whenever the document is replaced (New, Open, Load): the camera is re-seeded and the graph re-fitted even
   *  when the new document has the same ID (every blank effect is "doc-blank"). */
  documentEpoch?: number;
};

type CardData = {
  node: NodeDefinition;
  signature: ResolvedSignature | null;
  signatureError: string | null;
  locked: boolean;
  connected: boolean;
  issues: Diagnostic[];
  connectedInputs: ReadonlySet<string>;
  showAdvanced: boolean;
  onToggleEnabled: (nodeId: string, enabled: boolean) => void;
  onToggleAdvanced: (nodeId: string) => void;
  solo: boolean;
  onToggleSolo?: (nodeId: string) => void;
};
type CardNode = Node<CardData, 'card'>;

const registry = createRegistry();
/** Diagnostics that make a tentative connection invalid rather than merely incomplete. */
const BLOCKING_CODES = new Set<Diagnostic['code']>(['TYPE_MISMATCH', 'DOMAIN_MISMATCH', 'MULTIPLE_DRIVERS', 'GRAPH_CYCLE', 'DUPLICATE_ID']);
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };

const specOf = (n: NodeDefinition): NodeSpec | undefined => registry.get(registryKey(n.type, n.definitionVersion));
/** Protected nodes (EffectOutput, group bridges) are not deletable; a Group is deleted together with its own graph. */
const isLocked = (n: NodeDefinition) => specOf(n)?.disabledBehavior === 'protected';
const diagKey = (d: Diagnostic) => `${d.code}\u0000${d.fieldPath ?? ''}\u0000${d.message}`;

function freshId(base: string, taken: ReadonlySet<string>): string {
  const stem = base.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'node';
  for (let i = 1; ; i++) {
    const id = `${stem}_${i}`;
    if (!taken.has(id)) return id;
  }
}

function PortRow({ port, side }: { port: PortSpec; side: 'in' | 'out' }) {
  return (
    <div className={`gc-port gc-port-${side}`} title={`${port.label}: ${port.type}${port.unit && port.unit !== 'none' ? ` (${port.unit})` : ''}${port.cardinality === 'many' ? ', many' : ''}${port.required ? ', required' : ''}`}>
      <Handle id={port.id} type={side === 'in' ? 'target' : 'source'} position={side === 'in' ? Position.Left : Position.Right} className={`gc-handle gc-type-${port.type}`} />
      <span className="gc-port-label">{port.label}{port.required ? ' *' : ''}</span>
      <span className="gc-port-type">{port.type}</span>
    </div>
  );
}

/** Parameter-generated inputs (not registered ports) that are optional; these are the "advanced" handles. */
function isAdvancedPort(node: NodeDefinition, port: PortSpec): boolean {
  const spec = specOf(node);
  if (!spec || port.required) return false;
  return spec.parameters.some(p => p.id === port.id) && !spec.inputs.some(i => i.id === port.id);
}

/** 12 "Node cards show ... a small summary": the few settings that identify a node at a glance. */
function summary(n: NodeDefinition): string {
  const p = n.params as Record<string, unknown>, num = (k: string) => (typeof p[k] === 'number' ? +(p[k] as number).toFixed(3) : undefined);
  switch (n.type) {
    case 'Emitter': return [p.shape, num('burst') ? `burst ${num('burst')}` : '', num('rate') ? `${num('rate')}/s` : ''].filter(Boolean).join(' · ');
    case 'Schedule': return `start ${num('startTicks') ?? 0} · ${num('durationTicks') ?? 0} ticks${p.mode && p.mode !== 'window' ? ` · ${p.mode}` : ''}`;
    case 'Material': return [p.template === 'SpriteTextured' ? (p.textureAsset ? 'imported texture' : p.sprite) : 'plain', p.blend].filter(Boolean).join(' · ');
    case 'Anchor': return String(p.anchorId ?? '');
    case 'PathFollower': return num('speed') ? `${num('speed')} m/s` : `${num('durationTicks') ?? ''} ticks`;
    case 'PointLight': return `intensity ${num('intensity') ?? ''}`;
    case 'MeshRenderer': return String(p.meshAsset ? 'imported model' : p.mesh ?? '');
    default: return '';
  }
}

function NodeCard({ data, selected }: NodeProps<CardNode>) {
  const { node, signature, signatureError, locked, connected, issues, connectedInputs, showAdvanced } = data;
  const protectedEnable = specOf(node)?.disabledBehavior === 'protected';
  const onChange = (e: ChangeEvent<HTMLInputElement>) => data.onToggleEnabled(node.id, e.target.checked);
  const errors = issues.filter(d => d.severity === 'error');
  // Connected parameter handles always stay visible so no wiring is ever hidden.
  const advanced = signature ? signature.inputs.filter(p => isAdvancedPort(node, p)) : [];
  const hiddenCount = advanced.filter(p => !connectedInputs.has(p.id)).length;
  const inputs = signature ? signature.inputs.filter(p => showAdvanced || !isAdvancedPort(node, p) || connectedInputs.has(p.id)) : [];
  return (
    <div className={`gc-card${selected ? ' gc-selected' : ''}${node.enabled ? '' : ' gc-disabled'}`}>
      <div className="gc-card-head">
        <span className="gc-title">{node.label || node.id}</span>
        <span className="gc-type" title={docText(node.type)}>{node.type}{locked ? ' 🔒' : ''}</span>
        {data.onToggleSolo && canSolo(node.type) && (
          <button type="button" className="gc-solo nodrag nopan" aria-pressed={data.solo} onClick={() => data.onToggleSolo!(node.id)}
            title="Solo: show only soloed parts in the preview (does not change the effect)">S</button>
        )}
        <label className="gc-enabled nodrag nopan" title={protectedEnable ? 'This node cannot be disabled.' : 'Enabled'}>
          <input type="checkbox" checked={node.enabled} disabled={protectedEnable} onChange={onChange} aria-label={`Enable ${node.label || node.id}`} />
        </label>
      </div>
      {/* One-line note: what this node does (full text in the Node tab and on hover). */}
      {(() => { const note = cardNote(node); return note ? <div className="gc-note" title={note.full}>{note.short}</div> : null; })()}
      {summary(node) && <div className="gc-summary">{summary(node)}</div>}
      {signature ? (
        <div className="gc-ports">
          <div className="gc-col">{inputs.map(p => <PortRow key={p.id} port={p} side="in" />)}</div>
          <div className="gc-col">{signature.outputs.map(p => <PortRow key={p.id} port={p} side="out" />)}</div>
        </div>
      ) : <div className="gc-issue">{signatureError ?? 'Unregistered node.'}</div>}
      {advanced.length > 0 && (showAdvanced || hiddenCount > 0) && (
        <button type="button" className="gc-advanced nodrag nopan" aria-pressed={showAdvanced}
          onClick={() => data.onToggleAdvanced(node.id)}
          title="Show or hide unconnected parameter input handles.">
          {showAdvanced ? 'Hide advanced ports' : `Advanced ports (${hiddenCount})`}
        </button>
      )}
      <div className="gc-status">
        {!connected && <span className="gc-badge">unconnected</span>}
        {errors.length > 0 && <span className="gc-badge gc-badge-warn" title={errors.map(d => d.message).join('\n')}>{errors.length} issue{errors.length > 1 ? 's' : ''}</span>}
      </div>
    </div>
  );
}

const nodeTypes = { card: NodeCard };

/** Hold time (ms) that turns a touch into a long-press (the platform convention is about 500 ms). */
const LONG_PRESS_MS = 500;
/** Finger movement (px) that turns a would-be long-press into a drag or pan. */
const LONG_PRESS_SLOP_PX = 10;

function Canvas({ document: doc, graphId, selectedNodeId, onSelectNode, onEdit, soloed, onToggleSolo, refitKey, documentEpoch = 0 }: GraphCanvasProps) {
  const [componentId, setComponentId] = useState('');
  /** 12: when the inserted component starts — its own time ("") or an event "nodeId\u0000port" next to it. */
  const [startOn, setStartOn] = useState('');
  const userComponents = useUserComponents();
  const userPick = componentId.startsWith('user:') ? userComponents.find(c => c.id === componentId.slice(5)) : undefined;
  const flow = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const [dragPreview, setDragPreview] = useState<Record<string, { x: number; y: number }>>({});
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(new Set());
  /** Extra nodes picked with Shift+click (for Group selection); the inspector keeps showing the primary node. */
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  // Everything currently selected (picked + the inspector's node), kept in a ref so rapid change batches chain.
  const selectionRef = useRef<ReadonlySet<string>>(new Set());
  selectionRef.current = new Set([...picked, ...(selectedNodeId ? [selectedNodeId] : [])]);
  /** The selection as it was when the pointer went down (before React Flow's own click handling changed it). */
  const clickBaseRef = useRef<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; lines: string[] } | null>(null);
  const [addType, setAddType] = useState('');
  /** Context menu (right click) or the Add-connected-node chooser, at a pane position. */
  const [menu, setMenu] = useState<{ x: number; y: number; flow: { x: number; y: number }; nodeId?: string; from?: { nodeId: string; port: string; side: 'source' | 'target'; portType: string } } | null>(null);
  /** The node / canvas menu at a screen point (right-click on desktop, long-press on touch screens). */
  const openMenuAt = useCallback((clientX: number, clientY: number, nodeId?: string) => {
    const r = wrapper.current!.getBoundingClientRect();
    if (nodeId) onSelectNode(nodeId);
    setMenu({ x: clientX - r.left, y: clientY - r.top, flow: flow.screenToFlowPosition({ x: clientX, y: clientY }), ...(nodeId ? { nodeId } : {}) });
  }, [flow, onSelectNode]);
  // Long-press (touch): the phone's right-click. A finger held still for LONG_PRESS_MS on a node or the canvas opens
  // the same menu; moving it (drag / pan), a second finger (pinch) or lifting it early cancels. The tap that ends a
  // long-press is swallowed so it does not close the menu it just opened.
  const pressRef = useRef<{ timer: number; id: number; x: number; y: number } | null>(null);
  const pressFiredRef = useRef(false);
  const cancelPress = () => { if (pressRef.current) { clearTimeout(pressRef.current.timer); pressRef.current = null; } };
  const onTouchPressStart = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    if (pressRef.current) { cancelPress(); return; } // a second finger: pinch zoom, not a press
    const target = e.target as Element;
    if (target.closest('.react-flow__handle, .gc-menu, input, select, textarea, button, a')) return;
    const nodeId = target.closest('.react-flow__node')?.getAttribute('data-id') ?? undefined;
    const x = e.clientX, y = e.clientY;
    pressFiredRef.current = false;
    pressRef.current = { id: e.pointerId, x, y, timer: window.setTimeout(() => {
      pressRef.current = null;
      pressFiredRef.current = true;
      try { navigator.vibrate?.(12); } catch { /* not allowed */ }
      openMenuAt(x, y, nodeId);
    }, LONG_PRESS_MS) };
  };
  const onTouchPressMove = (e: React.PointerEvent) => {
    const p = pressRef.current;
    if (p && p.id === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP_PX) cancelPress();
  };
  useEffect(() => () => cancelPress(), []);
  // Keep the menu inside the graph area (it opens at the finger, often near an edge on a phone).
  const menuRef = useCallback((el: HTMLDivElement | null) => {
    const host = wrapper.current;
    if (!el || !host) return;
    const maxX = host.clientWidth - el.offsetWidth - 4, maxY = host.clientHeight - el.offsetHeight - 4;
    el.style.left = `${Math.max(4, Math.min(el.offsetLeft, maxX))}px`;
    el.style.top = `${Math.max(4, Math.min(el.offsetTop, maxY))}px`;
  }, []);
  const [advancedNodes, setAdvancedNodes] = useState<ReadonlySet<string>>(new Set());
  const nodesInitialized = useNodesInitialized();
  // The camera is local preview state, never authored/undoable. It is seeded from the saved layout once per
  // document+graph and only changes through user pan/zoom or Fit; re-renders never reapply the saved value.
  const viewKey = `${doc.id}\u0000${graphId}\u0000${documentEpoch}`;
  const [camera, setCamera] = useState<{ key: string; viewport: Viewport }>(() =>
    ({ key: viewKey, viewport: doc.editor.graphs[graphId]?.viewport ?? DEFAULT_VIEWPORT }));
  if (camera.key !== viewKey) setCamera({ key: viewKey, viewport: doc.editor.graphs[graphId]?.viewport ?? DEFAULT_VIEWPORT });
  const onViewportChange = useCallback((viewport: Viewport) => setCamera(c => ({ key: c.key, viewport })), []);
  // React Flow measures nodes but, in controlled mode, only reports sizes as 'dimensions' changes; its
  // useNodesInitialized reads `measured` from our node objects, so those sizes must be fed back here.
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const [paneSized, setPaneSized] = useState(false);
  const fittedKey = useRef<string | null>(null);

  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    const check = () => setPaneSized(el.clientWidth > 0 && el.clientHeight > 0);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit once per document+graph, after nodes are measured and the pane has a real size; selection, edits
  // and drags never refit.
  useEffect(() => {
    if (!nodesInitialized || !paneSized || fittedKey.current === viewKey) return;
    fittedKey.current = viewKey;
    void flow.fitView({ padding: 0.1 });
  }, [nodesInitialized, paneSized, viewKey, flow]);
  // Maximize/restore: refit after the pane has taken its new size.
  const lastRefit = useRef(refitKey);
  useEffect(() => {
    if (lastRefit.current === refitKey) return;
    lastRefit.current = refitKey;
    const t = setTimeout(() => void flow.fitView({ padding: 0.12, duration: 200 }), 60);
    return () => clearTimeout(t);
  }, [refitKey, flow]);

  const toggleAdvanced = useCallback((nodeId: string) => {
    setAdvancedNodes(prev => {
      const next = new Set(prev);
      if (!next.delete(nodeId)) next.add(nodeId);
      return next;
    });
  }, []);

  const gi = doc.graphs.findIndex(g => g.id === graphId);
  const graph = gi >= 0 ? doc.graphs[gi] : undefined;
  const layout = doc.editor.graphs[graphId];

  // Current-document analysis, used for per-node issue badges only (drag never triggers it).
  const analysis = useMemo(() => prepareDocument(doc).analysis, [doc]); // shared with the preview compile
  const issuesByNode = useMemo(() => {
    const m = new Map<string, Diagnostic[]>();
    const list = analysis.ok ? analysis.warnings : analysis.errors;
    for (const d of list) if (d.nodeId) m.set(d.nodeId, [...(m.get(d.nodeId) ?? []), d]);
    return m;
  }, [analysis]);

  const toggleEnabled = useCallback((nodeId: string, enabled: boolean) => {
    const ni = graph?.nodes.findIndex(n => n.id === nodeId) ?? -1;
    if (ni < 0) return;
    onEdit(`${enabled ? 'Enable' : 'Disable'} ${nodeId}`, [{ op: 'set', path: ['graphs', gi, 'nodes', ni, 'enabled'], value: enabled }]);
  }, [graph, gi, onEdit]);

  const nodes: CardNode[] = useMemo(() => {
    if (!graph) return [];
    const touched = new Set(graph.edges.flatMap(e => [e.source.nodeId, e.target.nodeId]));
    return graph.nodes.map((n, i) => {
      const spec = specOf(n);
      const sig = spec ? resolveSignature(n, spec, { doc, graphId }) : null;
      const position = dragPreview[n.id] ?? layout?.nodes[n.id] ?? { x: (i % 4) * 260, y: Math.floor(i / 4) * 220 };
      return {
        id: n.id, type: 'card' as const, position, selected: n.id === selectedNodeId || picked.has(n.id), measured: measured[n.id],
        deletable: false,
        data: {
          node: n,
          signature: sig?.ok ? sig.value : null,
          signatureError: sig && !sig.ok ? sig.errors.map(d => d.message).join(' ') : spec ? null : `Unregistered node type ${n.type}@${n.definitionVersion}.`,
          locked: isLocked(n), connected: touched.has(n.id),
          issues: issuesByNode.get(n.id) ?? [], onToggleEnabled: toggleEnabled,
          connectedInputs: new Set(graph.edges.filter(e => e.target.nodeId === n.id).map(e => e.target.port)),
          showAdvanced: advancedNodes.has(n.id), onToggleAdvanced: toggleAdvanced,
          solo: soloed?.has(n.id) ?? false, ...(onToggleSolo ? { onToggleSolo } : {}),
        },
      };
    });
  }, [graph, doc, graphId, layout, dragPreview, measured, selectedNodeId, picked, issuesByNode, toggleEnabled, advancedNodes, toggleAdvanced, soloed, onToggleSolo]);

  const edges: Edge[] = useMemo(() => (graph?.edges ?? []).map(e => ({
    id: e.id, source: e.source.nodeId, sourceHandle: e.source.port, target: e.target.nodeId, targetHandle: e.target.port,
    selected: selectedEdges.has(e.id), deletable: false, className: 'gc-edge',
  })), [graph, selectedEdges]);

  // React Flow reports intents only; nothing here writes the document.
  const onNodesChange = useCallback((changes: NodeChange<CardNode>[]) => {
    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        const p = c.position;
        setDragPreview(prev => ({ ...prev, [c.id]: { x: p.x, y: p.y } }));
      } else if (c.type === 'dimensions' && c.dimensions) {
        const d = c.dimensions;
        setMeasured(prev => prev[c.id]?.width === d.width && prev[c.id]?.height === d.height ? prev : { ...prev, [c.id]: { width: d.width, height: d.height } });
      }
    }
    // Selection: React Flow reports every select/deselect (click, Ctrl/Shift+click toggle, box drag growing and
    // shrinking). Apply them to one running set so consecutive batches chain even before React re-renders; the
    // inspector's primary node stays the same while it is still selected, else the most recently added one.
    const sel = changes.filter((c): c is Extract<NodeChange<CardNode>, { type: 'select' }> => c.type === 'select');
    if (sel.length) {
      const cur = new Set(selectionRef.current);
      for (const c of sel) { if (c.selected) cur.add(c.id); else cur.delete(c.id); }
      selectionRef.current = cur;
      setPicked(cur.size > 1 ? cur : new Set());
      const keep = selectedNodeId !== undefined && cur.has(selectedNodeId);
      const added = sel.filter(c => c.selected).map(c => c.id);
      const primary = keep ? selectedNodeId : (added.at(-1) ?? [...cur].at(-1) ?? null);
      if (primary !== (selectedNodeId ?? null)) onSelectNode(primary ?? null);
    }
  }, [onSelectNode, selectedNodeId]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setSelectedEdges(prev => {
      const next = new Set(prev);
      for (const c of changes) if (c.type === 'select') { if (c.selected) next.add(c.id); else next.delete(c.id); }
      return next;
    });
  }, []);

  const onNodeDragStop = useCallback((_e: unknown, _node: CardNode, dragged: CardNode[]) => {
    setDragPreview({});
    if (!graph || dragged.length === 0) return;
    const round = (v: number) => Math.round(v * 100) / 100;
    const moved = dragged.filter(n => {
      const old = layout?.nodes[n.id];
      return !old || old.x !== round(n.position.x) || old.y !== round(n.position.y);
    });
    if (moved.length === 0) return;
    const patches: HistoryPatch[] = [];
    if (!layout) {
      const pts: Record<string, { x: number; y: number }> = {};
      for (const n of moved) pts[n.id] = { x: round(n.position.x), y: round(n.position.y) };
      patches.push({ op: 'set', path: ['editor', 'graphs', graphId], value: { nodes: pts, viewport: { ...DEFAULT_VIEWPORT } } });
    } else {
      for (const n of moved) patches.push({ op: 'set', path: ['editor', 'graphs', graphId, 'nodes', n.id], value: { x: round(n.position.x), y: round(n.position.y) } });
    }
    onEdit(moved.length === 1 ? `Move ${moved[0].id}` : `Move ${moved.length} nodes`, patches);
  }, [graph, graphId, layout, onEdit]);

  const onConnect = useCallback((c: Connection) => {
    if (!graph || !c.sourceHandle || !c.targetHandle) {
      setNotice({ kind: 'error', lines: ['Connect a named output handle to a named input handle.'] });
      return;
    }
    const ids = new Set(doc.graphs.flatMap(g => g.edges.map(e => e.id)));
    const sameTarget = graph.edges.filter(e => e.target.nodeId === c.target && e.target.port === c.targetHandle);
    const edge: EdgeDefinition = {
      id: freshId(`e_${c.source}_${c.target}`, ids),
      source: { nodeId: c.source, port: c.sourceHandle },
      target: { nodeId: c.target, port: c.targetHandle },
      order: sameTarget.reduce((m, e) => Math.max(m, e.order + 1), 0),
    };
    // Validate with the compiler on a tentative document; only diagnostics this edge introduces count.
    const tentative = structuredClone(doc);
    tentative.graphs[gi].edges.push(edge);
    const after = analyzeGraph(tentative, { registry });
    const before = new Set((analysis.ok ? [] : analysis.errors).map(diagKey));
    const edgePath = `graphs[${gi}].edges[${graph.edges.length}]`;
    const blocking = (after.ok ? [] : after.errors).filter(d => !before.has(diagKey(d)) &&
      (BLOCKING_CODES.has(d.code) || (d.fieldPath ?? '').startsWith(edgePath) || /both an anchor and paths/.test(d.message)));
    if (blocking.length) {
      setNotice({ kind: 'error', lines: [`Connection ${c.source}.${c.sourceHandle} → ${c.target}.${c.targetHandle} rejected:`, ...blocking.map(d => d.message)] });
      return;
    }
    setNotice(null);
    onEdit(`Connect ${c.source}.${c.sourceHandle} → ${c.target}.${c.targetHandle}`,
      [{ op: 'splice', path: ['graphs', gi, 'edges'], index: graph.edges.length, deleteCount: 0, insert: [edge] }]);
  }, [doc, graph, gi, analysis, onEdit]);

  const deleteSelection = useCallback(() => {
    if (!graph) return;
    const selected = graph.nodes.filter(n => selectionRef.current.has(n.id));
    const removable = selected.filter(n => !isLocked(n));
    const groups = removable.filter(n => n.type === GROUP_NODE_TYPE);
    const gone = new Set(removable.map(n => n.id));
    for (const group of groups) for (const n of graph.nodes) {
      if (n.id.startsWith(`${group.id}-`) && n.type.startsWith('Audio')) gone.add(n.id);
    }
    // Shared audio sinks survive while an unremoved source still feeds them.
    for (let changed = true; changed;) {
      changed = false;
      for (const id of [...gone]) {
        const n = graph.nodes.find(x => x.id === id)!;
        if (!selectionRef.current.has(id) && (n.type === 'AudioMix' || n.type === 'AudioOutput') && graph.edges.some(e => e.target.nodeId === id && !gone.has(e.source.nodeId))) { gone.delete(id); changed = true; }
      }
    }
    const bound = removable.filter(n => n.type !== GROUP_NODE_TYPE && doc.controls.some(c => c.bindings.some(b => b.nodeId === n.id)));
    if (bound.length) {
      setNotice({ kind: 'error', lines: [`${bound.map(n => n.label).join(', ')} are bound by published controls; remove those bindings first.`] });
      return;
    }
    const removedEdges = graph.edges.filter(e => selectedEdges.has(e.id) || gone.has(e.source.nodeId) || gone.has(e.target.nodeId));
    if (!gone.size && !removedEdges.length) {
      setNotice({ kind: 'info', lines: [selected.length ? 'Selected nodes are protected and cannot be deleted.' : 'Nothing selected to delete.'] });
      return;
    }
    let graphs = doc.graphs.map(g => g.id !== graphId ? g : { ...g, nodes: g.nodes.filter(n => !gone.has(n.id)), edges: g.edges.filter(e => !removedEdges.includes(e)) });
    // Remove owned child graphs only when no surviving Group uses them, including nested groups.
    const candidates = new Set(groups.map(n => n.params.graphId as string));
    const removedGraphs = new Set<string>();
    for (let changed = true; changed;) {
      changed = false;
      for (const id of candidates) {
        if (id === doc.rootGraphId || removedGraphs.has(id) || graphs.some(g => g.nodes.some(n => n.type === GROUP_NODE_TYPE && n.params.graphId === id))) continue;
        const child = graphs.find(g => g.id === id);
        for (const n of child?.nodes ?? []) if (n.type === GROUP_NODE_TYPE) candidates.add(n.params.graphId as string);
        graphs = graphs.filter(g => g.id !== id);
        removedGraphs.add(id); changed = true;
      }
    }
    const editorGraphs = { ...doc.editor.graphs };
    for (const id of removedGraphs) delete editorGraphs[id];
    if (editorGraphs[graphId]) {
      const nodes = { ...editorGraphs[graphId].nodes };
      for (const id of gone) delete nodes[id];
      editorGraphs[graphId] = { ...editorGraphs[graphId], nodes };
    }
    const controls = doc.controls.filter(c => !removedGraphs.has(c.scopeGraphId) && !c.bindings.some(b => gone.has(b.nodeId) || doc.graphs.some(g => removedGraphs.has(g.id) && g.nodes.some(n => n.id === b.nodeId))));
    onEdit(`Delete ${removable.length} node(s) and ${removedEdges.length} connection(s)`, [
      { op: 'set', path: ['graphs'], value: graphs },
      { op: 'set', path: ['controls'], value: controls },
      { op: 'set', path: ['editor', 'graphs'], value: editorGraphs },
    ]);
    selectionRef.current = new Set(); setPicked(new Set()); setSelectedEdges(new Set()); onSelectNode(null);
    setNotice(selected.some(isLocked) ? { kind: 'info', lines: ['Protected nodes were kept.'] } : null);
  }, [doc, graph, graphId, selectedEdges, onEdit, onSelectNode]);
  const addable = useMemo(() => [...registry.values()].filter(s => s.disabledBehavior !== 'protected' && s.type !== GROUP_NODE_TYPE), []);

  const addNode = useCallback(() => {
    const spec = addable.find(s => registryKey(s.type, s.definitionVersion) === addType);
    if (!graph || !spec) { setNotice({ kind: 'info', lines: ['Choose a node type to add.'] }); return; }
    const all = doc.graphs.flatMap(g => g.nodes);
    const id = freshId(spec.type.charAt(0).toLowerCase() + spec.type.slice(1), new Set(all.map(n => n.id)));
    const randomStreamId = freshId(`${id}_rng`, new Set(all.map(n => n.randomStreamId)));
    const params: NodeDefinition['params'] = {};
    for (const p of spec.parameters) params[p.id] = structuredClone(p.default);
    const node: NodeDefinition = { id, type: spec.type, definitionVersion: spec.definitionVersion, label: spec.type, enabled: true, randomStreamId, params };
    const rect = wrapper.current?.getBoundingClientRect();
    const center = rect ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 0, y: 0 };
    const pos = { x: Math.round(center.x), y: Math.round(center.y) };
    const patches: HistoryPatch[] = [{ op: 'splice', path: ['graphs', gi, 'nodes'], index: graph.nodes.length, deleteCount: 0, insert: [node] }];
    patches.push(layout
      ? { op: 'set', path: ['editor', 'graphs', graphId, 'nodes', id], value: pos }
      : { op: 'set', path: ['editor', 'graphs', graphId], value: { nodes: { [id]: pos }, viewport: { ...DEFAULT_VIEWPORT } } });
    setNotice(null);
    onEdit(`Add ${spec.type}`, patches);
    onSelectNode(id);
  }, [addable, addType, doc, graph, gi, graphId, layout, flow, onEdit, onSelectNode]);

  if (!graph) return <div className="gc-root gc-missing" role="alert">Graph “{graphId}” does not exist in this document.</div>;

  const selectedNode = selectedNodeId ? graph.nodes.find(n => n.id === selectedNodeId) : undefined;
  /** Inserts a ready-made component as one undoable edit (graph, anchors, duration and layout). */
  const addComponent = () => {
    if (!componentId) return;
    if (componentId.startsWith('user:')) {
      if (!userPick) return;
      const r = insertUserComponent(doc, userPick, graphId);
      onEdit(`Add my component ${userPick.name}`, [
        { op: 'set', path: ['graphs'], value: r.doc.graphs },
        { op: 'set', path: ['anchors'], value: r.doc.anchors },
        { op: 'set', path: ['assets'], value: r.doc.assets },
        { op: 'set', path: ['controls'], value: r.doc.controls },
        { op: 'set', path: ['durationTicks'], value: r.doc.durationTicks },
        { op: 'set', path: ['editor', 'graphs'], value: r.doc.editor.graphs },
      ]);
      setComponentId('');
      onSelectNode(r.groupNodeId);
      return;
    }
    let next;
    // Components insert as one Group node (double-click or Open internals to see the nodes inside).
    let groupNodeId: string | undefined;
    try { const r = insertComponent(doc, componentId, undefined, { group: true }); next = r.doc; groupNodeId = r.groupNodeId; } catch (e) { window.alert(e instanceof Error ? e.message : String(e)); return; }
    if (startOn && groupNodeId) {
      const [nodeId, port] = startOn.split('\u0000');
      const s = startComponentOnEvent(next, groupNodeId, { nodeId, port });
      if (!s.ok) { setNotice({ kind: 'error', lines: [s.message] }); return; }
      next = s.doc;
    }
    onEdit(`Add component ${getComponent(componentId).label}`, [
      { op: 'set', path: ['graphs'], value: next.graphs },
      { op: 'set', path: ['anchors'], value: next.anchors },
      { op: 'set', path: ['controls'], value: next.controls },
      { op: 'set', path: ['durationTicks'], value: next.durationTicks },
      { op: 'set', path: ['editor', 'graphs'], value: next.editor.graphs },
    ]);
    setComponentId('');
    setStartOn('');
  };
  const canDelete = graph?.nodes.some(n => (picked.has(n.id) || n.id === selectedNodeId) && !isLocked(n)) || selectedEdges.size > 0;
  /** Nodes Group selection would wrap: the Shift+click picks plus the primary selected node. */
  const groupIds = [...new Set([...picked, ...(selectedNodeId ? [selectedNodeId] : [])])].filter(id => graph?.nodes.some(n => n.id === id));
  const groupPicked = () => {
    const r = groupSelection(doc, graphId, groupIds);
    if (!r.ok) { setNotice({ kind: 'error', lines: [r.message] }); return; }
    onEdit(`Group ${groupIds.length} node(s)`, [
      { op: 'set', path: ['graphs'], value: r.doc.graphs },
      { op: 'set', path: ['controls'], value: r.doc.controls },
      { op: 'set', path: ['editor', 'graphs'], value: r.doc.editor.graphs },
    ]);
    setPicked(new Set());
    setNotice({ kind: 'info', lines: [`Grouped ${groupIds.length} node(s). Double-click the group (or Open internals) to see them.`] });
    onSelectNode(r.groupNodeId);
  };
  /** Tidy up: lays the open graph out left to right by data flow (one undoable edit), then fits the view. */
  const tidy = () => {
    if (!graph) return;
    const pos = tidyLayout(graph.nodes.map(n => ({ id: n.id, width: measured[n.id]?.width, height: measured[n.id]?.height })), graph.edges.map(e => ({ source: e.source.nodeId, target: e.target.nodeId })));
    const editorGraphs = { ...doc.editor.graphs, [graphId]: { viewport: doc.editor.graphs[graphId]?.viewport ?? DEFAULT_VIEWPORT, nodes: pos } };
    onEdit('Tidy up layout', [{ op: 'set', path: ['editor', 'graphs'], value: editorGraphs }]);
    setTimeout(() => void flow.fitView({ padding: 0.15, duration: 250 }), 60);
  };
  /** Commits a whole-document result (duplicate/paste) as one undoable edit. */
  const commitDoc = (label: string, next: EffectDocumentV2) => onEdit(label, [
    { op: 'set', path: ['graphs'], value: next.graphs },
    { op: 'set', path: ['controls'], value: next.controls },
    { op: 'set', path: ['anchors'], value: next.anchors },
    { op: 'set', path: ['assets'], value: next.assets },
    { op: 'set', path: ['durationTicks'], value: next.durationTicks },
    { op: 'set', path: ['editor', 'graphs'], value: next.editor.graphs },
  ]);
  const duplicate = (preservePattern = false) => {
    if (!groupIds.length) { setNotice({ kind: 'info', lines: ['Select nodes to duplicate.'] }); return; }
    const r = duplicateSelection(doc, graphId, groupIds, { preservePattern });
    if (!r.ok) { setNotice({ kind: 'error', lines: [r.message] }); return; }
    commitDoc(`Duplicate ${groupIds.length} node(s)`, r.doc);
    setPicked(new Set(r.newIds.length > 1 ? r.newIds : []));
    onSelectNode(r.newIds[0] ?? null);
    setNotice({ kind: 'info', lines: [preservePattern ? `Duplicated ${groupIds.length} node(s) with the same random pattern (own ids).` : `Duplicated ${groupIds.length} node(s). Copies are independent (own ids and randomness).`, ...r.notes] });
  };
  const copy = async () => {
    const r = copySelection(doc, graphId, groupIds);
    if (!r.ok) { setNotice({ kind: 'error', lines: [r.message] }); return; }
    try { await navigator.clipboard.writeText(JSON.stringify(r.value)); setNotice({ kind: 'info', lines: [`Copied ${groupIds.length} node(s). Paste with Ctrl+V here or in another effect.`] }); }
    catch { setNotice({ kind: 'error', lines: ['The browser refused clipboard access.'] }); }
  };
  const paste = async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { setNotice({ kind: 'error', lines: ['The browser refused clipboard access.'] }); return; }
    const c = parseClipboard(text);
    if (!c.ok) { setNotice({ kind: 'error', lines: [c.message] }); return; }
    const r = pasteSelection(doc, graphId, c.value);
    if (!r.ok) { setNotice({ kind: 'error', lines: [r.message] }); return; }
    commitDoc(`Paste ${r.newIds.length} node(s)`, r.doc);
    onSelectNode(r.newIds[0] ?? null);
    setNotice({ kind: 'info', lines: [`Pasted ${r.newIds.length} node(s).`, ...r.notes, ...(c.value.assets.length ? ['Imported files come with their records; if one shows MISSING under Imported assets, use Relink….'] : [])] });
  };
  const goUp = () => { const parent = trail.at(-2); if (parent) openGraph(parent.id, `Back to ${parent.label}`); };
  /** 12 "Expose Add connected node from a dangling compatible port": node types that can take/feed this port type. */
  const compatibleTypes = (portType: string, side: 'source' | 'target') => addable.filter(s => (side === 'source' ? s.inputs : s.outputs).some(p => p.type === portType)).slice(0, 14);
  const addConnected = (typeKey: string, at: { x: number; y: number }, from: { nodeId: string; port: string; side: 'source' | 'target'; portType: string }) => {
    const spec = addable.find(s => registryKey(s.type, s.definitionVersion) === typeKey);
    if (!spec) return;
    const all = doc.graphs.flatMap(g => g.nodes);
    const id = freshId(spec.type.charAt(0).toLowerCase() + spec.type.slice(1), new Set(all.map(n => n.id)));
    const params: NodeDefinition['params'] = {};
    for (const p of spec.parameters) params[p.id] = structuredClone(p.default);
    const node: NodeDefinition = { id, type: spec.type, definitionVersion: spec.definitionVersion, label: spec.type, enabled: true, randomStreamId: freshId(`${id}_rng`, new Set(all.map(n => n.randomStreamId))), params };
    const port = (from.side === 'source' ? spec.inputs : spec.outputs).find(p => p.type === from.portType)!;
    const sameTarget = from.side === 'source' ? [] : graph.edges.filter(e => e.target.nodeId === from.nodeId && e.target.port === from.port);
    const edge: EdgeDefinition = from.side === 'source'
      ? { id: freshId(`e_${from.nodeId}_${id}`, new Set(doc.graphs.flatMap(g => g.edges.map(e => e.id)))), source: { nodeId: from.nodeId, port: from.port }, target: { nodeId: id, port: port.id }, order: 0 }
      : { id: freshId(`e_${id}_${from.nodeId}`, new Set(doc.graphs.flatMap(g => g.edges.map(e => e.id)))), source: { nodeId: id, port: port.id }, target: { nodeId: from.nodeId, port: from.port }, order: sameTarget.reduce((m, e) => Math.max(m, e.order + 1), 0) };
    const pos = { x: Math.round(at.x), y: Math.round(at.y) };
    onEdit(`Add connected ${spec.type}`, [
      { op: 'splice', path: ['graphs', gi, 'nodes'], index: graph.nodes.length, deleteCount: 0, insert: [node] },
      { op: 'splice', path: ['graphs', gi, 'edges'], index: graph.edges.length, deleteCount: 0, insert: [edge] },
      layout ? { op: 'set', path: ['editor', 'graphs', graphId, 'nodes', id], value: pos } : { op: 'set', path: ['editor', 'graphs', graphId], value: { nodes: { [id]: pos }, viewport: { ...DEFAULT_VIEWPORT } } },
    ]);
    onSelectNode(id);
  };
  /** Opens a Group's internals in this canvas (06: double-click or Open internals; breadcrumb returns). */
  const openGraph = (id: string, label: string) => { onSelectNode(null); onEdit(label, [{ op: 'set', path: ['editor', 'openedGraphId'], value: id }]); };
  const parentOf = (id: string) => doc.graphs.find(g => g.nodes.some(n => n.type === GROUP_NODE_TYPE && n.params.graphId === id));
  const trail: { id: string; label: string }[] = [];
  for (let id: string | undefined = graphId, guard = 0; id && guard < 16; guard++) {
    const parent: GraphDefinition | undefined = id === doc.rootGraphId ? undefined : parentOf(id);
    const owner = parent?.nodes.find((n: NodeDefinition) => n.type === GROUP_NODE_TYPE && n.params.graphId === id);
    trail.unshift({ id, label: id === doc.rootGraphId ? 'Effect' : owner?.label ?? id });
    id = parent?.id;
  }

  return (
    <div className="gc-root">
        {/* Toolbar lives outside the flow pane so it never covers nodes. */}
        <div className="gc-toolbar" role="toolbar" aria-label="Graph tools">
          <button type="button" onClick={() => flow.fitView({ padding: 0.2 })}>Fit view</button>
          <button type="button" onClick={tidy} disabled={!graph || graph.nodes.length < 2}
            title="Lays the graph out left to right by data flow so connections are short and nothing overlaps (undo restores the old layout).">Tidy up</button>
          <button type="button" onClick={deleteSelection} disabled={!canDelete}
            title="Deletes the selected node with its connections, and any selected connections.">Delete selection</button>
          <button type="button" onClick={groupPicked} disabled={groupIds.length === 0}
            title="Wraps the selected nodes into one Group. Select several with Ctrl/Shift+click or by dragging a box on empty canvas.">Group selection{groupIds.length > 1 ? ` (${groupIds.length})` : ''}</button>
          <label className="gc-add">
            <span>Add node</span>
            <select value={addType} onChange={e => setAddType(e.target.value)} title={addType ? docText(addable.find(s => registryKey(s.type, s.definitionVersion) === addType)?.type ?? '') : 'Pick a node type; hover an entry to read what it does'}>
              <option value="">Choose…</option>
              {/* Grouped by role, each entry carries its description (the same text as the inspector and the AI guide). */}
              {NODE_CATEGORIES.map(([cat], ci) => {
                const list = addable.filter(s => (NODE_INFO[s.type]?.[0] ?? NODE_CATEGORIES.length - 1) === ci);
                return list.length ? <optgroup key={cat} label={cat}>{list.map(s => <option key={registryKey(s.type, s.definitionVersion)} value={registryKey(s.type, s.definitionVersion)} title={docText(s.type)}>{s.type}</option>)}</optgroup> : null;
              })}
              <option value="" disabled>Group (not available yet)</option>
            </select>
          </label>
          <button type="button" onClick={addNode} disabled={!addType}>Add</button>
          {addType && <span className="gc-add-doc">{docText(addable.find(s => registryKey(s.type, s.definitionVersion) === addType)?.type ?? '').split('. ')[0]}.</span>}
          <label className="gc-add">
            <span>Add component</span>
            <select value={componentId} onChange={e => setComponentId(e.target.value)} disabled={graphId !== doc.rootGraphId}>
              <option value="">Choose…</option>
              {userComponents.length > 0 && <optgroup label="My components">{userComponents.map(c => <option key={c.id} value={`user:${c.id}`}>{c.name}</option>)}</optgroup>}
              <optgroup label="Built-in">{COMPONENT_TEMPLATES.map(c => <option key={c.id} value={c.id} title={c.description}>{c.label}</option>)}</optgroup>
            </select>
          </label>
          {componentId && !componentId.startsWith('user:') && graphId === doc.rootGraphId && eventSources(doc, graphId).length > 0 && (
            <label className="gc-add" title="Start the new component at its own time, or when another part's event happens (it then follows that event, e.g. an impact that waits for a projectile)">
              <span>Start</span>
              <select value={startOn} onChange={e => setStartOn(e.target.value)}>
                <option value="">at its own time</option>
                {eventSources(doc, graphId).map(ev => <option key={`${ev.nodeId}.${ev.port}`} value={`${ev.nodeId}\u0000${ev.port}`}>when {ev.label}</option>)}
              </select>
            </label>
          )}
          <button type="button" onClick={addComponent} disabled={!componentId}>Insert</button>
          {userPick && <button type="button" onClick={() => { if (window.confirm(`Delete "${userPick.name}" from My components? Effects already using it keep their copy.`)) { removeUserComponent(userPick.id); setComponentId(''); } }} title="Remove this saved component from the list">Delete from My components</button>}
          {selectedNode?.type === GROUP_NODE_TYPE && <button type="button" onClick={() => {
            const name = window.prompt('Name for this component (it appears under Add component → My components):', selectedNode.label);
            if (!name) return;
            const r = saveGroupAsComponent(doc, selectedNode.id, name);
            if (!r.ok) { setNotice({ kind: 'error', lines: [r.message] }); return; }
            saveUserComponent(r.value);
            setNotice({ kind: 'info', lines: [`Saved "${r.value.name}" to My components. Insert it from Add component; each copy is independent.`] });
          }} title="Save this group so you can insert copies of it later (in any effect)">Save as my component</button>}
          {selectedNode?.type === GROUP_NODE_TYPE && <button type="button" onClick={() => openGraph(selectedNode.params.graphId as string, `Open ${selectedNode.label}`)} title="Show the nodes inside this group">Open internals</button>}
        </div>
        {userPick && <p className="gc-hint" role="note">{userPick.name}: your saved group ({userPick.graphs[0].nodes.length} nodes). Each insert is an independent copy.</p>}
        {componentId && !userPick && !componentId.startsWith('user:') && <p className="gc-hint" role="note">{getComponent(componentId).label}: {getComponent(componentId).description.replace(/s*([^)]*)/g, "")} It {componentPlacement(componentId)}; use its Start at knob to play it after other parts.</p>}
        {trail.length > 1 && (
          <nav className="gc-trail" aria-label="Graph path">
            {trail.map((t, i) => i < trail.length - 1
              ? <span key={t.id}><button type="button" className="gc-crumb" onClick={() => openGraph(t.id, `Back to ${t.label}`)}>{t.label}</button> › </span>
              : <strong key={t.id}>{t.label}</strong>)}
          </nav>
        )}
      <div className="gc-flow" ref={wrapper} onPointerDownCapture={e => { clickBaseRef.current = selectionRef.current; onTouchPressStart(e); }}
        onPointerMoveCapture={onTouchPressMove} onPointerUpCapture={cancelPress} onPointerCancelCapture={cancelPress}
        onClickCapture={e => { if (pressFiredRef.current) { pressFiredRef.current = false; e.stopPropagation(); e.preventDefault(); } }}
        onKeyDown={e => {
        // 12 keyboard equivalents: Delete/Backspace removes the selection, Enter opens a selected group.
        const t = e.target as HTMLElement;
        if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
        const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
        if ((e.key === 'Delete' || e.key === 'Backspace') && canDelete) { e.preventDefault(); deleteSelection(); }
        else if (e.key === 'Enter' && selectedNode?.type === GROUP_NODE_TYPE) { e.preventDefault(); openGraph(selectedNode.params.graphId as string, `Open ${selectedNode.label}`); }
        else if (mod && k === 'd') { e.preventDefault(); duplicate(); }
        else if (mod && k === 'g') { e.preventDefault(); if (groupIds.length) groupPicked(); }
        else if (mod && k === 'c' && groupIds.length) { e.preventDefault(); void copy(); }
        else if (mod && k === 'v') { e.preventDefault(); void paste(); }
        else if (e.key === 'Escape') { e.preventDefault(); setMenu(null); if (selectedNodeId || picked.size || selectedEdges.size) { onSelectNode(null); setPicked(new Set()); setSelectedEdges(new Set()); } else goUp(); }
        else if (!mod && k === 'f') { e.preventDefault(); void flow.fitView({ padding: 0.2 }); }
      }}>
      <ReactFlow<CardNode, Edge>
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop} onConnect={onConnect}
        onNodeDoubleClick={(_, n) => { const def = graph.nodes.find(x => x.id === n.id); if (def?.type === GROUP_NODE_TYPE) openGraph(def.params.graphId as string, `Open ${def.label}`); }}
        onPaneClick={() => { setMenu(null); onSelectNode(null); setSelectedEdges(new Set()); setPicked(new Set()); }}
        onNodeClick={(e, n) => {
          // Ctrl/Cmd/Shift+click toggles the node in the selection. Decided from the click itself (React Flow only
          // sees a held key), and computed from the selection before the click, so it is right either way.
          if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
          const cur = new Set(clickBaseRef.current);
          if (cur.has(n.id)) cur.delete(n.id); else cur.add(n.id);
          selectionRef.current = cur;
          setPicked(cur.size > 1 ? cur : new Set());
          const primary = cur.has(n.id) ? n.id : selectedNodeId !== undefined && cur.has(selectedNodeId) ? selectedNodeId : ([...cur].at(-1) ?? null);
          onSelectNode(primary);
        }}
        deleteKeyCode={null} multiSelectionKeyCode={MULTI_SELECT_KEYS} selectionKeyCode={null} selectionMode={SelectionMode.Partial}
        selectionOnDrag panOnDrag={[1, 2]} panActivationKeyCode="Space"
        onNodeContextMenu={(e, n) => { e.preventDefault(); openMenuAt(e.clientX, e.clientY, n.id); }}
        onPaneContextMenu={e => { e.preventDefault(); openMenuAt(e.clientX, e.clientY); }}
        onConnectEnd={(e, st) => {
          if (st.isValid || st.toHandle || !st.fromHandle || !st.fromNode) return;
          const pt = 'changedTouches' in e ? e.changedTouches[0] : e, r = wrapper.current!.getBoundingClientRect();
          const side = st.fromHandle.type === 'source' ? 'source' as const : 'target' as const;
          const card = nodes.find(n => n.id === st.fromNode!.id)?.data.signature;
          const port = card ? (side === 'source' ? card.outputs : card.inputs).find(p => p.id === st.fromHandle!.id) : undefined;
          if (!port) return;
          setMenu({ x: pt.clientX - r.left, y: pt.clientY - r.top, flow: flow.screenToFlowPosition({ x: pt.clientX, y: pt.clientY }), from: { nodeId: st.fromNode.id, port: port.id, side, portType: port.type } });
        }}
        viewport={camera.viewport} onViewportChange={onViewportChange} minZoom={0.1} maxZoom={4}
      >
        {notice && (
          <Panel position="bottom-left" className={`gc-notice gc-notice-${notice.kind}`}>
            <div role={notice.kind === 'error' ? 'alert' : 'status'}>
              {notice.lines.map((l, i) => <div key={i}>{l}</div>)}
            </div>
            <button type="button" onClick={() => setNotice(null)}>Dismiss</button>
          </Panel>
        )}
      </ReactFlow>
      {menu && (() => {
        const n = menu.nodeId ? graph.nodes.find(x => x.id === menu.nodeId) : undefined;
        const close = () => setMenu(null);
        // Touch screens have no keyboard shortcuts: drop the "(Ctrl+D)" hints there.
        const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
        const item = (label: string, fn: () => void, disabled = false) => <button type="button" role="menuitem" disabled={disabled} onClick={() => { close(); fn(); }}>{touch ? label.replace(/\s+\([^)]*\)$/, '') : label}</button>;
        return (
          <div className="gc-menu" role="menu" ref={menuRef} style={{ left: menu.x, top: menu.y }} onKeyDown={e => { if (e.key === 'Escape') close(); }}>
            {menu.from ? (
              <>
                <div className="gc-menu-title">Add a node connected to {menu.from.port} ({menu.from.portType})</div>
                {compatibleTypes(menu.from.portType, menu.from.side).map(s => item(s.type, () => addConnected(registryKey(s.type, s.definitionVersion), menu.flow, menu.from!)))}
                {compatibleTypes(menu.from.portType, menu.from.side).length === 0 && <div className="gc-menu-title">No node type fits this port.</div>}
              </>
            ) : n ? (
              <>
                {n.type === GROUP_NODE_TYPE && item('Open internals', () => openGraph(n.params.graphId as string, `Open ${n.label}`))}
                {item('Duplicate  (Ctrl+D)', () => duplicate(), isLocked(n))}
                {item('Duplicate, same random pattern', () => duplicate(true), isLocked(n))}
                {item('Copy  (Ctrl+C)', () => void copy(), isLocked(n))}
                {item('Group selection  (Ctrl+G)', groupPicked)}
                {n.type === GROUP_NODE_TYPE && item('Save as my component', () => { const name = window.prompt('Name for this component:', n.label); if (!name) return; const r = saveGroupAsComponent(doc, n.id, name); if (!r.ok) { setNotice({ kind: 'error', lines: [r.message] }); return; } saveUserComponent(r.value); setNotice({ kind: 'info', lines: [`Saved "${r.value.name}" to My components.`] }); })}
                {onToggleSolo && canSolo(n.type) && item(soloed?.has(n.id) ? 'Unsolo' : 'Solo', () => onToggleSolo(n.id))}
                {item('Delete  (Del)', deleteSelection, isLocked(n))}
                {n.type !== GROUP_NODE_TYPE && item('Delete and reconnect', () => { const r = removeAndReconnect(doc, graphId, n.id); if (!r.ok) { setNotice({ kind: 'error', lines: [r.message] }); return; } commitDoc(`Delete ${n.label} and reconnect`, r.doc); onSelectNode(null); setNotice({ kind: 'info', lines: [`Deleted ${n.label}; ${r.newIds.length} connection(s) now bypass it.`, ...r.notes] }); }, isLocked(n))}
              </>
            ) : (
              <>
                {item('Paste  (Ctrl+V)', () => void paste())}
                {item('Fit view  (F)', () => void flow.fitView({ padding: 0.2 }))}
                {item('Tidy up layout', tidy)}
                {trail.length > 1 && item('Up to parent  (Esc)', goUp)}
              </>
            )}
            <button type="button" className="gc-menu-close" onClick={close}>Close</button>
          </div>
        );
      })()}
      </div>
    </div>
  );
}

export default function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

/** Plain-text description of a node type for tooltips (the shared docs use Markdown backticks). */
function docText(type: string): string {
  return (nodeDoc(type)?.text ?? '').replace(/`([^`]*)`/g, '$1');
}

/** Short note for a node card: the component's description for a component box, else the node type's description. */
function cardNote(node: { type: string; id: string }): { short: string; full: string } | undefined {
  const comp = node.type === GROUP_NODE_TYPE ? [...COMPONENT_TEMPLATES].sort((x, y) => y.id.length - x.id.length).find(t => node.id === t.id || node.id.startsWith(`${t.id}-`)) : undefined;
  const full = comp ? comp.description : docText(node.type);
  if (!full) return undefined;
  const first = full.split(/(?<=[.!?])\s/)[0];
  return { short: first.length > 90 ? `${first.slice(0, 88).trimEnd()}…` : first, full };
}

/** Ctrl (Windows/Linux), Cmd (macOS) or Shift + click toggles a node in the selection. */
const MULTI_SELECT_KEYS = ['Control', 'Meta', 'Shift'];
