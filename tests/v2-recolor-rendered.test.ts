// Per-part recolour of textured parts grades from what renders (tint x sprite average), not the tint alone.
// Bug (2026-10-07): Charge-up's spark-streak motes (orange sprite, pale blue tint -> near-white) stayed white-blue
// when Sparks colour was set to pink.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGrade, gradeOf, gradeOfRendered, rgbToHsv } from '../src/graph/recolor.ts';
import { BUILTIN_SPRITES } from '../src/assets/builtinSprites.generated.ts';

const c = (srgb: string) => ({ srgb, alpha: 1 });
const hsv = (srgb: string) => rgbToHsv([1, 3, 5].map(i => parseInt(srgb.slice(i, i + 2), 16) / 255));
const hueDist = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

test('every baked colour sheet (not data textures) records its average colour', () => {
  for (const s of BUILTIN_SPRITES.filter(s => s.kind !== 'texture')) assert.match(s.meanColor ?? '', /^#[0-9A-F]{6}$/, s.id);
});

test('orange streak tinted pale blue, recoloured pink: the grade sets the pink hue for every pixel', () => {
  const streak = BUILTIN_SPRITES.find(s => s.id === 'spark-streak')!.meanColor;
  const g = gradeOfRendered(c('#9FD8FF'), c('#FF4FC8'), streak)!;
  assert.equal(g.setHue, true);
  // A near-white pixel and an orange-ish one both come out pink and clearly coloured.
  for (const px of ['#F0F4F2', '#D8E0B0']) {
    const [h, s] = hsv(applyGrade(c(px), g).srgb);
    assert.ok(hueDist(h, hsv('#FF4FC8')[0]) < 2, `${px} hue ${h}`);
    assert.ok(s > 0.5, `${px} saturation ${s}`);
  }
});

test('no average colour (imported texture) or an unchanged colour keeps the plain grade', () => {
  assert.deepEqual(gradeOfRendered(c('#9FD8FF'), c('#FF4FC8')), gradeOf(c('#9FD8FF'), c('#FF4FC8')));
  assert.equal(gradeOfRendered(c('#9FD8FF'), c('#9FD8FF'), '#FFDDB6'), undefined);
});

test('brightness still follows the swatch, not the darker rendered colour', () => {
  assert.equal(gradeOfRendered(c('#FFFFFF'), c('#808080'), '#202020')!.vGain, gradeOf(c('#FFFFFF'), c('#808080'))!.vGain);
});
