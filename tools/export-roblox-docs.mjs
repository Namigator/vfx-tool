// Exports saved effect documents (.vfx.json / MCP mirrors) to Roblox models + reports with the CURRENT EffectPlayer
// (the MCP server caches the player script until it restarts).
//   node --experimental-strip-types tools/export-roblox-docs.mjs <outDir> <doc.json> [Name=doc.json ...]
// An argument "Name=path" names the output Name.rbxmx; a plain path uses the document name without spaces.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { robloxEffectFrom } from '../src/export/roblox/fromPlan.ts';
import { writeRbxmx } from '../src/export/roblox/rbxmx.ts';
import { effectPlayerSource } from '../src/export/roblox/playerSource.node.ts';
import { reportMarkdown } from '../src/export/roblox/report.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [out, ...docs] = process.argv.slice(2);
if (!out || !docs.length) { console.error('usage: export-roblox-docs.mjs <outDir> <doc.json|Name=doc.json> ...'); process.exit(2); }
const idsFile = join(ROOT, 'work', 'roblox', 'asset-ids.json');
const assetIds = existsSync(idsFile) ? JSON.parse(readFileSync(idsFile, 'utf8')) : {};
mkdirSync(out, { recursive: true });
for (const arg of docs) {
  const [named, path] = arg.includes('=') ? arg.split('=') : [undefined, arg];
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const name = named ?? String(doc.name ?? 'Effect').replace(/[^A-Za-z0-9]/g, '');
  const r = robloxEffectFrom(doc);
  if (!r.ok) { console.error(`${name}: ${r.message}`); process.exitCode = 1; continue; }
  writeFileSync(join(out, `${name}.rbxmx`), writeRbxmx(r.value, { assetIds, playerSource: effectPlayerSource() }));
  writeFileSync(join(out, `${name}.report.md`), reportMarkdown(r.value, assetIds));
  console.log(`${name}: ${r.value.emitters.length} emitters, ${r.value.beams.length} beam layers, ${r.value.lights.length} lights`);
}
