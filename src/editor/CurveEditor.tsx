// 12-EDITOR curve and gradient editors: "Curve editor has draggable points plus a keyboard-accessible numeric key
// table. Enforce ordered unique x values; add/delete keys; linear/hold interpolation; zoom to domain. Gradient editor
// has stop positions, color/alpha and numeric editing. No inaccessible canvas-only editing."
// Both edit a local draft and commit the whole value through the inspector's validator (onCommit returns false when
// the value is rejected; the reason is shown by the inspector).
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ColorValue, CurveValue, GradientValue } from '../model/types.ts';

const W = 240, H = 110, PAD = 8;
const MAX_KEYS = 16, MAX_STOPS = 8;
const round = (v: number) => Math.round(v * 1000) / 1000;

/** x range of a curve domain; effectSeconds curves span the document duration. */
function xRange(c: CurveValue, durationSeconds: number): [number, number] {
  return c.domain === 'effectSeconds' ? [0, Math.max(0.1, durationSeconds)] : [0, 1];
}

export function CurveEditor({ id, value, yMin, yMax, durationSeconds, disabled, label, onCommit }: {
  id: string; value: CurveValue; yMin?: number; yMax?: number; durationSeconds: number; disabled?: boolean; label: string;
  onCommit: (v: CurveValue) => boolean;
}) {
  const [draft, setDraft] = useState<CurveValue>(value);
  useEffect(() => setDraft(value), [value]);
  const drag = useRef<number | null>(null);
  const [x0, x1] = xRange(draft, durationSeconds);
  const ys = draft.keys.map(k => k.y);
  // Zoom to the keys (not the whole allowed range, which can be 0–20 for a 0–1.4 curve); room above for dragging up.
  const lo = Math.max(yMin ?? -Infinity, Math.min(0, ...ys)), hi = Math.min(yMax ?? Infinity, Math.max(1, ...ys) * 1.25);
  const px = (x: number) => PAD + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * PAD);
  const py = (y: number) => H - PAD - ((y - lo) / (hi - lo || 1)) * (H - 2 * PAD);
  const sorted = (c: CurveValue): CurveValue => ({ ...c, keys: [...c.keys].sort((a, b) => a.x - b.x) });
  const commit = (c: CurveValue) => { const s = sorted(c); setDraft(s); if (!onCommit(s)) setDraft(value); };

  const path = draft.keys.map((k, i) => {
    if (i === 0) return `M${px(k.x)},${py(k.y)}`;
    return draft.interpolation === 'hold' ? `H${px(k.x)}V${py(k.y)}` : `L${px(k.x)},${py(k.y)}`;
  }).join('');

  const toValue = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, ((e.clientX - r.left) / r.width * W - PAD) / (W - 2 * PAD)));
    const fy = Math.min(1, Math.max(0, (H - PAD - (e.clientY - r.top) / r.height * H) / (H - 2 * PAD)));
    return { x: round(x0 + fx * (x1 - x0)), y: round(lo + fy * (hi - lo)) };
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const i = drag.current;
    if (i === null) return;
    const p = toValue(e), keys = draft.keys.map(k => ({ ...k }));
    // Ends stay at the domain edges; inner keys cannot pass their neighbours (ordered unique x).
    const minX = i === 0 ? x0 : keys[i - 1].x + 0.001, maxX = i === keys.length - 1 ? x1 : keys[i + 1].x - 0.001;
    keys[i] = { x: i === 0 || i === keys.length - 1 ? keys[i].x : Math.min(maxX, Math.max(minX, p.x)), y: p.y };
    setDraft({ ...draft, keys });
  };
  const endDrag = () => { if (drag.current !== null) { drag.current = null; commit(draft); } };
  const addKey = () => {
    if (draft.keys.length >= MAX_KEYS) return;
    // New key halfway along the widest gap, on the curve.
    let g = 0;
    for (let i = 1; i < draft.keys.length; i++) if (draft.keys[i].x - draft.keys[i - 1].x > draft.keys[g + 1].x - draft.keys[g].x) g = i - 1;
    const a = draft.keys[g], b = draft.keys[g + 1], x = round((a.x + b.x) / 2);
    commit({ ...draft, keys: [...draft.keys, { x, y: draft.interpolation === 'hold' ? a.y : round((a.y + b.y) / 2) }] });
  };
  const setKey = (i: number, field: 'x' | 'y', text: string) => {
    const v = Number(text);
    if (!Number.isFinite(v)) { setDraft(value); return; }
    commit({ ...draft, keys: draft.keys.map((k, j) => (j === i ? { ...k, [field]: v } : k)) });
  };

  return (
    <div className="ce" role="group" aria-label={`${label} curve`}>
      <svg className="ce-plot" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true"
        onPointerMove={onMove} onPointerUp={endDrag} onPointerLeave={endDrag}>
        <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} className="ce-bg" />
        <path d={path} className="ce-line" />
        {draft.keys.map((k, i) => (
          <circle key={i} cx={px(k.x)} cy={py(k.y)} r={5} className="ce-key"
            onPointerDown={e => { if (disabled) return; (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId); drag.current = i; }} />
        ))}
      </svg>
      <div className="ce-tools">
        <select id={id} disabled={disabled} value={draft.interpolation} aria-label={`${label} interpolation`}
          onChange={e => commit({ ...draft, interpolation: e.target.value as CurveValue['interpolation'] })}>
          <option value="linear">linear</option><option value="hold">hold (steps)</option>
        </select>
        <button type="button" disabled={disabled || draft.keys.length >= MAX_KEYS} onClick={addKey}>Add key</button>
        <span className="ce-range">{draft.domain === 'effectSeconds' ? `0–${x1.toFixed(2)} s` : 'start → end'}</span>
      </div>
      <table className="ce-table">
        <thead><tr><th>{draft.domain === 'effectSeconds' ? 'Time (s)' : 'Position'}</th><th>Value</th><th /></tr></thead>
        <tbody>
          {draft.keys.map((k, i) => (
            <tr key={`${i}-${k.x}`}>
              <td><input type="number" step="any" defaultValue={k.x} disabled={disabled || i === 0 || i === draft.keys.length - 1} aria-label={`Key ${i + 1} position`}
                onBlur={e => { if (Number(e.target.value) !== k.x) setKey(i, 'x', e.target.value); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></td>
              <td><input type="number" step="any" defaultValue={k.y} disabled={disabled} aria-label={`Key ${i + 1} value`}
                onBlur={e => { if (Number(e.target.value) !== k.y) setKey(i, 'y', e.target.value); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></td>
              <td><button type="button" disabled={disabled || draft.keys.length <= 2 || i === 0 || i === draft.keys.length - 1} aria-label={`Delete key ${i + 1}`}
                onClick={() => commit({ ...draft, keys: draft.keys.filter((_, j) => j !== i) })}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const css = (g: GradientValue) => `linear-gradient(to right, ${g.stops.map(s => `${s.color.srgb}${Math.round(s.color.alpha * 255).toString(16).padStart(2, '0')} ${s.position * 100}%`).join(', ')})`;

export function GradientEditor({ id, value, disabled, label, onCommit }: {
  id: string; value: GradientValue; disabled?: boolean; label: string; onCommit: (v: GradientValue) => boolean;
}) {
  const [draft, setDraft] = useState<GradientValue>(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (g: GradientValue) => { const s = { ...g, stops: [...g.stops].sort((a, b) => a.position - b.position) }; setDraft(s); if (!onCommit(s)) setDraft(value); };
  const setStop = (i: number, patch: Partial<{ position: number; color: ColorValue }>) => commit({ ...draft, stops: draft.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const addStop = () => {
    if (draft.stops.length >= MAX_STOPS) return;
    let g = 0;
    for (let i = 1; i < draft.stops.length; i++) if (draft.stops[i].position - draft.stops[i - 1].position > draft.stops[g + 1].position - draft.stops[g].position) g = i - 1;
    const a = draft.stops[g], b = draft.stops[g + 1];
    commit({ ...draft, stops: [...draft.stops, { position: round((a.position + b.position) / 2), color: { ...a.color } }] });
  };
  return (
    <div className="ce" role="group" aria-label={`${label} gradient`}>
      <div className="ge-bar" style={{ background: css(draft) }} aria-hidden="true" />
      <table className="ce-table">
        <thead><tr><th>Position</th><th>Colour</th><th>Alpha</th><th /></tr></thead>
        <tbody>
          {draft.stops.map((s, i) => (
            <tr key={`${i}-${s.position}`}>
              <td><input id={i === 0 ? id : undefined} type="number" step="any" min={0} max={1} defaultValue={s.position} aria-label={`Stop ${i + 1} position`}
                disabled={disabled || i === 0 || i === draft.stops.length - 1}
                onBlur={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== s.position) setStop(i, { position: v }); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></td>
              <td><input type="color" value={s.color.srgb.toLowerCase()} disabled={disabled} aria-label={`Stop ${i + 1} colour`}
                onChange={e => setStop(i, { color: { ...s.color, srgb: e.target.value.toUpperCase() } })} /></td>
              <td><input type="number" step="0.05" min={0} max={1} defaultValue={s.color.alpha} disabled={disabled} aria-label={`Stop ${i + 1} alpha`}
                onBlur={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== s.color.alpha) setStop(i, { color: { ...s.color, alpha: v } }); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></td>
              <td><button type="button" aria-label={`Delete stop ${i + 1}`} disabled={disabled || draft.stops.length <= 2 || i === 0 || i === draft.stops.length - 1}
                onClick={() => commit({ ...draft, stops: draft.stops.filter((_, j) => j !== i) })}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" disabled={disabled || draft.stops.length >= MAX_STOPS} onClick={addStop}>Add colour stop</button>
    </div>
  );
}
