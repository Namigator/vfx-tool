#!/usr/bin/env node
// Writes a Godot export package for an included component (no MCP server needed):
//   node --experimental-strip-types tools/godot-export.mjs <component-id> [outDir=work/godot/<component-id>]
// Then: node tools/godot-check.mjs <outDir> [seconds]
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { insertComponent } from '../src/graph/components.ts';
import { unrealEffectFrom } from '../src/export/unreal/fromPlan.ts';
import { godotReadme, godotReportMarkdown, godotSceneFrom } from '../src/export/godot/scene.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
if (!id) { console.error('usage: node --experimental-strip-types tools/godot-export.mjs <component-id> [outDir]'); process.exit(2); }
const out = resolve(process.argv[3] ?? join(ROOT, 'work', 'godot', id));
const doc = { ...insertComponent(createBlankDocument(`godot-${id}`, id), id, undefined, { group: true }).doc, name: id };
const r = unrealEffectFrom(doc);
if (!r.ok) { console.error(r.message); process.exit(1); }
const g = godotSceneFrom(r.value);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'Textures'), { recursive: true });
writeFileSync(join(out, `${g.name}.tscn`), g.tscn);
writeFileSync(join(out, 'README.md'), godotReadme(g));
writeFileSync(join(out, 'report.md'), godotReportMarkdown(g));
for (const f of g.files) writeFileSync(join(out, f.path), f.text);
for (const t of g.textures) copyFileSync(join(ROOT, 'assets', 'sprites', t), join(out, 'Textures', t));
console.log(`${out}: ${g.name}.tscn, ${r.value.emitters.length} emitters, ${r.value.ribbons.length} ribbon layers, ${r.value.lights.length} lights, ${g.files.length} extra file(s)`);
