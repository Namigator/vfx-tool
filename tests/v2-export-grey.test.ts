// Actual comparison documents: electric-arc ribbons must carry the shifted sheet hue on a grey texture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { EffectDocumentV2 } from '../src/model/types.ts';
import { compilePathPreview } from '../src/graph/toPaths.ts';
import { multiplyColors } from '../src/graph/toParticles.ts';
import { applyGrade, greyTextured, hueRotate, rgbToHsv } from '../src/graph/recolor.ts';
import { unrealEffectFrom } from '../src/export/unreal/fromPlan.ts';
import { buildUnrealPackage } from '../src/export/unreal/package.ts';
import { godotSceneFrom } from '../src/export/godot/scene.ts';
import { robloxEffectFrom } from '../src/export/roblox/fromPlan.ts';
import { writeRbxmx } from '../src/export/roblox/rbxmx.ts';

const hue = (rgb: readonly number[]) => rgbToHsv(rgb)[0];
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const distance = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

for (const name of ['ab07-arcane-helix', 'ab08-arcane-arc']) {
  test(`${name}: Unreal, Godot and Roblox serialize grey electric-arc ribbons with pink tint`, () => {
    const doc = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as EffectDocumentV2;
    const preview = compilePathPreview(doc, 60, { audioHandled: true });
    assert.ok(preview.ok);
    const textured = preview.value.layers.filter(l => l.sprite?.sheet.id === 'electric-arc');
    assert.ok(textured.length, 'the comparison document takes the textured RibbonRenderer path');
    const ue = unrealEffectFrom(doc), rb = robloxEffectFrom(doc);
    assert.ok(ue.ok);
    assert.ok(rb.ok);
    const gd = godotSceneFrom(ue.value);
    const data = JSON.parse(gd.files.find(f => f.path === 'ribbons.json')!.text) as {
      layers: { name: string; texture?: string; color: number[] }[];
    };
    const file = 'electric-arc.grey.png', key = `${file}#line`;
    assert.ok(ue.value.textures.includes(file), 'Godot compare copier receives the grey filename');
    assert.ok(gd.textures.includes(file));
    assert.ok(rb.value.textures.includes(key));
    const bytes = new Uint8Array(readFileSync(new URL(`../assets/sprites/${file}`, import.meta.url)));
    const pkg = buildUnrealPackage(ue.value, new Map([[file, bytes]]));
    assert.ok(pkg.some(f => f.path === `Textures/${file}` && f.bytes === bytes));
    const written = JSON.parse(pkg.find(f => f.path === 'effect.json')!.bytes as string) as typeof ue.value;
    for (const l of textured) {
      const grey = greyTextured(l.sprite!.sheet, l.grade, l.hueShift)!;
      const want = hue(rgb(hueRotate(applyGrade(multiplyColors(l.color, grey.hue), l.grade), l.hueShift).srgb));
      assert.ok(distance(want, 310) < 40, `comparison colour is pink/purple: ${want}`);
      const id = l.nodeId.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 60);
      const ribbon = written.ribbons.find(b => b.name === id)!;
      const beam: (typeof rb.value.beams)[number] = rb.value.beams.find(b => b.name === id)!;
      const godot = data.layers.find(b => b.name === id)!;
      assert.equal(ribbon.textureFile, file);
      assert.equal(beam.textureKey, key);
      assert.ok(godot.texture?.endsWith(`/${file}`));
      for (const color of [[ribbon.color.r, ribbon.color.g, ribbon.color.b], beam.color, godot.color.slice(0, 3)]) {
        assert.ok(distance(hue(color), want) < 30, `exported hue ${hue(color)} vs editor colour ${want}`);
      }
    }
    const xml = writeRbxmx(rb.value, { assetIds: { [key]: '12345' }, playerSource: '' });
    assert.match(xml, /rbxassetid:\/\/12345/, 'Roblox writer resolves the grey straightened texture');
  });
}
