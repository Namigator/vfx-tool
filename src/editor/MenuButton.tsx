// A compact keyboard-accessible dropdown menu (File / Export / View overlay). Esc closes and returns focus
// to the trigger; Up/Down move between items; Home/End jump to the first/last item; a click outside or a
// blur to somewhere else closes it. Items are plain buttons so existing onClick handlers/titles are reused
// unchanged from the old flat toolbar.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

export type MenuItem = {
  label: string;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  /** Renders as a non-interactive separator line instead of a button. */
  separator?: boolean;
  /** Renders as inert, greyed text describing a feature that is not wired up yet. */
  note?: boolean;
};

export function MenuButton({ label, items, align = 'left' }: { label: string; items: MenuItem[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [open]);

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const focusables = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
    const idx = focusables.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusables[(idx + 1) % focusables.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusables[(idx - 1 + focusables.length) % focusables.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); focusables[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); focusables[focusables.length - 1]?.focus(); }
    else if (e.key === 'Tab') { close(false); }
  };

  return (
    <div className="pv2-menu">
      <button
        ref={buttonRef}
        type="button"
        className="pv2-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}
      >
        {label}
      </button>
      {open && (
        <div id={id} ref={menuRef} role="menu" aria-label={label} className={`pv2-menu-list pv2-menu-${align}`} onKeyDown={onMenuKeyDown}>
          {items.map((it, i) => it.separator ? (
            <div key={i} className="pv2-menu-sep" role="separator" />
          ) : it.note ? (
            <div key={i} className="pv2-menu-note">{it.label}</div>
          ) : (
            <button
              key={i}
              type="button"
              role="menuitem"
              aria-disabled={it.disabled}
              disabled={it.disabled}
              className="pv2-menu-item"
              title={it.title}
              onClick={() => { if (it.disabled) return; it.onClick?.(); close(true); }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A small overlay dropdown (View menu in the viewport corner) with the same keyboard behaviour but free-form content. */
export function OverlayMenu({ label, title, children, align = 'right' }: { label: ReactNode; title?: string; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDocDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="pv2-overlay-menu">
      <button ref={buttonRef} type="button" className="pv2-overlay-trigger" aria-haspopup="true" aria-expanded={open} title={title} onClick={() => setOpen(o => !o)}>
        {label}
      </button>
      {open && <div ref={panelRef} className={`pv2-overlay-panel pv2-overlay-${align}`}>{children}</div>}
    </div>
  );
}
