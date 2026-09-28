import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES } from '../src/core/types.ts';
import { createRecipe, PARAM_SPECS, visibleSpecs, validateRecipe } from '../src/core/recipe.ts';
import { convertLegacyRecipe, formatMigrationReport } from '../src/model/migrate.ts';
import { validateDocument } from '../src/model/document.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';
import { compilePathPreview } from '../src/graph/toPaths.ts';

const registry = createRegistry();
/** Recipe variants: family default, and every visible parameter at its minimum, then its maximum. */
function variants(family: typeof FAMILIES[number]) {
  const base = createRecipe(family), out = [base];
  for (const end of ['min', 'max'] as const) {
    const r = structuredClone(base);
    for (const s of visibleSpecs(family)) (r.parameters as unknown as Record<string, number>)[s.key] = s[end];
    out.push(validateRecipe(r));
  }
  return out;
}

test('T33: every v1 family converts at default and boundary settings to a valid, compiling graph; the original is untouched', () => {
  for (const family of FAMILIES) {
    for (const recipe of variants(family)) {
      const before = JSON.stringify(recipe);
      const { doc, report } = convertLegacyRecipe(recipe);
      assert.equal(JSON.stringify(recipe), before, `${family}: original mutated`);
      const v = validateDocument(doc, { registry });
      if (!v.ok) assert.fail(`${family}: ${JSON.stringify(v.errors.slice(0, 2))}`);
      const p = compileParticlePreview(doc, { ribbonsHandled: true, audioHandled: true });
      if (!p.ok) assert.fail(`${family} particles: ${JSON.stringify(p.errors.slice(0, 2))}`);
      const paths = compilePathPreview(doc, 30, { audioHandled: true });
      if (!paths.ok) assert.fail(`${family} paths: ${JSON.stringify(paths.errors.slice(0, 2))}`);
      assert.match(doc.name, / — graph copy$/);
      assert.equal(doc.seed, recipe.seed);
      assert.deepEqual(doc.anchors.find(a => a.id === 'source')!.position, recipe.source);
      assert.ok(doc.tags.includes('migrated-from-v1'));
      // Every v1 parameter appears in the report (mapped, clamped, kept or explicitly unused).
      for (const s of PARAM_SPECS) assert.ok(report.lines.some(l => l.field === s.key || l.field.includes(s.key)), `${family}: ${s.key} missing from report`);
      assert.ok(formatMigrationReport(report).includes(report.component));
    }
  }
});

test('conversion scales knobs relative to the family defaults', () => {
  const r = createRecipe('light');
  r.parameters.count = 24; // half of the default 48
  const { doc, report } = convertLegacyRecipe(r);
  const rays = doc.controls.find(c => c.label === 'Ray count')!;
  assert.equal(rays.value, 16); // 32 × 24/48
  assert.equal(report.lines.find(l => l.field === 'count')!.status, 'mapped');
});
