import { useEffect, useRef, useState } from 'react';

type Props = {
  /** The element the effect plays in; the window frames it. */
  target: () => HTMLElement | null;
  /** How long the effect plays inside the window before it opens, in ms. */
  holdMs: number;
  /** Called every animation frame while the window is shut (e.g. to keep the effect playing). */
  onTick?: () => void;
  /** After `holdMs`, the window opens on the first frame this returns true (e.g. the impact), at most 3 s later. */
  openWhen?: () => boolean;
  onDone: () => void;
};

const OPEN_MS = 1000;
const FADE_MS = 250;

/**
 * First-visit intro: everything but the preview is covered, so the effect plays alone in a window with the name
 * beneath it. After `holdMs` the window widens to the whole page and the cover fades. Any click or key skips ahead.
 */
export function IntroReveal({ target, holdMs, onTick, openWhen, onDone }: Props) {
  const windowRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'hold' | 'open' | 'fade'>('hold');
  const cb = useRef({ onTick, openWhen, onDone });
  cb.current = { onTick, openWhen, onDone };
  const openRef = useRef<() => void>(() => {});
  const shownAt = useRef(performance.now());

  useEffect(() => {
    if (phase !== 'hold') return;
    let raf = 0;
    const frame = () => {
      const r = target()?.getBoundingClientRect();
      const w = windowRef.current, l = labelRef.current;
      if (r && r.width > 0 && w && l) {
        Object.assign(w.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        const below = r.bottom + 24 + 80 < innerHeight;
        l.style.top = below ? `${r.bottom + 24}px` : `${r.top + 20}px`;
      }
      cb.current.onTick?.();
      const held = performance.now() - shownAt.current;
      if (held >= holdMs && (!cb.current.openWhen || cb.current.openWhen() || held >= holdMs + 3000)) { openRef.current(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase, target, holdMs]);

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const timers: number[] = [];
    let started = false;
    const open = () => {
      if (started) return;
      started = true;
      if (reduced) { setPhase('fade'); timers.push(window.setTimeout(() => cb.current.onDone(), FADE_MS)); return; }
      setPhase('open');
      timers.push(window.setTimeout(() => setPhase('fade'), OPEN_MS));
      timers.push(window.setTimeout(() => cb.current.onDone(), OPEN_MS + FADE_MS));
    };
    openRef.current = open;
    window.addEventListener('keydown', open);
    window.addEventListener('pointerdown', open);
    return () => { timers.forEach(clearTimeout); window.removeEventListener('keydown', open); window.removeEventListener('pointerdown', open); };
  }, []);

  return (
    <div className={`pv2-intro pv2-intro-${phase}`} role="presentation">
      <div ref={windowRef} className="pv2-intro-window" />
      <div ref={labelRef} className="pv2-intro-label">
        <div className="pv2-intro-name">VFX Studio</div>
        <div className="pv2-intro-line">Make it here. Play it in Roblox, Unreal, Unity or Godot.</div>
      </div>
    </div>
  );
}
