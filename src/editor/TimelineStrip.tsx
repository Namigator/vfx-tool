// Timeline strip (user order 2026-09-29: "timeline strip with component bars"): one lane per component under the
// scrub bar. A bar spans the ticks where the component shows something (render/timeline.ts timelineLanes). Drag the
// bar = its Start at knob; drag the right-edge handle = its length knob (Burn time, Travel time) when it has one;
// a click without dragging selects the component's Group node; clicking an empty part of a lane seeks there.
// Each drag commits one undoable edit on release through the same path as the Controls panel.
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { EffectDocumentV2 } from '../model/types.ts';
import type { Patch as HistoryPatch } from './history.ts';
import type { TimelineLane } from '../render/timeline.ts';

type Props = {
  document: EffectDocumentV2; lanes: TimelineLane[]; tick: number; durationTicks: number; selectedNodeId: string | null;
  onEdit: (label: string, patches: HistoryPatch[]) => void; onSelect: (nodeId: string) => void; onSeek: (tick: number) => void;
};
type Drag = { prefix: string; mode: 'move' | 'stretch'; x0: number; width: number; delta: number };
type KeyDrag = { prefix: string; from: number; to: number; x0: number; width: number; pointer: number; min: number; max: number; controls: number[] };

const pct = (t: number, d: number) => `${(100 * Math.max(0, Math.min(d, t))) / Math.max(1, d)}%`;

export function TimelineStrip({ document: doc, lanes, tick, durationTicks, selectedNodeId, onEdit, onSelect, onSeek }: Props) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [keyDrag, setKeyDrag] = useState<KeyDrag | null>(null);
  const keyDragRef = useRef<KeyDrag | null>(null);
  if (!lanes.length) return null;
  const dur = Math.max(1, durationTicks);

  const beginKey = (e: ReactPointerEvent<HTMLElement>, lane: TimelineLane, from: number) => {
    if (!e.isPrimary || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.focus();
    const track = e.currentTarget.closest('.tl-track')?.getBoundingClientRect();
    if (!track) return;
    const prefixes = lanes.map(l => l.prefix).sort((a, b) => b.length - a.length);
    const controls = doc.controls.flatMap((c, index) => prefixes.find(p => c.id.startsWith(`ctl-${p}-`)) === lane.prefix && c.keys?.some(k => k.tick === from) ? [index] : []);
    let min = 0, max = dur;
    for (const index of controls) for (const k of doc.controls[index].keys ?? []) {
      if (k.tick < from) min = Math.max(min, k.tick + 1);
      if (k.tick > from) max = Math.min(max, k.tick - 1);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    keyDragRef.current = { prefix: lane.prefix, from, to: from, x0: e.clientX, width: track.width, pointer: e.pointerId, min, max, controls };
    setKeyDrag(keyDragRef.current);
  };
  const moveKey = (e: ReactPointerEvent<HTMLElement>) => {
    const d = keyDragRef.current;
    if (!d || d.pointer !== e.pointerId) return;
    e.stopPropagation();
    const to = Math.max(d.min, Math.min(d.max, d.from + Math.round((e.clientX - d.x0) / Math.max(1, d.width) * dur)));
    if (to !== d.to) { keyDragRef.current = { ...d, to }; setKeyDrag(keyDragRef.current); }
  };
  const cancelKey = () => { keyDragRef.current = null; setKeyDrag(null); };
  const endKey = (e: ReactPointerEvent<HTMLElement>) => {
    moveKey(e);
    const d = keyDragRef.current;
    if (!d || d.pointer !== e.pointerId) return;
    cancelKey();
    e.stopPropagation();
    if (d.to !== d.from) onEdit(`Move keyframes from tick ${d.from} to ${d.to}`, d.controls.map(index => ({
      op: 'set', path: ['controls', index, 'keys'], value: doc.controls[index].keys!.map(k => k.tick === d.from ? { ...k, tick: d.to } : k).sort((a, b) => a.tick - b.tick),
    })));
    onSeek(d.to);
  };

  const begin = (e: ReactPointerEvent<HTMLElement>, lane: TimelineLane, mode: Drag['mode']) => {
    e.stopPropagation();
    const track = (e.currentTarget.closest('.tl-track') as HTMLElement | null)?.getBoundingClientRect();
    if (!track) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { prefix: lane.prefix, mode, x0: e.clientX, width: track.width, delta: 0 };
    setDrag(dragRef.current);
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const delta = Math.round(((e.clientX - d.x0) / Math.max(1, d.width)) * dur);
    if (delta !== d.delta) { dragRef.current = { ...d, delta }; setDrag(dragRef.current); }
  };
  const end = (lane: TimelineLane) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (d.delta === 0) { if (lane.groupNodeId) onSelect(lane.groupNodeId); return; }
    const index = d.mode === 'move' ? lane.startControl : lane.lengthControl;
    if (index === undefined) return;
    const c = doc.controls[index], old = typeof c.value === 'number' ? c.value : 0;
    const v = Math.max(c.min ?? 0, Math.min(c.max ?? Infinity, Math.round(old + d.delta)));
    if (v !== old) onEdit(`Set ${lane.label} ${c.label} = ${v}`, [{ op: 'set', path: ['controls', index, 'value'], value: v }]);
  };

  return (
    <div className="tl-root" aria-label="Components on the timeline">
      {lanes.map(lane => {
        const d = drag?.prefix === lane.prefix ? drag : null;
        const span = lane.span;
        const shift = d?.mode === 'move' ? d.delta : 0, grow = d?.mode === 'stretch' ? d.delta : 0;
        const start = span ? span[0] + shift : 0, stop = span ? Math.max(start + 1, span[1] + shift + grow) : 0;
        const length = lane.lengthControl !== undefined ? doc.controls[lane.lengthControl] : undefined;
        const title = `${lane.label}: ticks ${start}–${stop}${span && span[1] > durationTicks ? ' (cut off by the effect length)' : ''}\n`
          + (lane.startControl !== undefined ? 'Drag to move it (Start at). ' : '') + (length ? `Drag the right edge to change ${length.label}. ` : '') + 'Click to select it.';
        const selected = !!lane.groupNodeId && lane.groupNodeId === selectedNodeId;
        return (
          <div key={lane.prefix} className="tl-lane">
            <span className="tl-label" title={lane.label}>{lane.label}</span>
            <div className="tl-track" onPointerDown={e => { if (e.target !== e.currentTarget) return; const r = e.currentTarget.getBoundingClientRect(); onSeek(Math.round(((e.clientX - r.left) / Math.max(1, r.width)) * dur)); }}>
              {span ? (
                <div
                  className={`tl-bar${selected ? ' tl-selected' : ''}${d ? ' tl-dragging' : ''}${lane.startControl === undefined ? ' tl-fixed' : ''}`}
                  style={{ left: pct(start, dur), width: `calc(${pct(stop, dur)} - ${pct(start, dur)})` }}
                  title={title} role="button" aria-label={title}
                  onPointerDown={e => { if (lane.startControl !== undefined) begin(e, lane, 'move'); else { e.stopPropagation(); if (lane.groupNodeId) onSelect(lane.groupNodeId); } }}
                  onPointerMove={move} onPointerUp={() => end(lane)} onPointerCancel={() => { dragRef.current = null; setDrag(null); }}
                >
                  {d && <span className="tl-drag-readout">{d.mode === 'move' ? `start ${start}` : `${length?.label ?? 'length'} ${d.delta > 0 ? '+' : ''}${d.delta}`}</span>}
                  {length && <span className="tl-handle" title={`Drag to change ${length.label}`}
                    onPointerDown={e => begin(e, lane, 'stretch')} onPointerMove={move} onPointerUp={() => end(lane)} />}
                </div>
              ) : <span className="tl-empty">not visible</span>}
              {lane.keys?.map(k => {
                const active = keyDrag?.prefix === lane.prefix && keyDrag.from === k.tick;
                const shown = active ? keyDrag.to : k.tick;
                return <span key={k.tick} className={`tl-keyframe${active ? ' tl-key-dragging' : ''}`} style={{ left: pct(shown, dur) }}
                  title={`Tick ${shown}: ${k.labels.join(', ')} keyed. Drag to move; click to jump. Keys at the same tick move together; cannot cross another key.`}
                  role="button" aria-label={`${lane.label} keyframe at tick ${shown}`} tabIndex={0}
                  onPointerDown={e => beginKey(e, lane, k.tick)} onPointerMove={moveKey} onPointerUp={endKey}
                  onPointerCancel={cancelKey} onLostPointerCapture={cancelKey}
                  onKeyDown={e => { if (e.key === 'Escape') cancelKey(); if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSeek(k.tick); } }} />;
              })}
              <span className="tl-playhead" style={{ left: pct(tick, dur) }} />
            </div>
          </div>
        );
      })}
      <style>{`.tl-root{display:flex;flex-direction:column;gap:3px;padding:4px 8px 6px;font-size:12px}
.tl-lane{display:grid;grid-template-columns:150px 1fr;gap:8px;align-items:center}
.tl-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.85}
.tl-track{position:relative;height:18px;background:#161b24;border:1px solid #2a3140;border-radius:4px;cursor:pointer}
.tl-bar{position:absolute;top:2px;bottom:2px;min-width:4px;background:#3d6fb8;border:1px solid #6d9ae0;border-radius:3px;cursor:grab;touch-action:none;box-sizing:border-box}
.tl-bar.tl-fixed{cursor:pointer;background:#46505f;border-color:#6b7686}
.tl-bar.tl-selected{background:#c7862e;border-color:#f0b35a}
.tl-bar.tl-dragging{cursor:grabbing;opacity:.85}
.tl-handle{position:absolute;right:-1px;top:-1px;bottom:-1px;width:7px;background:#e8eef8;border-radius:0 3px 3px 0;cursor:ew-resize}
.tl-drag-readout{position:absolute;left:4px;top:-1px;font-size:11px;color:#fff;white-space:nowrap;pointer-events:none}
.tl-playhead{position:absolute;top:-2px;bottom:-2px;width:2px;margin-left:-1px;background:#ff5a5a;pointer-events:none}
.tl-empty{position:absolute;left:6px;top:1px;opacity:.5}
.tl-keyframe{position:absolute;top:2px;width:12px;height:12px;box-sizing:border-box;margin-left:-6px;background:#f0b35a;border:1px solid #1a1a1a;transform:rotate(45deg);cursor:grab;touch-action:none;z-index:2}.tl-key-dragging{cursor:grabbing;background:#fff0bd}.tl-keyframe:focus-visible{outline:2px solid white}`}</style>
    </div>
  );
}
