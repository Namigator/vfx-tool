// Controlled node canvas for one graph of an EffectDocumentV2 (12-EDITOR). The document prop is
// authoritative: every authored change leaves through onEdit as history patches, and React Flow change
// events never mutate it. Only the in-progress drag preview and edge selection are local state.
// Deferred here: Group authoring, multi-node selection, viewport persistence, parameter editing.
import { COMPONENT_TEMPLATES, getComponent, insertComponent } from '../graph/components.ts';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Handle, Panel, Position, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps, type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './graph-canvas.css';
import type { Patch as HistoryPatch } from './history.ts';
import type { Diagnostic, EdgeDefinition, EffectDocumentV2, NodeDefinition, NodeSpec, PortSpec } from '../model/types.ts';
import { registryKey } from '../model/controls.ts';
import { createRegistry } from '../graph/registry.ts';
import { GROUP_NODE_TYPE, resolveSignature, type ResolvedSignature } from '../graph/signature.ts';
import { analyzeGraph } from '../graph/analyze.ts';
import { resolveSelection } from './selection.ts';

export type GraphCanvasProps = {
  document: EffectDocumentV2;
  graphId: string;
  selectedNodeId?: string;
  onSelectNode: (id: string | null) => void;
  onEdit: (label: string, patches: HistoryPatch[]) => void;
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
};
type CardNode = Node<CardData, 'card'>;

const registry = createRegistry();
/** Diagnostics that make a tentative connection invalid rather than merely incomplete. */
const BLOCKING_CODES = new Set<Diagnostic['code']>(['TYPE_MISMATCH', 'DOMAIN_MISMATCH', 'MULTIPLE_DRIVERS', 'GRAPH_CYCLE', 'DUPLICATE_ID']);
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };

const specOf = (n: NodeDefinition): NodeSpec | undefined => registry.get(registryKey(n.type, n.definitionVersion));
/** Protected nodes (EffectOutput, group bridges) and Groups are not deletable from this canvas. */
const isLocked = (n: NodeDefinition) => n.type === GROUP_NODE_TYPE || specOf(n)?.disabledBehavior === 'protected';
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
        <span className="gc-type">{node.type}{locked ? ' 🔒' : ''}</span>
        <label className="gc-enabled nodrag nopan" title={protectedEnable ? 'This node cannot be disabled.' : 'Enabled'}>
          <input type="checkbox" checked={node.enabled} disabled={protectedEnable} onChange={onChange} aria-label={`Enable ${node.label || node.id}`} />
        </label>
      </div>
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

function Canvas({ document: doc, graphId, selectedNodeId, onSelectNode, onEdit }: GraphCanvasProps) {
  const [componentId, setComponentId] = useState('');
  const flow = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const [dragPreview, setDragPreview] = useState<Record<string, { x: number; y: number }>>({});
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; lines: string[] } | null>(null);
  const [addType, setAddType] = useState('');
  const [advancedNodes, setAdvancedNodes] = useState<ReadonlySet<string>>(new Set());
  const nodesInitialized = useNodesInitialized();
  // The camera is local preview state, never authored/undoable. It is seeded from the saved layout once per
  // document+graph and only changes through user pan/zoom or Fit; re-renders never reapply the saved value.
  const viewKey = `${doc.id}\u0000${graphId}`;
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
  const analysis = useMemo(() => analyzeGraph(doc, { registry }), [doc]);
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
        id: n.id, type: 'card' as const, position, selected: n.id === selectedNodeId, measured: measured[n.id],
        deletable: false,
        data: {
          node: n,
          signature: sig?.ok ? sig.value : null,
          signatureError: sig && !sig.ok ? sig.errors.map(d => d.message).join(' ') : spec ? null : `Unregistered node type ${n.type}@${n.definitionVersion}.`,
          locked: isLocked(n), connected: touched.has(n.id),
          issues: issuesByNode.get(n.id) ?? [], onToggleEnabled: toggleEnabled,
          connectedInputs: new Set(graph.edges.filter(e => e.target.nodeId === n.id).map(e => e.target.port)),
          showAdvanced: advancedNodes.has(n.id), onToggleAdvanced: toggleAdvanced,
        },
      };
    });
  }, [graph, doc, graphId, layout, dragPreview, measured, selectedNodeId, issuesByNode, toggleEnabled, advancedNodes, toggleAdvanced]);

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
    // Resolve the whole batch once so select/deselect ordering cannot end in a spurious null.
    const next = resolveSelection(changes, selectedNodeId);
    if (next !== undefined) onSelectNode(next);
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
    const node = selectedNodeId ? graph.nodes.find(n => n.id === selectedNodeId) : undefined;
    if (node && isLocked(node)) {
      setNotice({ kind: 'error', lines: [node.type === GROUP_NODE_TYPE ? 'Deleting groups is not supported yet.' : `${node.type} is protected and cannot be deleted.`] });
      return;
    }
    if (node) {
      const bound = doc.controls.filter(ctl => ctl.bindings.some(b => b.nodeId === node.id));
      if (bound.length) {
        setNotice({ kind: 'error', lines: [`${node.id} is bound by control(s) ${bound.map(ctl => ctl.id).join(', ')}; remove those bindings first.`] });
        return;
      }
    }
    const edgeIdx = graph.edges
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => selectedEdges.has(e.id) || (node && (e.source.nodeId === node.id || e.target.nodeId === node.id)))
      .map(({ i }) => i)
      .sort((a, b) => b - a);
    if (!node && edgeIdx.length === 0) {
      setNotice({ kind: 'info', lines: ['Nothing selected to delete.'] });
      return;
    }
    const patches: HistoryPatch[] = edgeIdx.map(i => ({ op: 'splice', path: ['graphs', gi, 'edges'], index: i, deleteCount: 1, insert: [] }));
    if (node) {
      patches.push({ op: 'splice', path: ['graphs', gi, 'nodes'], index: graph.nodes.indexOf(node), deleteCount: 1, insert: [] });
      if (layout && Object.hasOwn(layout.nodes, node.id)) patches.push({ op: 'delete', path: ['editor', 'graphs', graphId, 'nodes', node.id] });
    }
    setNotice(null);
    setSelectedEdges(new Set());
    onEdit(node ? `Delete ${node.id}${edgeIdx.length ? ` and ${edgeIdx.length} connection(s)` : ''}` : `Delete ${edgeIdx.length} connection(s)`, patches);
    if (node) onSelectNode(null);
  }, [doc, graph, gi, graphId, layout, selectedNodeId, selectedEdges, onEdit, onSelectNode]);

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
    let next;
    try { next = insertComponent(doc, componentId).doc; } catch (e) { window.alert(e instanceof Error ? e.message : String(e)); return; }
    const ri = doc.graphs.findIndex(g => g.id === doc.rootGraphId);
    onEdit(`Add component ${getComponent(componentId).label}`, [
      { op: 'set', path: ['graphs', ri], value: next.graphs[ri] },
      { op: 'set', path: ['anchors'], value: next.anchors },
      { op: 'set', path: ['durationTicks'], value: next.durationTicks },
      { op: 'set', path: ['editor', 'graphs', doc.rootGraphId, 'nodes'], value: next.editor.graphs[doc.rootGraphId].nodes },
    ]);
    setComponentId('');
  };
  const canDelete = (selectedNode !== undefined && !isLocked(selectedNode)) || selectedEdges.size > 0;

  return (
    <div className="gc-root">
        {/* Toolbar lives outside the flow pane so it never covers nodes. */}
        <div className="gc-toolbar" role="toolbar" aria-label="Graph tools">
          <button type="button" onClick={() => flow.fitView({ padding: 0.2 })}>Fit view</button>
          <button type="button" onClick={deleteSelection} disabled={!canDelete}
            title="Deletes the selected node with its connections, and any selected connections.">Delete selection</button>
          <label className="gc-add">
            <span>Add node</span>
            <select value={addType} onChange={e => setAddType(e.target.value)}>
              <option value="">Choose…</option>
              {addable.map(s => <option key={registryKey(s.type, s.definitionVersion)} value={registryKey(s.type, s.definitionVersion)}>{s.type}</option>)}
              <option value="" disabled>Group (not available yet)</option>
            </select>
          </label>
          <button type="button" onClick={addNode} disabled={!addType}>Add</button>
          <label className="gc-add">
            <span>Add component</span>
            <select value={componentId} onChange={e => setComponentId(e.target.value)} disabled={graphId !== doc.rootGraphId}>
              <option value="">Choose…</option>
              {COMPONENT_TEMPLATES.map(c => <option key={c.id} value={c.id} title={c.description}>{c.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={addComponent} disabled={!componentId}>Insert</button>
        </div>
      <div className="gc-flow" ref={wrapper}>
      <ReactFlow<CardNode, Edge>
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop} onConnect={onConnect}
        onPaneClick={() => { onSelectNode(null); setSelectedEdges(new Set()); }}
        deleteKeyCode={null} multiSelectionKeyCode={null} selectionKeyCode={null}
        viewport={camera.viewport} onViewportChange={onViewportChange} minZoom={0.1}
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
