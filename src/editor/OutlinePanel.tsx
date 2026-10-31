// Outline (12 "Provide an outline/list view of components for screen-reader navigation and enable/solo/reorder"):
// the nodes of the open graph as a plain keyboard-reachable list — select, enable/disable and open groups without
// the canvas. Each change is one undoable edit.
import { memo, useCallback } from 'react';
import type { EffectDocumentV2, NodeDefinition } from '../model/types.ts';
import type { Patch } from './history.ts';
import { canSolo } from '../graph/solo.ts';

type Props = {
  document: EffectDocumentV2;
  graphId: string;
  selectedNodeId: string | undefined;
  onSelectNode: (id: string | null) => void;
  onEdit: (label: string, patches: Patch[]) => void;
  /** 06 Solo (preview-only mask): soloed node IDs, toggle and clear. */
  soloed: ReadonlySet<string>;
  onToggleSolo: (id: string) => void;
  onClearSolo: () => void;
};

const LOCKED = new Set(['EffectOutput', 'GroupInput', 'GroupOutput']);

type RowProps = {
  n: NodeDefinition; ni: number; gi: number; selected: boolean; solo: boolean;
  onSelectNode: Props['onSelectNode']; onEdit: Props['onEdit']; onToggleSolo: Props['onToggleSolo']; onOpen: (childId: string, label: string) => void;
};
// One row per node, memoized: selecting a node re-renders the two rows whose selection changed, not all of them
// (a 200-node graph, tools/perf-graph200.mjs).
const OutlineRow = memo(function OutlineRow({ n, ni, gi, selected, solo, onSelectNode, onEdit, onToggleSolo, onOpen }: RowProps) {
  return (
    <li className={selected ? 'ol-selected' : undefined}>
      <button type="button" className="ol-name" aria-pressed={selected} onClick={() => onSelectNode(n.id)} title={`Select ${n.label || n.id} (${n.type})`}>
        {n.label || n.id} <span className="ol-type">{n.type === 'Group' ? 'component' : n.type}</span>
      </button>
      {!LOCKED.has(n.type) && (
        <label className="ol-toggle">
          <input type="checkbox" checked={n.enabled} onChange={e => onEdit(`${e.currentTarget.checked ? 'Enable' : 'Disable'} ${n.label || n.id}`, [{ op: 'set', path: ['graphs', gi, 'nodes', ni, 'enabled'], value: e.currentTarget.checked }])} />
          on
        </label>
      )}
      {canSolo(n.type) && (
        <button type="button" className="ol-solo" aria-pressed={solo} onClick={() => onToggleSolo(n.id)} title="Show only the soloed parts in the preview (does not change the effect)">Solo</button>
      )}
      {n.type === 'Group' && typeof n.params.graphId === 'string' && (
        <button type="button" onClick={() => onOpen(n.params.graphId as string, `Open ${n.label || n.id}`)} title="Show the nodes inside this component">Open</button>
      )}
    </li>
  );
});

export function OutlinePanel({ document: doc, graphId, selectedNodeId, onSelectNode, onEdit, soloed, onToggleSolo, onClearSolo }: Props) {
  // Before the early return: hooks run on every render.
  const open = useCallback((childId: string, label: string) => { onSelectNode(null); onEdit(`Open ${label}`, [{ op: 'set', path: ['editor', 'openedGraphId'], value: childId }]); }, [onSelectNode, onEdit]);
  const gi = doc.graphs.findIndex(g => g.id === graphId);
  if (gi < 0) return null;
  const graph = doc.graphs[gi];
  // Groups (components) first, then everything else, each alphabetically by label.
  const rows = graph.nodes.map((n, ni) => ({ n, ni })).sort((a, b) => Number(b.n.type === 'Group') - Number(a.n.type === 'Group') || (a.n.label || a.n.id).localeCompare(b.n.label || b.n.id));
  return (
    <>
    {soloed.size > 0 && (
      <p className="ol-solo-note" role="status">Solo: only {soloed.size} part{soloed.size === 1 ? '' : 's'} shown in the preview (the effect itself is unchanged). <button type="button" onClick={onClearSolo}>Clear solo</button></p>
    )}
    <ul className="ol-list" aria-label="Parts of this effect">
      {rows.map(({ n, ni }) => (
        <OutlineRow key={n.id} n={n} ni={ni} gi={gi} selected={n.id === selectedNodeId} solo={soloed.has(n.id)}
          onSelectNode={onSelectNode} onEdit={onEdit} onToggleSolo={onToggleSolo} onOpen={open} />
      ))}
      <style>{`.ol-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;font-size:14px}.ol-list li{display:flex;gap:6px;align-items:center}.ol-name{flex:1;text-align:left;min-height:32px}.ol-selected .ol-name{outline:1px solid #7fb4ff}.ol-type{font-size:11px;opacity:.65;margin-left:4px}.ol-toggle{display:flex;gap:3px;align-items:center;font-size:12px}.ol-solo[aria-pressed=true]{background:#7a5a10;color:#ffe2a0}.ol-solo-note{margin:0 0 6px;font-size:13px;color:#ffd28a}`}</style>
    </ul>
    </>
  );
}
