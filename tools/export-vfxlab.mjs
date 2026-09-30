// Re-exports the VFXLab gallery effects (one included component each) to Roblox models + reports.
//   node --experimental-strip-types tools/export-vfxlab.mjs [outDir]   (default F:/Dev2/RobloxGames/VFXLab)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { insertComponent } from '../src/graph/components.ts';
import { robloxEffectFrom } from '../src/export/roblox/fromPlan.ts';
import { writeRbxmx } from '../src/export/roblox/rbxmx.ts';
import { effectPlayerSource } from '../src/export/roblox/playerSource.node.ts';
import { reportMarkdown } from '../src/export/roblox/report.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] ?? 'F:/Dev2/RobloxGames/VFXLab');
const GALLERY = {
  EarthUpheaval: 'earth-upheaval', EnergyBolt: 'energy-bolt', Fireball: 'fireball', Flamethrower: 'flamethrower',
  IceEruption: 'ice-eruption', LightPulse: 'light-pulse', LightningStrike: 'lightning-strike',
  PoisonCaustic: 'poison-caustic', ShadowVortex: 'shadow-vortex', SparkBurst: 'spark-burst',
  WaterStream: 'water-stream', WindGust: 'wind-gust',
};
const idsFile = join(ROOT, 'work', 'roblox', 'asset-ids.json');
const assetIds = existsSync(idsFile) ? JSON.parse(readFileSync(idsFile, 'utf8')) : {};
mkdirSync(join(OUT, 'effects'), { recursive: true });
mkdirSync(join(OUT, 'reports'), { recursive: true });
for (const [name, component] of Object.entries(GALLERY)) {
  const doc = { ...insertComponent(createBlankDocument(`lab-${component}`, name), component, undefined, { group: true }).doc, name };
  const r = robloxEffectFrom(doc);
  if (!r.ok) { console.error(`${name}: ${JSON.stringify(r.errors ?? r)}`); process.exitCode = 1; continue; }
  writeFileSync(join(OUT, 'effects', `${name}.rbxmx`), writeRbxmx(r.value, { assetIds, playerSource: effectPlayerSource() }));
  writeFileSync(join(OUT, 'reports', `${name}.report.md`), reportMarkdown(r.value, assetIds));
  console.log(`${name}: ${r.value.emitters.length} emitters, ${r.value.beams.length} beam layers, ${r.value.lights.length} lights`);
}
