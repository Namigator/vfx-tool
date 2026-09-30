// Colour pickers for components (user 2026-09-29: "why not as a colour picker?").
// - Whole-component Colour: the existing hue-rotate Colour shift, shown as a picker; hueShiftToward finds the rotation
//   that turns the component's representative colour (its swatch) toward the picked one, so fire keeps its hot core.
// - Per-part colour (Material/PointLight recolorFrom → recolorTo): an HSV grade that maps the part's swatch exactly
//   onto the picked colour (hue, saturation and brightness), so grey smoke can become green. The preview shaders apply
//   the same grade (vfxGrade) to textured colours; meshes and lights are graded at compile time.
import type { ColorValue, GradientValue } from '../model/types.ts';

/** hue: degrees (relative rotation, or the absolute hue when setHue); s' = s·sGain + sAdd; v' = v·vGain. */
export type ColorGrade = { hue: number; setHue: boolean; sGain: number; sAdd: number; vGain: number };

const rgbOf = (c: ColorValue): [number, number, number] => [0, 1, 2].map(i => parseInt(c.srgb.slice(1 + 2 * i, 3 + 2 * i), 16) / 255) as [number, number, number];
const hexOf = (rgb: readonly number[]) => `#${rgb.map(x => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).toUpperCase().padStart(2, '0')).join('')}`;

/** h in degrees [0, 360), s and v in [0, 1] (v may exceed 1 for over-bright input). */
export function rgbToHsv([r, g, b]: readonly number[]): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, max > 0 ? d / max : 0, max];
}
export function hsvToRgb([h, s, v]: readonly number[]): [number, number, number] {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}

/** Below this saturation a swatch has no meaningful hue: the grade sets the hue and adds saturation instead. */
const GREY = 0.12;

/** The grade mapping `from` onto `to`; undefined when off (from.alpha 0) or identical. */
export function gradeOf(from: ColorValue, to: ColorValue): ColorGrade | undefined {
  if (from.alpha === 0 || from.srgb.toUpperCase() === to.srgb.toUpperCase()) return undefined;
  const [hf, sf, vf] = rgbToHsv(rgbOf(from)), [ht, st, vt] = rgbToHsv(rgbOf(to));
  const grey = sf < GREY;
  return {
    hue: grey ? ht : (((ht - hf) % 360) + 540) % 360 - 180, setHue: grey,
    sGain: grey ? 1 : st / sf, sAdd: grey ? st - sf : 0, vGain: vf > 0.02 ? vt / vf : 1,
  };
}

export function applyGrade(c: ColorValue, g: ColorGrade | undefined): ColorValue {
  if (!g) return c;
  const [h, s, v] = rgbToHsv(rgbOf(c));
  const hue = g.setHue ? g.hue : (h + g.hue + 360) % 360;
  return { srgb: hexOf(hsvToRgb([hue, Math.min(1, Math.max(0, s * g.sGain + g.sAdd)), v * g.vGain])), alpha: c.alpha };
}
export const gradeGradient = (gr: GradientValue, g: ColorGrade | undefined): GradientValue =>
  (g ? { ...gr, stops: gr.stops.map(s => ({ ...s, color: applyGrade(s.color, g) })) } : gr);

/**
 * Colour shift (Material/PointLight hueShift): the CSS hue-rotate matrix on sRGB values, luminance-preserving and
 * clamped; the preview shaders apply the same matrix (vfxHue) so textured colours shift identically.
 */
export function hueRotate(c: ColorValue, degrees: number): ColorValue {
  if (!degrees) return c;
  const r = degrees * Math.PI / 180, a = Math.cos(r), b = Math.sin(r);
  const v = rgbOf(c);
  const m = [[0.213 + 0.787 * a - 0.213 * b, 0.715 - 0.715 * a - 0.715 * b, 0.072 - 0.072 * a + 0.928 * b],
    [0.213 - 0.213 * a + 0.143 * b, 0.715 + 0.285 * a + 0.140 * b, 0.072 - 0.072 * a - 0.283 * b],
    [0.213 - 0.213 * a - 0.787 * b, 0.715 - 0.715 * a + 0.715 * b, 0.072 + 0.928 * a + 0.072 * b]];
  return { srgb: hexOf(m.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2])), alpha: c.alpha };
}

const hueDistance = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** The whole-degree Colour shift in [-180, 180] that turns `swatch` closest in hue to `picked` (0 for a grey pick). */
export function hueShiftToward(swatch: ColorValue, picked: ColorValue): number {
  const target = rgbToHsv(rgbOf(picked));
  if (target[1] < 0.05) return 0;
  let best = 0, bestD = Infinity;
  for (let d = -180; d <= 180; d++) {
    const dist = hueDistance(rgbToHsv(rgbOf(hueRotate(swatch, d)))[0], target[0]);
    if (dist < bestD - 1e-9) { best = d; bestD = dist; }
  }
  return best;
}

/** Colourfulness used to choose a representative swatch: saturation weighted by brightness. */
export const chroma = (c: ColorValue): number => { const [, s, v] = rgbToHsv(rgbOf(c)); return s * v; };
