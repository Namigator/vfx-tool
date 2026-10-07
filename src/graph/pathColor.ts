// PathFollower "Colour by path" (user 2026-10-07: give each path of a merged / radial set its own colour and control it
// by index). Pure helpers shared by the compiler and the exporters: the colour of path k of n, and how far the riders
// have turned from their own colour to it at a tick.
import type { ColorValue, GradientValue } from '../model/types.ts';
import { hsvToRgb } from './recolor.ts';

export type PathColorMode = 'off' | 'rainbow' | 'gradient';

/** Per-rider path tint: colour per path (track index), the tick each path departs, and the fade-in length (0 = at once). */
export type PathTint = { colors: ColorValue[]; from: number[]; ticks: number };

const hexOf = (rgb: readonly number[]) => `#${rgb.map(x => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).toUpperCase().padStart(2, '0')).join('')}`;
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const enc = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
/** Linear RGB of an sRGB colour. */
export function linearOf(c: ColorValue): [number, number, number] {
  return [0, 1, 2].map(i => lin(parseInt(c.srgb.slice(1 + 2 * i, 3 + 2 * i), 16) / 255)) as [number, number, number];
}

/** Gradient colour at t (0..1), interpolated in linear RGB like the preview's colour-over-life. */
export function gradientAt(g: GradientValue, t: number): ColorValue {
  const s = g.stops;
  if (!s.length) return { srgb: '#FFFFFF', alpha: 1 };
  if (t <= s[0].position) return { ...s[0].color };
  if (t >= s[s.length - 1].position) return { ...s[s.length - 1].color };
  let i = 1;
  while (s[i].position <= t) i++;
  const a = s[i - 1], b = s[i], f = (t - a.position) / Math.max(1e-9, b.position - a.position);
  const la = linearOf(a.color), lb = linearOf(b.color);
  return { srgb: hexOf(la.map((x, k) => enc(x + (lb[k] - x) * f))), alpha: a.color.alpha + (b.color.alpha - a.color.alpha) * f };
}

/** Colour of each of `n` paths; undefined when off. Rainbow spreads hues evenly (path 0 = red-pink side start). */
export function pathColors(mode: PathColorMode, gradient: GradientValue, n: number): ColorValue[] | undefined {
  if (mode === 'off' || n < 1) return undefined;
  return Array.from({ length: n }, (_, k) => mode === 'rainbow'
    ? { srgb: hexOf(hsvToRgb([(190 + (360 * k) / n) % 360, 0.8, 1])), alpha: 1 }
    : gradientAt(gradient, n > 1 ? k / (n - 1) : 0));
}

/** How much of path `track`'s colour shows at `tick` (0 = the rider's own colour, 1 = the path colour). */
export function pathTintAmount(t: PathTint, track: number, tick: number): number {
  if (t.ticks <= 0) return 1;
  const from = t.from[Math.min(track, t.from.length - 1)] ?? 0;
  return Math.min(1, Math.max(0, (tick - from) / t.ticks));
}

/** The colour a rider of path `track` shows at `tick`: its own colour blended toward the path colour (linear RGB). */
export function tintedColor(own: ColorValue, t: PathTint, track: number, tick: number): ColorValue {
  const k = pathTintAmount(t, track, tick);
  const target = t.colors[Math.min(track, t.colors.length - 1)];
  if (!target || k <= 0) return own;
  if (k >= 1) return { srgb: target.srgb, alpha: own.alpha };
  const a = linearOf(own), b = linearOf(target);
  return { srgb: hexOf(a.map((x, i) => enc(x + (b[i] - x) * k))), alpha: own.alpha };
}

/**
 * Exporters (Roblox / Unreal / Godot) have no per-path or over-window colour: each path's emitter, trail or light gets
 * the colour it settles on - `own` × the end of its colour over window, then its path colour when Colour by path is on.
 */
export function settledColor(own: ColorValue, tint?: PathTint, track = 0, cow?: GradientValue): ColorValue {
  let c = own;
  if (cow?.stops.length) {
    const end = cow.stops[cow.stops.length - 1].color, a = linearOf(c), b = linearOf(end);
    c = { srgb: hexOf(a.map((x, i) => enc(x * b[i]))), alpha: c.alpha * end.alpha };
  }
  const target = tint?.colors[Math.min(track, tint.colors.length - 1)];
  return target ? { srgb: target.srgb, alpha: c.alpha } : c;
}
