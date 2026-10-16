// Recoloured coloured sheets export as grey variants with the hue in the colour (recolor.ts greyTextured).
// Bug (2026-10-15 side-by-side): Arcane Helix's electric-arc strands (blue sheet, colour-shifted pink in the editor)
// stayed blue in Godot and Roblox, because engines multiply texture x colour and the editor shifts/grades the product.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { gradeOf, greyTextured, hueRotate, rgbToHsv } from '../src/graph/recolor.ts';
import { multiplyColors } from '../src/graph/toParticles.ts';
import { BUILTIN_SPRITES } from '../src/assets/builtinSprites.generated.ts';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { unrealEffectFrom } from '../src/export/unreal/fromPlan.ts';
import { robloxEffectFrom } from '../src/export/roblox/fromPlan.ts';

const c = (srgb: string) => ({ srgb, alpha: 1 });
const rgb = (srgb: string) => [1, 3, 5].map(i => parseInt(srgb.slice(i, i + 2), 16) / 255);
const hueDist = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const sheet = (id: string) => BUILTIN_SPRITES.find(s => s.id === id)!;

/** RGBA8 PNG written by tools/bake-sprites.mjs (filter 0 on every row). */
function decode(file: string): { w: number; h: number; px: Uint8Array } {
  const b = readFileSync(file);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), idat: Buffer[] = [];
  for (let o = 8; o < b.length;) { const len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8); if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat)), px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) { assert.equal(raw[y * (w * 4 + 1)], 0, 'filter 0'); px.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4); }
  return { w, h, px };
}

test('coloured sheets (not grey ones) ship a grey variant: max channel per texel, alpha kept', () => {
  for (const s of BUILTIN_SPRITES.filter(s => s.kind !== 'texture')) {
    const [h, sat] = rgbToHsv(rgb(s.meanColor!)); void h;
    assert.equal(!!s.greyFile, sat >= 0.12, `${s.id} saturation ${sat.toFixed(3)}`);
  }
  for (const s of BUILTIN_SPRITES.filter(s => s.greyFile)) {
    assert.ok(existsSync(`assets/sprites/${s.greyFile}`), s.id);
    const a = decode(`assets/sprites/${s.file}`), g = decode(`assets/sprites/${s.greyFile}`);
    assert.deepEqual([g.w, g.h], [a.w, a.h]);
    for (let o = 0; o < a.px.length; o += 4 * 97) {
      assert.equal(g.px[o + 3], a.px[o + 3], 'alpha');
      if (!a.px[o + 3]) continue;
      const m = Math.max(a.px[o], a.px[o + 1], a.px[o + 2]);
      assert.deepEqual([g.px[o], g.px[o + 1], g.px[o + 2]], [m, m, m], `${s.id} texel ${o / 4}`);
    }
  }
});

test('greyTextured: only for a graded or shifted part on a sheet with a grey variant', () => {
  const arc = sheet('electric-arc');
  assert.equal(greyTextured(arc, undefined, undefined), undefined);
  assert.equal(greyTextured(arc, undefined, 0), undefined);
  assert.equal(greyTextured(sheet('smoke-puff'), undefined, 90), undefined, 'grey sheet');
  const g = greyTextured(arc, undefined, 90)!;
  assert.equal(g.file, 'electric-arc.grey.png');
  // The sheet's own hue at full brightness.
  const [hh, , hv] = rgbToHsv(rgb(g.hue.srgb)), [mh] = rgbToHsv(rgb(arc.meanColor!));
  assert.ok(hueDist(hh, mh) < 3, `hue ${hh} vs ${mh}`);
  assert.ok(hv > 0.99, `full brightness ${hv}`);
});

// The preview shaders' post-texture colour ops (PreviewViewport.ts vfxGrade / vfxHue): HSV grade on pow(1/2.2)
// values, hue matrix on linear values. Both commute with brightness, which is what the grey split relies on.
function shaderPost(lin: number[], g: { hue: number; setHue: boolean; sGain: number; sAdd: number; vGain: number }, hueDeg: number): number[] {
  const [h, s, v] = rgbToHsv(lin.map(x => Math.max(0, x) ** (1 / 2.2)));
  const hue = g.setHue ? g.hue : (h + g.hue + 360) % 360;
  const k = (n: number) => (n + hue / 60) % 6, ss = Math.min(1, Math.max(0, s * g.sGain + g.sAdd)), vv = v * g.vGain;
  const graded = [5, 3, 1].map(n => (vv - vv * ss * Math.max(0, Math.min(k(n), 4 - k(n), 1))) ** 2.2);
  const r = hueDeg * Math.PI / 180, a = Math.cos(r), b = Math.sin(r);
  const m = [[0.213 + 0.787 * a - 0.213 * b, 0.715 - 0.715 * a - 0.715 * b, 0.072 - 0.072 * a + 0.928 * b],
    [0.213 - 0.213 * a + 0.143 * b, 0.715 + 0.285 * a + 0.140 * b, 0.072 - 0.072 * a - 0.283 * b],
    [0.213 - 0.213 * a - 0.787 * b, 0.715 - 0.715 * a + 0.715 * b, 0.072 + 0.928 * a + 0.072 * b]];
  return m.map(row => Math.max(0, row[0] * graded[0] + row[1] * graded[1] + row[2] * graded[2]));
}

test('grey x post(colour x sheet hue) = post(colour x texel) for texels of the sheet hue (preview shader maths)', () => {
  const arc = sheet('electric-arc');
  const grade = gradeOf(c('#B8E2FF'), c('#FF4FC8'))!;
  const g = greyTextured(arc, grade, 20)!;
  const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  const tint = rgb('#B8E2FF').map(lin), hue = rgb(g.hue.srgb).map(lin);
  for (const k of [1, 0.5, 0.2, 0.05]) {
    // A texel of the sheet's hue at brightness k (linear): t = hue x k, and its grey value is k.
    const editor = shaderPost(tint.map((x, i) => x * hue[i] * k), grade, 20);
    const engine = shaderPost(tint.map((x, i) => x * hue[i]), grade, 20).map(x => x * k);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(editor[i] - engine[i]) < 1e-6, `k ${k} channel ${i}: ${editor[i]} vs ${engine[i]}`);
  }
});

/** The helix-beam component (electric-arc strands) with its Colour knob (bound to every material's hueShift) at `shift`. */
function arcEffect(shift: number) {
  const d = { ...insertComponent(createBlankDocument('g-helix', 'helix-beam'), 'helix-beam', undefined, { group: true }).doc, name: 'helix' };
  const knob = d.controls.find(k => k.id.endsWith('colour-shift'));
  assert.ok(knob, 'helix-beam has a Colour knob');
  knob.value = shift;
  return d;
}

test('IR: a colour-shifted electric-arc beam ships the grey sheet and a colour of the shifted sheet hue', () => {
  const plain = unrealEffectFrom(arcEffect(0));
  assert.ok(plain.ok);
  const beam0 = plain.value.ribbons.find(b => b.textureFile?.startsWith('electric-arc'))!;
  assert.equal(beam0.textureFile, 'electric-arc.png', 'unshifted: the coloured sheet as before');

  const r = unrealEffectFrom(arcEffect(120));
  assert.ok(r.ok);
  const beam = r.value.ribbons.find(b => b.textureFile?.startsWith('electric-arc'))!;
  assert.equal(beam.textureFile, 'electric-arc.grey.png');
  assert.ok(r.value.textures.includes('electric-arc.grey.png'));
  assert.ok(r.value.report.some(x => x.message.startsWith('Recoloured texture: electric-arc.png')));
  // Editor: shift(tint x blue sheet) -> the sheet's blue turned by 120 degrees; the exported colour carries that hue.
  const want = rgbToHsv(rgb(hueRotate(multiplyColors(c('#6FD8FF'), greyTextured(sheet('electric-arc'), undefined, 120)!.hue), 120).srgb))[0];
  const got = rgbToHsv([beam.color.r, beam.color.g, beam.color.b])[0];
  assert.ok(hueDist(got, want) < 6, `exported hue ${got} vs ${want}`);

  const rb = robloxEffectFrom(arcEffect(120));
  assert.ok(rb.ok);
  assert.ok(rb.value.beams.some(b => b.textureKey === 'electric-arc.grey.png'), 'Roblox beam uses the grey sheet');
  assert.ok(rb.value.textures.includes('electric-arc.grey.png'));
});
