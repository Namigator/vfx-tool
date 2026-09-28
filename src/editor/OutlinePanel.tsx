// Outline (12 "Provide an outline/list view of components for screen-reader navigation and enable/solo/reorder"):
// the nodes of the open graph as a plain keyboard-reachable list — select, enable/disable and open groups without
// the canvas. Each change is one undoable edit.
import type { EffectDocumentV2 } from '../model/types.ts';
import type { Patch } from './history.ts';

type Props = {
  document: EffectDocumentV2;
  graphId: string;
  selectedNodeId: string | undefined;
  onSelectNode: (id: string | null) => void;
  onEdit: (label: string, patches: Patch[]) => void;
};

const LOCKED = new Set(['EffectOutput', 'GroupInput', 'GroupOutput']);

export function OutlinePanel({ document: doc, graphId, selectedNodeId, onSelectNode, onEdit }: Props) {
  const gi = doc.graphs.findIndex(g => g.id === graphId);
  if (gi < 0) return null;
  const graph = doc.graphs[gi];
  // Groups (components) first, then everything else, each alphabetically by label.
  const rows = graph.nodes.map((n, ni) => ({ n, ni })).sort((a, b) => Number(b.n.type === 'Group') - Number(a.n.type === 'Group') || (a.n.label || a.n.id).localeCompare(b.n.label || b.n.id));
  const open = (childId: string, label: string) => { onSelectNode(null); onEdit(`Open ${label}`, [{ op: 'set', path: ['editor', 'openedGraphId'], value: childId }]); };
  return (
    <ul className="ol-list" aria-label="Parts of this effect">
      {rows.map(({ n, ni }) => (
        <li key={n.id} className={n.id === selectedNodeId ? 'ol-selected' : undefined}>
          <button type="button" className="ol-name" aria-pressed={n.id === selectedNodeId} onClick={() => onSelectNode(n.id)} title={`Select ${n.label || n.id} (${n.type})`}>
            {n.label || n.id} <span className="ol-type">{n.type === 'Group' ? 'component' : n.type}</span>
          </button>
          {!LOCKED.has(n.type) && (
            <label className="ol-toggle">
              <input type="checkbox" checked={n.enabled} onChange={e => onEdit(`${e.currentTarget.checked ? 'Enable' : 'Disable'} ${n.label || n.id}`, [{ op: 'set', path: ['graphs', gi, 'nodes', ni, 'enabled'], value: e.currentTarget.checked }])} />
              on
            </label>
          )}
          {n.type === 'Group' && typeof n.params.graphId === 'string' && (
            <button type="button" onClick={() => open(n.params.graphId as string, `Open ${n.label || n.id}`)} title="Show the nodes inside this component">Open</button>
          )}
        </li>
      ))}
      <style>{`.ol-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;font-size:14px}.ol-list li{display:flex;gap:6px;align-items:center}.ol-name{flex:1;text-align:left;min-height:32px}.ol-selected .ol-name{outline:1px solid #7fb4ff}.ol-type{font-size:11px;opacity:.65;margin-left:4px}.ol-toggle{display:flex;gap:3px;align-items:center;font-size:12px}`}</style>
    </ul>
  );
}
