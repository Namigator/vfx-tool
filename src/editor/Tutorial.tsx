// Guided tour of the editor, started only from the top bar's Tutorial button (never automatically). Each step
// spotlights one part of the screen (a CSS selector) with a short card; Back / Next / Esc. Steps whose target is
// missing (panel hidden) fall back to a centred card, and `prepare` can open what the step needs first.
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

export type TutorialStep = {
  title: string;
  body: string;
  /** CSS selector of the element to spotlight; omitted = centred card. */
  target?: string;
  /** Runs when the step opens (e.g. open the library, switch to the Controls tab). */
  prepare?: () => void;
};

type Rect = { top: number; left: number; width: number; height: number };

export function Tutorial({ steps, onClose }: { steps: readonly TutorialStep[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = steps[index];

  useEffect(() => { step.prepare?.(); }, [step]);

  // Track the target's box (panels can move while the tour runs: resizing, playing, layout switches).
  useLayoutEffect(() => {
    let raf = 0, last = '';
    const measure = () => {
      const el = step.target ? document.querySelector(step.target) : null;
      const r = el?.getBoundingClientRect();
      const next = r && r.width > 4 && r.height > 4 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      const key = next ? `${next.top}|${next.left}|${next.width}|${next.height}` : '';
      if (key !== last) { last = key; setRect(next); }
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [step]);

  const go = useCallback((d: number) => {
    setIndex(i => {
      const n = i + d;
      if (n < 0) return 0;
      if (n >= steps.length) { onClose(); return i; }
      return n;
    });
  }, [steps.length, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, onClose]);

  // Card placement: beside the spotlight where there is room (right, left, below, above), else centred.
  const W = 340, pad = 8, vw = window.innerWidth, vh = window.innerHeight;
  let cardStyle: React.CSSProperties = { left: Math.max(16, (vw - W) / 2), top: Math.max(16, vh / 2 - 120) };
  if (rect) {
    const right = rect.left + rect.width + 16, left = rect.left - W - 16, below = rect.top + rect.height + 16;
    const clampTop = (t: number) => Math.min(Math.max(16, t), vh - 260);
    if (right + W < vw - 8) cardStyle = { left: right, top: clampTop(rect.top) };
    else if (left > 8) cardStyle = { left, top: clampTop(rect.top) };
    else if (below + 200 < vh) cardStyle = { left: Math.min(Math.max(16, rect.left), vw - W - 16), top: below };
    else cardStyle = { left: Math.min(Math.max(16, rect.left), vw - W - 16), top: Math.max(16, rect.top - 236) };
  }

  return (
    <div className="tut-root" role="dialog" aria-modal="true" aria-labelledby="tut-title">
      {rect
        ? <div className="tut-spot" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad }} />
        : <div className="tut-dim" />}
      <div className="tut-card" style={{ ...cardStyle, width: W }}>
        <div className="tut-count">Step {index + 1} of {steps.length}</div>
        <h2 id="tut-title">{step.title}</h2>
        <p>{step.body}</p>
        <div className="tut-actions">
          <button type="button" onClick={onClose}>Close</button>
          <span className="tut-spacer" />
          <button type="button" disabled={index === 0} onClick={() => go(-1)}>Back</button>
          <button type="button" className="tut-next" autoFocus onClick={() => go(1)}>{index === steps.length - 1 ? 'Finish' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
