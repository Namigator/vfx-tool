// Simple view (01 "Simple surface", 12 "Open a preset in Simple view"): the document's published number
// controls grouped by section, each a slider + number field. A drag previews locally and commits one
// undoable edit on release (only if it moved: focusing a slider never commits its step-snapped value); the field commits on Enter/blur. Every control lists what it drives.
import { useState } from 'react';
import type { EffectDocumentV2, PublicControl } from '../model/types.ts';
import type { Patch as HistoryPatch } from './history.ts';

const UNIT_LABEL: Record<string, string> = { meter: 'm', second: 's', tick: 'ticks', radian: 'rad', metersPerSecond: 'm/s', metersPerSecondSquared: 'm/s²', hertz: 'Hz', perSecond: '/s', linearGain: '×', normalized: '', none: '' };

type Props = { document: EffectDocumentV2; onEdit: (label: string, patches: HistoryPatch[]) => void };

function ControlRow({ c, index, onEdit }: { c: PublicControl; index: number; onEdit: Props['onEdit'] }) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = typeof c.value === 'number' ? c.value : 0;
  const min = c.min ?? 0, max = c.max ?? Math.max(1, value * 4);
  const step = c.step ?? (c.type === 'integer' ? 1 : (max - min) / 1000);
  const shown = draft ?? String(value);
  const commit = (text: string) => {
    setDraft(null);
    let v = Number(text);
    if (!Number.isFinite(v)) return;
    v = Math.min(max, Math.max(min, c.type === 'integer' ? Math.round(v) : v));
    if (v !== value) onEdit(`Set ${c.label} = ${v}`, [{ op: 'set', path: ['controls', index, 'value'], value: v }]);
  };
  return (
    <div className="cp-row" title={c.description}>
      <label className="cp-label" htmlFor={`cp-${c.id}`}>{c.label}</label>
      <input id={`cp-${c.id}`} type="range" min={min} max={max} step={step} value={Number(shown) || 0}
        onChange={e => setDraft(e.currentTarget.value)}
        onPointerUp={e => { if (draft !== null) commit(e.currentTarget.value); }} onKeyUp={e => { if (draft !== null) commit(e.currentTarget.value); }} />
      <input className="cp-num" type="number" min={min} max={max} step={c.type === 'integer' ? 1 : 'any'} value={shown} aria-label={`${c.label} value`}
        onChange={e => setDraft(e.currentTarget.value)} onBlur={e => commit(e.currentTarget.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(e.currentTarget.value); if (e.key === 'Escape') setDraft(null); }} />
      <span className="cp-unit">{UNIT_LABEL[c.unit] ?? c.unit}</span>
    </div>
  );
}

export function ControlsPanel({ document: doc, onEdit }: Props) {
  const numeric = doc.controls.map((c, i) => [c, i] as const).filter(([c]) => c.type === 'number' || c.type === 'integer');
  if (!numeric.length) return <p className="pv2-muted">No published controls. Insert a component (Add component) to get its knobs.</p>;
  const sections = [...new Set(numeric.map(([c]) => c.section))];
  return (
    <div className="cp-root">
      {sections.map(s => (
        <fieldset key={s} className="cp-section">
          <legend>{s}</legend>
          {numeric.filter(([c]) => c.section === s).map(([c, i]) => <ControlRow key={c.id} c={c} index={i} onEdit={onEdit} />)}
        </fieldset>
      ))}
      <style>{`.cp-root{display:flex;flex-direction:column;gap:10px}.cp-section{border:1px solid #2a3140;border-radius:6px;padding:6px 8px 8px;margin:0}.cp-section legend{font-size:13px;font-weight:600;padding:0 4px}.cp-row{display:grid;grid-template-columns:minmax(90px,1fr) 2fr 72px auto;gap:6px;align-items:center;font-size:13px;margin-top:4px}.cp-num{width:72px}.cp-unit{font-size:11px;opacity:.7}`}</style>
    </div>
  );
}
