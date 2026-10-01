// Simple view (01 "Simple surface", 12 "Open a preset in Simple view"): the document's published controls
// grouped by section. Numbers get a slider + number field; colours a colour picker; vectors three number fields;
// booleans a checkbox; choices a dropdown. A drag previews locally and commits one
// undoable edit on release (only if it moved: focusing a slider never commits its step-snapped value); the field commits on Enter/blur. Every control lists what it drives.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { EffectDocumentV2, PublicControl } from '../model/types.ts';
import type { Patch as HistoryPatch } from './history.ts';
import type { FollowerTravel } from '../graph/toParticles.ts';
import { hueRotate, hueShiftToward } from '../graph/recolor.ts';
import { canKeyframe, controlValueAt, removeKeyAt, setKeyAt } from '../graph/keyframes.ts';

const UNIT_LABEL: Record<string, string> = { meter: 'm', second: 's', tick: 'ticks', radian: 'rad', metersPerSecond: 'm/s', metersPerSecondSquared: 'm/s²', hertz: 'Hz', perSecond: '/s', linearGain: '×', normalized: '', none: '' };

type Props = { document: EffectDocumentV2; onEdit: (label: string, patches: HistoryPatch[]) => void; followers?: FollowerTravel[]; tick?: number };

/**
 * Keyframed knobs (graph/keyframes.ts): with keys, a knob shows its value at the playhead and an edit sets the key
 * there. The diamond adds a key at the playhead (filled = a key sits here; click again removes it); the cross drops all.
 */
function setValuePatch(c: PublicControl, index: number, tick: number, v: number): HistoryPatch {
  return c.keys?.length ? { op: 'set', path: ['controls', index, 'keys'], value: setKeyAt(c.keys, tick, v) } : { op: 'set', path: ['controls', index, 'value'], value: v };
}
function KeyButton({ c, index, tick, onEdit, current }: { c: PublicControl; index: number; tick: number; onEdit: Props['onEdit']; current: number }) {
  if (!canKeyframe(c)) return null;
  const keys = c.keys ?? [], here = keys.some(k => k.tick === tick);
  const toggle = () => {
    if (here) {
      const next = removeKeyAt(keys, tick);
      // Removing the last key leaves the knob at the value it had there.
      onEdit(`Remove ${c.label} key at tick ${tick}`, next.length ? [{ op: 'set', path: ['controls', index, 'keys'], value: next }] : [{ op: 'delete', path: ['controls', index, 'keys'] }, { op: 'set', path: ['controls', index, 'value'], value: current }]);
    } else onEdit(`Key ${c.label} = ${current} at tick ${tick}`, [{ op: 'set', path: ['controls', index, 'keys'], value: setKeyAt(keys, tick, current) }]);
  };
  const list = keys.map(k => `${k.tick}: ${+k.value.toFixed(3)}`).join(', ');
  return (
    <span className="cp-keys">
      <button type="button" className={`cp-key${here ? ' cp-key-on' : keys.length ? ' cp-key-anim' : ''}`} onClick={toggle}
        title={here ? `Remove the key at tick ${tick}` : keys.length ? `Add a key at tick ${tick} (animated: ${list})` : `Animate this knob: add a key at tick ${tick}, move the playhead, change the knob - it now changes over time.`}
        aria-label={here ? `Remove ${c.label} key at tick ${tick}` : `Add ${c.label} key at tick ${tick}`}>{here ? '◆' : '◇'}</button>
      {keys.length > 0 && <button type="button" className="cp-key-clear" title="Stop animating: remove all keys (keeps the value at the playhead)" aria-label={`Clear ${c.label} keys`}
        onClick={() => onEdit(`Clear ${c.label} keys`, [{ op: 'delete', path: ['controls', index, 'keys'] }, { op: 'set', path: ['controls', index, 'value'], value: current }])}>×</button>}
    </span>
  );
}

function ControlRow({ c, index, onEdit, durationTicks, tick }: { c: PublicControl; index: number; onEdit: Props['onEdit']; durationTicks: number; tick: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const raw = controlValueAt(c, tick), value = typeof raw === 'number' ? raw : 0;
  const min = c.min ?? 0, max = c.max ?? Math.max(1, value * 4);
  const step = c.step ?? (c.type === 'integer' ? 1 : (max - min) / 1000);
  const shown = draft ?? String(value);
  const commit = (text: string) => {
    setDraft(null);
    let v = Number(text);
    if (!Number.isFinite(v)) return;
    v = Math.min(max, Math.max(min, c.type === 'integer' ? Math.round(v) : v));
    if (v === value) return;
    // The editor lengthens the effect when the new value pushes its end past the duration (grownDuration).
    onEdit(c.keys?.length ? `Key ${c.label} = ${v} at tick ${tick}` : `Set ${c.label} = ${v}`, [setValuePatch(c, index, tick, v)]);
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
      <span className="cp-unit">{UNIT_LABEL[c.unit] ?? c.unit}<KeyButton c={c} index={index} tick={tick} onEdit={onEdit} current={value} /></span>
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

/** A Colour knob (number bound to hueShift with a swatch): a picker showing the shifted swatch; picking sets the
 *  wheel turn that brings the swatch's hue to the picked one. The degrees field stays for exact values. */
function HueRow({ c, index, onEdit, tick }: { c: PublicControl; index: number; onEdit: Props['onEdit']; tick: number }) {
  const raw = controlValueAt(c, tick), value = typeof raw === 'number' ? Math.round(raw) : 0;
  const swatch = { srgb: c.swatch!, alpha: 1 };
  const set = (v: number) => { if (v !== value) onEdit(c.keys?.length ? `Key ${c.label} = ${v} at tick ${tick}` : `Set ${c.label} = ${v}`, [setValuePatch(c, index, tick, v)]); };
  const shown = hueRotate(swatch, value).srgb.toLowerCase();
  return (
    <div className="cp-row cp-row-hue" title={c.description}>
      <label className="cp-label" htmlFor={`cp-${c.id}`}>{c.label}</label>
      <ColorInput key={shown} id={`cp-${c.id}`} value={shown} onCommit={srgb => set(hueShiftToward(swatch, { srgb, alpha: 1 }))} />
      <input className="cp-num" type="number" min={-180} max={180} step={1} defaultValue={value} key={value} aria-label={`${c.label} degrees`}
        onBlur={e => { const n = Math.round(Number(e.currentTarget.value)); if (Number.isFinite(n)) set(Math.max(-180, Math.min(180, n))); }}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      <span className="cp-unit">°{value !== 0 ? <button type="button" className="cp-reset" onClick={() => set(0)} title="Back to the original colours">reset</button> : null}<KeyButton c={c} index={index} tick={tick} onEdit={onEdit} current={value} /></span>
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
      {followers.map(f => f.pathCount > 1 ? (
        <div key={f.nodeId} className="cp-travel">
          {label(f.nodeId)}: follows {f.pathCount} paths, {Math.min(...f.lengths).toFixed(2)}{Math.max(...f.lengths) - Math.min(...f.lengths) > 0.005 ? `-${Math.max(...f.lengths).toFixed(2)}` : ''} m each, arriving at {Math.min(...f.travels) === Math.max(...f.travels) ? `${f.travels[0]} ticks` : `${Math.min(...f.travels)}-${Math.max(...f.travels)} ticks`} after start
          {f.speedMode ? ' (speed mode: each path takes its own length / speed)' : ' (duration mode: every path takes the same time)'}
        </div>
      ) : (
        <div key={f.nodeId} className="cp-travel">
          {label(f.nodeId)}: {f.lengthMeters.toFixed(2)} m in {f.travelTicks} ticks ({(f.travelTicks / 60).toFixed(2)} s) = {(f.lengthMeters / (f.travelTicks / 60)).toFixed(1)} m/s
          {f.speedMode ? ' (speed mode: moving the Target keeps this speed)' : ' (duration mode: moving the Target changes the speed)'}
        </div>
      ))}
    </fieldset>
  );
}

function AnchorCoordinate({ value, label, onCommit }: { value: number; label: string; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const number = Number(draft);
    setDraft(null);
    if (draft.trim() && Number.isFinite(number) && number !== value) onCommit(number);
  };
  return <input className="cp-num" type="number" step="any" aria-label={label} value={draft ?? String(value)}
    onChange={e => setDraft(e.currentTarget.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') setDraft(null); }} />;
}

export function ControlsPanel({ document: doc, onEdit, followers = [], tick = 0 }: Props) {
  const all = doc.controls.map((c, i) => [c, i] as const);
  const sections = [...new Set(all.map(([c]) => c.section))];
  return (
    <div className="cp-root">
      <fieldset className="cp-section">
        <legend>Source &amp; Target</legend>
        <p className="pv2-muted">Position in metres: X sideways, Y height, Z depth.</p>
        {doc.anchors.map((anchor, index) => (anchor.id === 'source' || anchor.id === 'target') && (
          <div className="cp-row cp-row-value" key={anchor.id}>
            <span className="cp-label">{anchor.id === 'source' ? 'Source' : 'Target'}</span>
            <span className="cp-vec">{anchor.position.map((value, axis) => (
              <label key={axis} style={{ minWidth: 0, flex: 1 }}>{'XYZ'[axis]}
                <AnchorCoordinate key={`${anchor.id}-${axis}-${value}`} value={value} label={`${anchor.id === 'source' ? 'Source' : 'Target'} ${'XYZ'[axis]}`}
                  onCommit={next => onEdit(`Move ${anchor.id} ${'XYZ'[axis]}`, [{ op: 'set', path: ['anchors', index, 'position', axis], value: next }])} />
              </label>
            ))}</span>
          </div>
        ))}
      </fieldset>
      {!all.length && <p className="pv2-muted">No published controls. Insert a component (Add component) to get its knobs.</p>}
      {sections.map(s => (
        <fieldset key={s} className="cp-section">
          <legend>{s}</legend>
          {all.filter(([c]) => c.section === s).map(([c, i]) => c.swatch && isNumber(c)
            ? <HueRow key={c.id} c={c} index={i} onEdit={onEdit} tick={tick} />
            : isNumber(c)
            ? <ControlRow key={c.id} c={c} index={i} onEdit={onEdit} durationTicks={doc.durationTicks} tick={tick} />
            : <ValueRow key={`${c.id}-${JSON.stringify(c.value)}`} c={c} index={i} onEdit={onEdit} />)}
        </fieldset>
      ))}
      <TravelReadout doc={doc} followers={followers} />
      <style>{`.cp-root{display:flex;flex-direction:column;gap:10px}.cp-section{border:1px solid #2a3140;border-radius:6px;padding:6px 8px 8px;margin:0}.cp-section legend{font-size:13px;font-weight:600;padding:0 4px}.cp-row{display:grid;grid-template-columns:minmax(64px,.9fr) minmax(36px,2fr) 56px auto;gap:6px;align-items:center;font-size:13px;margin-top:4px}.cp-row>*{min-width:0}.cp-row input[type=range]{width:100%;min-width:0;margin:0}.cp-num{width:56px}.cp-row-value{grid-template-columns:minmax(64px,.9fr) minmax(0,3fr)}.cp-vec{display:flex;gap:4px}.cp-travel{font-size:12px;opacity:.85;margin-top:4px}.cp-unit{font-size:11px;opacity:.7}.cp-row-hue{grid-template-columns:minmax(64px,.9fr) minmax(36px,2fr) 56px auto}.pv2 .cp-root button.cp-reset{margin-left:4px;font-size:11px;min-height:24px;padding:0 6px}.cp-keys{display:inline-flex;gap:2px;margin-left:3px;vertical-align:middle}.cp-unit{white-space:nowrap}.pv2 .cp-root button.cp-key,.pv2 .cp-root button.cp-key-clear{padding:0;font-size:12px;line-height:1;height:24px;width:24px;min-width:24px;min-height:24px;border-radius:3px}.cp-key-on{color:#f0b35a}.cp-key-anim{color:#8fb8ff}`}</style>
    </div>
  );
}
