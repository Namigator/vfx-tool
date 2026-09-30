// Resizable two-pane split with a draggable splitter, persisted size, and an externally controlled
// collapsed state. Follows the common splitter pattern (VS Code, Blender, WAI-ARIA window splitter): drag to resize,
// drag well past the minimum to collapse the sized pane, double-click to reset to the default size, arrow keys to
// nudge, Enter to collapse/expand. Drag updates are
// throttled to one per animation frame so dragging never triggers a re-render storm; the viewport's own
// ResizeObserver (PreviewViewport#resize) picks up the new size and resizes the renderer accordingly.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

const STORAGE_PREFIX = 'pv2-split-';
/** How far past the minimum (px) a drag must go before the pane collapses. */
const COLLAPSE_OVERDRAG = 56;

function readStored(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: number): void {
  try { localStorage.setItem(STORAGE_PREFIX + key, String(Math.round(value))); } catch { /* private mode / quota */ }
}

export type SplitPaneProps = {
  /** localStorage key suffix; keep stable and unique per splitter. */
  storageKey: string;
  /** 'row' = side-by-side panes with a vertical drag handle; 'column' = stacked panes with a horizontal handle. */
  direction: 'row' | 'column';
  defaultSize: number;
  min: number;
  max?: number;
  /** 'first'/'second' hides that pane and the splitter, letting the other fill the space; false shows both. */
  collapsed?: 'first' | 'second' | false;
  onToggleCollapse?: () => void;
  first: ReactNode;
  second: ReactNode;
  ariaLabel: string;
  className?: string;
  /** Which pane the dragged/persisted size applies to; the other pane fills the remaining space (flex:1). Default 'first'. */
  sizedPane?: 'first' | 'second';
  /** Smallest size (px) left for the other pane while dragging. Default 120. */
  otherMin?: number;
};

export function SplitPane({ storageKey, direction, defaultSize, min, max, collapsed, onToggleCollapse, first, second, ariaLabel, className, sizedPane = 'first', otherMin = 120 }: SplitPaneProps) {
  const [size, setSize] = useState(() => readStored(storageKey, defaultSize));
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<number | null>(null);

  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); }, []);

  const applySize = useCallback((v: number) => {
    pendingRef.current = v;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (pendingRef.current !== null) setSize(pendingRef.current);
    });
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const container = containerRef.current;
    const rect = container?.getBoundingClientRect();
    const startPos = direction === 'row' ? e.clientX : e.clientY;
    const startSize = sizeRef.current;
    let dragging = true, raw = startSize;
    const sign = sizedPane === 'first' ? 1 : -1;
    const move = (ev: PointerEvent) => {
      if (!dragging) return;
      const pos = direction === 'row' ? ev.clientX : ev.clientY;
      const upper = Math.min(max ?? Infinity, Math.max(min, (direction === 'row' ? (rect?.width ?? 4000) : (rect?.height ?? 4000)) - otherMin));
      raw = startSize + sign * (pos - startPos);
      handle.classList.toggle('pv2-splitter-collapsing', !!onToggleCollapse && raw < min - COLLAPSE_OVERDRAG);
      applySize(Math.min(Math.max(raw, min), upper));
    };
    const up = () => {
      dragging = false;
      handle.classList.remove('pv2-splitter-collapsing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // Over-dragging past the minimum collapses the pane (its last size is kept for when it comes back).
      if (onToggleCollapse && raw < min - COLLAPSE_OVERDRAG) { setSize(startSize); onToggleCollapse(); return; }
      writeStored(storageKey, sizeRef.current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [direction, min, max, otherMin, applySize, storageKey, sizedPane, onToggleCollapse]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && onToggleCollapse) { e.preventDefault(); onToggleCollapse(); return; }
    const step = e.shiftKey ? 60 : 16;
    let grow = direction === 'row' ? e.key === 'ArrowRight' : e.key === 'ArrowDown';
    let shrink = direction === 'row' ? e.key === 'ArrowLeft' : e.key === 'ArrowUp';
    if (!grow && !shrink) return;
    if (sizedPane === 'second') { [grow, shrink] = [shrink, grow]; }
    e.preventDefault();
    const upper = max ?? 4000;
    const next = Math.min(Math.max(sizeRef.current + (grow ? step : -step), min), upper);
    setSize(next);
    writeStored(storageKey, next);
  }, [direction, min, max, storageKey, sizedPane, onToggleCollapse]);

  // The sized pane keeps its size (no grow); the other pane takes the rest.
  const paneStyle: CSSProperties = direction === 'row' ? { flex: '0 1 auto', flexBasis: size, width: size } : { flex: '0 1 auto', flexBasis: size, height: size };
  const hideFirst = collapsed === 'first';
  const hideSecond = collapsed === 'second';

  return (
    <div ref={containerRef} className={`pv2-split pv2-split-${direction}${className ? ` ${className}` : ''}`}>
      {!hideFirst && <div className="pv2-split-pane pv2-split-first" style={hideSecond || sizedPane !== 'first' ? undefined : paneStyle}>{first}</div>}
      {!hideFirst && !hideSecond && (
        <div
          className="pv2-splitter"
          role="separator"
          aria-orientation={direction === 'row' ? 'vertical' : 'horizontal'}
          aria-label={ariaLabel}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          onDoubleClick={() => { setSize(defaultSize); writeStored(storageKey, defaultSize); }}
          title={`Drag to resize the ${ariaLabel.toLowerCase()}; drag it all the way to hide it; double-click to reset its size`}
        />
      )}
      {!hideSecond && <div className="pv2-split-pane pv2-split-second" style={hideFirst || sizedPane !== 'second' ? undefined : paneStyle}>{second}</div>}
    </div>
  );
}
