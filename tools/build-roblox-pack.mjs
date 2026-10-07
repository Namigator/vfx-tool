// Builds ONE Roblox model holding a whole effect pack: a README script plus one folder per colourway, each with every
// effect as its own playable model (EffectPlayer + Demo + VfxColor/VfxHueShift settings).
//
//   node --experimental-strip-types tools/build-roblox-pack.mjs --name "Arcane Bloom" --out pack.rbxmx \
//     [--readme README.md] [--colourways "Pink:0,Blue:-105:#3C8CFF,Green:175:#3CFF8C"] Name=doc.json [Name~=doc.json ...]
//
// A colourway "Name:hueShift[:#colour]" bakes the colour into every copy as VfxColor (each coloured part takes that
// hue, whatever its authored hue) - or, for effects passed as "Name~=doc.json" (multicoloured ones that should keep their
// variety) and colourways without a colour, VfxHueShift (degrees). Buyers can still change either in Studio Properties.
// Without --colourways the effects sit directly in the pack model (no folders).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { robloxEffectFrom } from '../src/export/roblox/fromPlan.ts';
import { writeRbxmx } from '../src/export/roblox/rbxmx.ts';
import { effectPlayerSource } from '../src/export/roblox/playerSource.node.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(`--${n}`); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const name = opt('name') ?? 'Effect Pack', out = opt('out'), readme = opt('readme'), colourways = opt('colourways');
if (!out || !args.length) { console.error('usage: build-roblox-pack.mjs --name <name> --out <file.rbxmx> [--readme md] [--colourways "Pink:0,Blue:-105"] Name=doc.json ...'); process.exit(2); }
const idsFile = join(ROOT, 'work', 'roblox', 'asset-ids.json');
const assetIds = existsSync(idsFile) ? JSON.parse(readFileSync(idsFile, 'utf8')) : {};
const player = effectPlayerSource();

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let refN = 0;
const ref = () => 'RBX' + (++refN).toString(16).toUpperCase().padStart(32, '0');
/** The model Item of a single-effect rbxmx with its referents renumbered so many can share one file. */
function inner(xml) {
  const body = xml.slice(xml.indexOf('<Item '), xml.lastIndexOf('</roblox>'));
  const map = new Map();
  return body.replace(/referent="(RBX[0-9A-F]+)"/g, (_, r) => { const n = ref(); map.set(r, n); return `referent="${n}"`; })
    .replace(/(<Ref name="[^"]*">)(RBX[0-9A-F]+)(<\/Ref>)/g, (_, a, r, b) => `${a}${map.get(r) ?? r}${b}`);
}
const effects = args.map(a => { const [n, p] = a.split('='); return { name: n.replace(/~$/, ''), shiftOnly: n.endsWith('~'), doc: JSON.parse(readFileSync(p, 'utf8')) }; });
const exported = effects.map(e => { const r = robloxEffectFrom(e.doc); if (!r.ok) throw new Error(`${e.name}: ${r.message}`); return { ...e, effect: { ...r.value, name: e.name } }; });
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const ways = colourways ? colourways.split(',').map(s => { const [n, h, c] = s.split(':'); return { name: n.trim(), hue: Number(h), color: c ? rgb(c.trim()) : undefined }; }) : [{ name: '', hue: 0 }];

const folder = (n, kids) => `<Item class="Folder" referent="${ref()}"><Properties><string name="Name">${esc(n)}</string></Properties>${kids.join('')}</Item>`;
const groups = ways.map(w => {
  const models = exported.map(e => inner(writeRbxmx(e.effect, { assetIds, playerSource: player, ...(w.color && !e.shiftOnly ? { color: w.color } : { hueShift: w.hue }) })));
  return w.name ? folder(w.name, models) : models.join('');
});
const readmeText = readme ? readFileSync(readme, 'utf8') : `${name}\n`;
const readmeItem = `<Item class="Script" referent="${ref()}"><Properties><string name="Name">README</string><bool name="Disabled">true</bool><ProtectedString name="Source"><![CDATA[--[==[\n${readmeText.replace(/\]==\]/g, '] ==]')}\n]==]\n]]></ProtectedString></Properties></Item>`;
const pack = `<Item class="Model" referent="${ref()}"><Properties><string name="Name">${esc(name)}</string></Properties>${readmeItem}${groups.join('')}</Item>`;
const xml = `<?xml version="1.0" encoding="utf-8"?>\n<roblox version="4">${pack}</roblox>\n`;
writeFileSync(out, xml);
console.log(`${out}: ${exported.length} effects x ${ways.length} colourway(s), ${(xml.length / 1048576).toFixed(2)} MB`);
