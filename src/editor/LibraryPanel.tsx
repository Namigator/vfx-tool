// 12 "Library tabs: Presets, Components, Assets, My Blocks. Search is local and filters by name/tags/type."
// Presets open a ready-made effect as a new effect; Components and My Blocks insert into the open effect (one
// undoable edit, as one Group node); Assets lists the included sprite library and this effect's imported assets
// (imported ones can be added with Add to effect). Thumbnails are marked pending until visually accepted (12).
import { useMemo, useState } from 'react';
import { BUILTIN_SPRITES } from '../assets/builtinSprites.generated.ts';
import { assetComponent } from '../graph/assetComponent.ts';
import { COMPONENT_TEMPLATES, insertComponent, type ComponentTemplate } from '../graph/components.ts';
import { createBlankDocument } from '../graph/fixtures.ts';
import { insertUserComponent } from '../graph/userComponents.ts';
import type { EffectDocumentV2 } from '../model/types.ts';
import type { Patch } from './history.ts';
import { useUserComponents } from './userComponentStore.ts';

type Tab = 'presets' | 'components' | 'assets' | 'blocks';
const TABS: { id: Tab; label: string }[] = [{ id: 'presets', label: 'Presets' }, { id: 'components', label: 'Components' }, { id: 'assets', label: 'Assets' }, { id: 'blocks', label: 'My Blocks' }];

/** Element family of a component id (its tag for search), e.g. "fire-jet" → "fire". */
const family = (id: string) => id.split('-')[0];

type Props = {
  document: EffectDocumentV2;
  graphId: string;
  onEdit: (label: string, patches: Patch[]) => void;
  /** Replace the open effect with a new one (the editor autosaves the current one first). */
  onOpenNew: (text: string, label: string) => void;
  onClose: () => void;
};

const docPatches = (d: EffectDocumentV2): Patch[] => [
  { op: 'set', path: ['graphs'], value: d.graphs },
  { op: 'set', path: ['anchors'], value: d.anchors },
  { op: 'set', path: ['assets'], value: d.assets },
  { op: 'set', path: ['controls'], value: d.controls },
  { op: 'set', path: ['durationTicks'], value: d.durationTicks },
  { op: 'set', path: ['editor', 'graphs'], value: d.editor.graphs },
];

export function LibraryPanel({ document: doc, graphId, onEdit, onOpenNew, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('presets');
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const blocks = useUserComponents();
  const q = query.trim().toLowerCase();
  const match = (...fields: string[]) => !q || fields.some(f => f.toLowerCase().includes(q));

  const components = useMemo(() => COMPONENT_TEMPLATES.filter(c => match(c.label, c.description, c.id, family(c.id))), [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const insert = (t: ComponentTemplate) => {
    try {
      const r = insertComponent(doc, t, undefined, { group: true });
      onEdit(`Add component ${t.label}`, docPatches(r.doc));
      setNote(`Added ${t.label} (Group ${r.groupNodeId}); its knobs are in Controls.`);
    } catch (e) { setNote(`Could not add ${t.label}: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const openPreset = (t: ComponentTemplate) => {
    const r = insertComponent({ ...createBlankDocument(), name: t.label }, t, undefined, { group: true });
    onOpenNew(JSON.stringify({ ...r.doc, name: t.label, id: `effect-${t.id}-${Date.now().toString(36)}` }, null, 2), `Open preset ${t.label}`);
    setNote(`Opened ${t.label} as a new effect (undo history starts fresh; Keep or Save as stores named copies).`);
  };

  const row = (key: string, title: string, sub: string, actions: React.ReactNode) => (
    <li key={key} className="lib-row">
      <div className="lib-text"><strong>{title}</strong><span className="pv2-muted">{sub}</span></div>
      <div className="lib-actions">{actions}</div>
    </li>
  );

  return (
    <aside className="lib-root" aria-label="Library">
      <div className="lib-head">
        <strong>Library</strong>
        <button type="button" onClick={onClose} aria-label="Close library" title="Hide the library">×</button>
      </div>
      <div className="lib-tabs" role="tablist" aria-label="Library sections">
        {TABS.map(t => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'lib-tab lib-on' : 'lib-tab'} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      <input className="lib-search" type="search" placeholder="Search name, element or type…" aria-label="Search the library" value={query} onChange={e => setQuery(e.currentTarget.value)} />
      {note && <p className="pv2-note" role="status" aria-live="polite">{note}</p>}
      <ul className="lib-list" role="tabpanel" aria-label={TABS.find(t => t.id === tab)!.label}>
        {tab === 'presets' && components.map(c => row(c.id, c.label, `${c.description} · thumbnail pending review`,
          <button type="button" onClick={() => openPreset(c)} title="Open as a new effect (your current effect is autosaved)">Open</button>))}
        {tab === 'components' && components.map(c => row(c.id, c.label, `${family(c.id)} · ${c.knobs.length} knobs`,
          <button type="button" onClick={() => insert(c)} title="Insert into this effect as one Group node, wired to Source/Target (undo removes it)">Add</button>))}
        {tab === 'blocks' && (blocks.length === 0
          ? <li className="pv2-muted">No saved blocks yet. Select nodes → Group selection → Save as my component.</li>
          : blocks.filter(b => match(b.name, 'block')).map(b => row(b.id, b.name, `saved ${new Date(b.savedAt).toLocaleDateString()} · ${b.controls.length} knobs`,
            <button type="button" onClick={() => { const r = insertUserComponent(doc, b, graphId); onEdit(`Add my component ${b.name}`, docPatches(r.doc)); setNote(`Added an independent copy of ${b.name}.`); }} title="Insert an independent copy into the open graph">Add</button>)))}
        {tab === 'assets' && <>
          {doc.assets.filter(a => match(a.provenance.originalFilename, a.kind, a.colorSpace, 'imported')).map(a => {
            const t = assetComponent(a);
            return row(a.id, a.provenance.originalFilename, `imported ${a.kind} · ${a.colorSpace}${a.width ? ` · ${a.width}×${a.height}` : ''}`,
              <button type="button" disabled={typeof t === 'string'} onClick={() => { if (typeof t !== 'string') insert(t); }} title={typeof t === 'string' ? t : t.description}>Add to effect</button>);
          })}
          {BUILTIN_SPRITES.filter(s => match(s.id, s.kind, 'included sprite')).map(s => (
            <li key={s.id} className="lib-row">
              <img className="lib-thumb" src={`/assets/sprites/${s.file}`} alt="" loading="lazy" />
              <div className="lib-text"><strong>{s.id}</strong><span className="pv2-muted">included {s.kind} · {s.columns}×{s.rows}</span></div>
            </li>
          ))}
        </>}
      </ul>
      <style>{`.lib-root{width:260px;flex:none;display:flex;flex-direction:column;gap:6px;padding:8px;border-right:1px solid #222834;min-height:0;overflow:hidden;font-size:14px}.lib-head{display:flex;justify-content:space-between;align-items:center}.lib-tabs{display:flex;flex-wrap:wrap;gap:4px}.pv2 .lib-tab{padding:4px 8px;min-width:0}.pv2 .lib-on{background:#2a3550;border-color:#7fb4ff}.lib-search{min-height:36px;background:#10131a;color:#d6dae3;border:1px solid #333b4a;border-radius:4px;padding:0 8px;font-size:14px}.lib-list{list-style:none;margin:0;padding:0;overflow:auto;display:flex;flex-direction:column;gap:6px}.lib-row{display:flex;gap:6px;align-items:center;border:1px solid #222834;border-radius:4px;padding:6px}.lib-text{display:flex;flex-direction:column;min-width:0;flex:1}.lib-text span{font-size:12px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.lib-thumb{width:40px;height:40px;flex:none;background:#000;object-fit:cover}`}</style>
    </aside>
  );
}
