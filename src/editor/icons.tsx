// Small inline SVG icon set for the top bar and transport (no icon library dependency — user rule: vet
// before adding anything new). currentColor so buttons theme with CSS, 16x16 viewBox, stroke-based glyphs.
import type { SVGProps } from 'react';

const base = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export function IconUndo(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M4 7H10.5A3.5 3.5 0 0 1 14 10.5A3.5 3.5 0 0 1 10.5 14H7" /><path d="M6.5 4L4 7L6.5 10" /></svg>;
}
export function IconRedo(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M12 7H5.5A3.5 3.5 0 0 0 2 10.5A3.5 3.5 0 0 0 5.5 14H9" /><path d="M9.5 4L12 7L9.5 10" /></svg>;
}
export function IconPlay(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} fill="currentColor" stroke="none" {...p}><path d="M4.5 2.8a.8.8 0 0 1 1.22-.68l7 4.7a.8.8 0 0 1 0 1.36l-7 4.7A.8.8 0 0 1 4.5 12.2z" /></svg>;
}
export function IconPause(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} fill="currentColor" stroke="none" {...p}><rect x="4" y="3" width="3" height="10" rx="0.8" /><rect x="9" y="3" width="3" height="10" rx="0.8" /></svg>;
}
export function IconRestart(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M13 8A5 5 0 1 1 11.2 4.2" /><path d="M13 2.5V5.5H10" /></svg>;
}
export function IconStepBack(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} fill="currentColor" stroke="none" {...p}><rect x="3" y="3" width="1.6" height="10" rx="0.4" /><path d="M13 3.3a.8.8 0 0 0-1.22-.68l-6 4.7a.8.8 0 0 0 0 1.26l6 4.7a.8.8 0 0 0 1.22-.68z" /></svg>;
}
export function IconStepForward(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} fill="currentColor" stroke="none" {...p}><rect x="11.4" y="3" width="1.6" height="10" rx="0.4" /><path d="M3 3.3a.8.8 0 0 1 1.22-.68l6 4.7a.8.8 0 0 1 0 1.26l-6 4.7A.8.8 0 0 1 3 12.7z" /></svg>;
}
export function IconChevronDown(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M4 6l4 4 4-4" /></svg>;
}
export function IconPanelLeft(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><rect x="2" y="3" width="12" height="10" rx="1.2" /><path d="M6.5 3V13" /></svg>;
}
export function IconPanelRight(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><rect x="2" y="3" width="12" height="10" rx="1.2" /><path d="M9.5 3V13" /></svg>;
}
export function IconPanelBottom(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><rect x="2" y="3" width="12" height="10" rx="1.2" /><path d="M2 9.5H14" /></svg>;
}
export function IconEye(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M1.5 8S4 3.2 8 3.2 14.5 8 14.5 8 12 12.8 8 12.8 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="2" /></svg>;
}
export function IconGear(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><circle cx="8" cy="8" r="2.2" /><path d="M8 2v1.6M8 12.4V14M14 8h-1.6M3.6 8H2M12.1 3.9l-1.1 1.1M5 10l-1.1 1.1M12.1 12.1L11 11M5 6L3.9 4.9" /></svg>;
}
