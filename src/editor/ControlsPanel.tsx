// Simple view (01 "Simple surface", 12 "Open a preset in Simple view"): the document's published controls
// grouped by section. Numbers get a slider + number field; colours a colour picker; vectors three number fields;
// booleans a checkbox; choices a dropdown. A drag previews locally and commits one
// undoable edit on release (only if it moved: focusing a slider never commits its step-snapped value); the field commits on Enter/blur. Every control lists what it drives.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { EffectDocumentV2, PublicControl } from '../model/types.ts';
import type { Patch as HistoryPatch } from './history.ts';
import type { FollowerTravel } from '../graph/toParticles.ts';

const UNIT_LABEL: Record<string, string> = { meter: 'm', second: 's', tick: 'ticks', radian: 'rad', metersPerSecond: 'm/s', metersPerSecondSquared: 'm/s²', hertz: 'Hz', perSecond: '/s', linearGain: '×', normalized: '', none: '' };

type Props = { document: EffectDocumentV2; onEdit: (label: string, patches: HistoryPatch[]) => void; followers?: FollowerTravel[] };

function ControlRow({ c, index, onEdit, durationTicks }: { c: PublicControl; index: number; onEdit: Props['onEdit']; durationTicks: number }) {
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
    if (v === value) return;
    // A component's Start at knob lengthens the effect by the same amount so the delayed part is not cut off (never shortens).
    const grow = c.id.endsWith('-start-at') && v > value ? Math.min(600, durationTicks + (v - value)) : durationTicks;
    onEdit(`Set ${c.label} = ${v}`, [{ op: 'set', path: ['controls', index, 'value'], value: v }, ...(grow > durationTicks ? [{ op: 'set' as const, path: ['durationTicks'], value: grow }] : [])]);
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

/** Colour picker committing once when the picker closes (native `change`), not on every drag step (`input`). */
function ColorInput({ id, value, onCommit }: { id: string; value: string; onCommit: (srgb: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => commit.current(el.value.toUpperCase());
    el.addEventListener('change', on);
    return () => el.removeEventListener('change', on);
  }, []);
  return <input ref={ref} id={id} type="color" defaultValue={value} />;
}

/** Non-number knobs: each change is one undoable edit. */
function ValueRow({ c, index, onEdit }: { c: PublicControl; index: number; onEdit: Props['onEdit'] }) {
  const set = (value: PublicControl['value'], text: string) => onEdit(`Set ${c.label} = ${text}`, [{ op: 'set', path: ['controls', index, 'value'], value }]);
  let input: ReactElement | null = null;
  const v = c.value as unknown;
  if (c.type === 'color' && typeof v === 'object' && v !== null && 'srgb' in v) {
    const col = v as { srgb: string; alpha: number };
    input = <ColorInput id={`cp-${c.id}`} value={col.srgb.slice(0, 7).toLowerCase()} onCommit={srgb => { if (srgb !== col.srgb.toUpperCase()) set({ ...col, srgb }, srgb); }} />;
  } else if ((c.type === 'vec2' || c.type === 'vec3') && Array.isArray(v)) {
    const vec = v as number[];
    input = <span className="cp-vec">{vec.map((x, axis) => (
      <input key={axis} className="cp-num" type="number" step="any" defaultValue={x} aria-label={`${c.label} ${'xyz'[axis]}`}
        onBlur={e => { const n = Number(e.currentTarget.value); if (Number.isFinite(n) && n !== x) { const next = [...vec]; next[axis] = n; set(next as PublicControl['value'], `[${next.join(', ')}]`); } }} />
    ))}</span>;
  } else if (c.type === 'boolean' && typeof v === 'boolean') {
    input = <input id={`cp-${c.id}`} type="checkbox" checked={v} onChange={e => set(e.currentTarget.checked, String(e.currentTarget.checked))} />;
  } else if (c.choices && typeof v === 'string') {
    input = <select id={`cp-${c.id}`} value={v} onChange={e => set(e.currentTarget.value, e.currentTarget.value)}>{c.choices.map(x => <option key={x} value={x}>{x}</option>)}</select>;
  }
  if (!input) return null;
  return (
    <div className="cp-row cp-row-value" title={c.description}>
      <label className="cp-label" htmlFor={`cp-${c.id}`}>{c.label}</label>
      {input}
    </div>
  );
}

const isNumber = (c: PublicControl) => c.type === 'number' || c.type === 'integer';

/** 10 "resolved duration shown": each projectile's distance, travel ticks and actual speed. */
function TravelReadout({ doc, followers }: { doc: EffectDocumentV2; followers: FollowerTravel[] }) {
  if (!followers.length) return null;
  const label = (id: string) => doc.graphs.flatMap(g => g.nodes).find(n => n.id === id)?.label || id;
  return (
    <fieldset className="cp-section">
      <legend>Projectile travel</legend>
      {followers.map(f => (
        <div key={f.nodeId} className="cp-travel">
          {label(f.nodeId)}: {f.lengthMeters.toFixed(2)} m in {f.travelTicks} ticks ({(f.travelTicks / 60).toFixed(2)} s) = {(f.lengthMeters / (f.travelTicks / 60)).toFixed(1)} m/s
          {f.speedMode ? ' (speed mode: moving the Target keeps this speed)' : ' (duration mode: moving the Target changes the speed)'}
        </div>
      ))}
    </fieldset>
  );
}

export function ControlsPanel({ document: doc, onEdit, followers = [] }: Props) {
  const all = doc.controls.map((c, i) => [c, i] as const);
  if (!all.length) return <p className="pv2-muted">No published controls. Insert a component (Add component) to get its knobs.</p>;
  const sections = [...new Set(all.map(([c]) => c.section))];
  return (
    <div className="cp-root">
      {sections.map(s => (
        <fieldset key={s} className="cp-section">
          <legend>{s}</legend>
          {all.filter(([c]) => c.section === s).map(([c, i]) => isNumber(c)
            ? <ControlRow key={c.id} c={c} index={i} onEdit={onEdit} durationTicks={doc.durationTicks} />
            : <ValueRow key={`${c.id}-${JSON.stringify(c.value)}`} c={c} index={i} onEdit={onEdit} />)}
        </fieldset>
      ))}
      <TravelReadout doc={doc} followers={followers} />
      <style>{`.cp-root{display:flex;flex-direction:column;gap:10px}.cp-section{border:1px solid #2a3140;border-radius:6px;padding:6px 8px 8px;margin:0}.cp-section legend{font-size:13px;font-weight:600;padding:0 4px}.cp-row{display:grid;grid-template-columns:minmax(90px,1fr) 2fr 72px auto;gap:6px;align-items:center;font-size:13px;margin-top:4px}.cp-num{width:72px}.cp-row-value{grid-template-columns:minmax(90px,1fr) 3fr}.cp-vec{display:flex;gap:4px}.cp-travel{font-size:12px;opacity:.85;margin-top:4px}.cp-unit{font-size:11px;opacity:.7}`}</style>
    </div>
  );
}
