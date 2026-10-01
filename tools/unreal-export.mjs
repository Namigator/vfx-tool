#!/usr/bin/env node
// Writes an Unreal export package for an included component (no MCP server needed):
//   node --experimental-strip-types tools/unreal-export.mjs <component-id> [outDir=work/unreal/<component-id>]
// Then: node tools/unreal-check.mjs <outDir>
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { insertComponent } from '../src/graph/components.ts';
import { unrealEffectFrom } from '../src/export/unreal/fromPlan.ts';
import { buildUnrealPackage } from '../src/export/unreal/package.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
if (!id) { console.error('usage: node --experimental-strip-types tools/unreal-export.mjs <component-id> [outDir]'); process.exit(2); }
const out = resolve(process.argv[3] ?? join(ROOT, 'work', 'unreal', id));
const doc = { ...insertComponent(createBlankDocument(`unreal-${id}`, id), id, undefined, { group: true }).doc, name: id };
const r = unrealEffectFrom(doc);
if (!r.ok) { console.error(r.message); process.exit(1); }
const bytes = new Map(r.value.textures.map(t => [t, readFileSync(join(ROOT, 'assets', 'sprites', t))]));
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'Textures'), { recursive: true });
for (const f of buildUnrealPackage(r.value, bytes)) writeFileSync(join(out, f.path), f.bytes);
console.log(`${out}: ${r.value.emitters.length} emitters, ${r.value.ribbons.length} ribbon layers, ${r.value.lights.length} lights`);
