#!/usr/bin/env node
// Writes a Unity export package (effect.unity.json + Textures/) for an included component or a saved effect document,
// through the same IR -> Unreal -> Unity path as the editor's Unity export (no MCP server needed):
//   node --experimental-strip-types tools/unity-export.mjs <component-id | doc.json> <outDir>
// Then: node tools/unity-check.mjs <outDir> [ticks] ...
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { insertComponent } from '../src/graph/components.ts';
import { unrealEffectFrom } from '../src/export/unreal/fromPlan.ts';
import { unityEffectFrom, unityReadme, unityReportMarkdown } from '../src/export/unity/fromUnreal.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
if (!id) { console.error('usage: node --experimental-strip-types tools/unity-export.mjs <component-id | doc.json> [outDir]'); process.exit(2); }
const out = resolve(process.argv[3] ?? join(ROOT, 'work', 'unity', id));
const doc = id.endsWith('.json') ? JSON.parse(readFileSync(id, 'utf8')) : { ...insertComponent(createBlankDocument(`unity-${id}`, id), id, undefined, { group: true }).doc, name: id };
const r = unrealEffectFrom(doc);
if (!r.ok) { console.error(r.message); process.exit(1); }
const { effect, report, files } = unityEffectFrom(r.value);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'Textures'), { recursive: true });
writeFileSync(join(out, 'effect.unity.json'), JSON.stringify(effect));
writeFileSync(join(out, 'README.md'), unityReadme(effect.name));
writeFileSync(join(out, 'report.md'), unityReportMarkdown(effect.name, report));
for (const t of effect.textures) copyFileSync(join(ROOT, 'assets', 'sprites', t), join(out, 'Textures', t));
for (const f of files) { mkdirSync(dirname(join(out, f.path)), { recursive: true }); writeFileSync(join(out, f.path), f.text); }
console.log(`${out}: ${effect.emitters.length} emitters, ${effect.ribbons.length} ribbons, ${effect.lights.length} lights`);
