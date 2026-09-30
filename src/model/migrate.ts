// Legacy v1 -> v2 conversion (14-MIGRATION "Convert to editable graph"): an explicit action that builds a NEW v2
// document from a v1 recipe and never touches the original. The family's primary component is inserted as a
// Group; v1 parameters map onto its knobs relative to the family defaults (newValue = newDefault × old/oldDefault,
// rounded for integer knobs, clamped to the knob range with a note). Everything else is listed in the report.
import type { Recipe, Family, Parameters } from '../core/types.ts';
import { createRecipe } from '../core/recipe.ts';
import { createBlankDocument } from '../graph/fixtures.ts';
import { insertComponent } from '../graph/components.ts';
import { MAX_DURATION_TICKS, type EffectDocumentV2 } from './types.ts';

type Mapping = { from: keyof Parameters; knob: string; mode?: 'ratio' | 'inverse' | 'direct' };
/** Primary component and parameter → knob mapping per family (14-MIGRATION table, onto today's components). */
const FAMILY_MAP: Record<Family, { component: string; map: Mapping[]; colorKnob?: string }> = {
  lightning: { component: 'lightning-strike', map: [{ from: 'count', knob: 'impact' }, { from: 'branches', knob: 'branches', mode: 'direct' }, { from: 'width', knob: 'core' }, { from: 'turbulence', knob: 'jagged' }, { from: 'spread', knob: 'ripple' }] },
  fire: { component: 'flamethrower', map: [{ from: 'count', knob: 'density' }, { from: 'speed', knob: 'length' }, { from: 'spread', knob: 'width' }] },
  ice: { component: 'ice-eruption', map: [{ from: 'count', knob: 'count' }, { from: 'spread', knob: 'spread' }] },
  water: { component: 'water-stream', map: [{ from: 'width', knob: 'width' }, { from: 'count', knob: 'droplets' }, { from: 'spread', knob: 'splash' }] },
  wind: { component: 'wind-gust', map: [{ from: 'count', knob: 'streaks' }, { from: 'spread', knob: 'width' }, { from: 'speed', knob: 'speed' }] },
  earth: { component: 'earth-upheaval', map: [{ from: 'count', knob: 'stones' }, { from: 'spread', knob: 'spread' }, { from: 'speed', knob: 'force' }] },
  light: { component: 'light-pulse', map: [{ from: 'count', knob: 'rays' }, { from: 'spread', knob: 'length' }, { from: 'intensity', knob: 'light' }] },
  shadow: { component: 'shadow-collapse', map: [{ from: 'count', knob: 'density' }, { from: 'spread', knob: 'radius' }, { from: 'speed', knob: 'inward' }] },
  poison: { component: 'poison-caustic', map: [{ from: 'count', knob: 'density' }, { from: 'spread', knob: 'radius' }, { from: 'speed', knob: 'rise' }, { from: 'turbulence', knob: 'drift' }] },
  energy: { component: 'energy-bolt', map: [{ from: 'count', knob: 'impact' }, { from: 'width', knob: 'width' }, { from: 'speed', knob: 'travel', mode: 'inverse' }, { from: 'spread', knob: 'bend' }], colorKnob: 'accent' },
};

export type MigrationLine = { field: string; old: unknown; status: 'mapped' | 'clamped' | 'kept' | 'unused'; target?: string; value?: unknown; note?: string };
export type MigrationReport = { family: Family; component: string; lines: MigrationLine[]; recipeHash: string };

/** FNV-1a of the canonical recipe JSON: provenance of which original was converted. */
function hashRecipe(r: Recipe): string {
  const text = JSON.stringify(r); let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function convertLegacyRecipe(recipe: Recipe): { doc: EffectDocumentV2; report: MigrationReport } {
  const fam = FAMILY_MAP[recipe.family];
  const defaults = createRecipe(recipe.family).parameters;
  const lines: MigrationLine[] = [];
  let doc = createBlankDocument(`${recipe.id}-graph`.replace(/[^A-Za-z0-9_-]/g, '-'), `${recipe.name} — graph copy`);
  doc.seed = recipe.seed;
  doc.anchors = doc.anchors.map(a => a.id === 'source' ? { ...a, position: [...recipe.source] } : a.id === 'target' ? { ...a, position: [...recipe.target] } : a);
  const ins = insertComponent(doc, fam.component, undefined, { group: true });
  doc = ins.doc;
  const prefix = ins.prefix;
  const hash = hashRecipe(recipe);
  doc.tags = [...doc.tags, 'migrated-from-v1', `v1-${recipe.family}`, `v1-hash-${hash}`];
  lines.push({ field: 'name', old: recipe.name, status: 'kept', value: doc.name }, { field: 'seed', old: recipe.seed, status: 'kept', value: doc.seed },
    { field: 'source', old: recipe.source, status: 'kept' }, { field: 'target', old: recipe.target, status: 'kept' });
  // Root scale.
  doc.rootTransform = { ...doc.rootTransform, scale: recipe.parameters.scale };
  lines.push({ field: 'scale', old: recipe.parameters.scale, status: 'mapped', target: 'effect root scale', value: recipe.parameters.scale });

  const control = (knob: string) => doc.controls.find(c => c.id === `ctl-${prefix}-${knob}`);
  const used = new Set<keyof Parameters>(['scale']);
  for (const m of fam.map) {
    used.add(m.from);
    const c = control(m.knob), old = recipe.parameters[m.from] as number, def = defaults[m.from] as number;
    if (!c || typeof c.value !== 'number') { lines.push({ field: m.from, old, status: 'unused', note: `knob "${m.knob}" not found on ${fam.component}` }); continue; }
    const base = c.default as number;
    let v = m.mode === 'direct' ? old : def === 0 ? base : m.mode === 'inverse' ? base * (def / (old || def)) : base * (old / def);
    if (c.type === 'integer') v = Math.round(v);
    let status: MigrationLine['status'] = 'mapped', note: string | undefined;
    if (c.min !== undefined && v < c.min) { note = `clamped from ${+v.toFixed(4)} to the minimum ${c.min}`; v = c.min; status = 'clamped'; }
    if (c.max !== undefined && v > c.max) { note = `clamped from ${+v.toFixed(4)} to the maximum ${c.max}`; v = c.max; status = 'clamped'; }
    c.value = +v.toFixed(6);
    lines.push({ field: m.from, old, status, target: `${c.label} knob`, value: c.value, ...(note ? { note } : {}) });
  }
  // Colours: a component with a colour knob takes the primary colour; otherwise it keeps its own palette.
  const colorCtl = fam.colorKnob ? control(fam.colorKnob) : undefined;
  if (colorCtl) { colorCtl.value = { srgb: recipe.parameters.color.toUpperCase(), alpha: 1 }; lines.push({ field: 'color', old: recipe.parameters.color, status: 'mapped', target: `${colorCtl.label} knob`, value: recipe.parameters.color }); used.add('color'); }
  // Timing: components carry their own authored timing; the original total is reported for comparison.
  const oldTicks = Math.round((recipe.parameters.charge + recipe.parameters.active + recipe.parameters.decay) * 60);
  lines.push({ field: 'charge+active+decay', old: `${oldTicks} ticks`, status: 'unused', note: `the ${fam.component} component uses its own phase timing (${doc.durationTicks} ticks); use its Start at and timing knobs to retime` });
  for (const k of ['charge', 'active', 'decay'] as const) used.add(k);
  if (oldTicks > doc.durationTicks) doc.durationTicks = Math.min(MAX_DURATION_TICKS, oldTicks);
  for (const k of Object.keys(recipe.parameters) as (keyof Parameters)[]) {
    if (used.has(k)) continue;
    const note = k === 'volume' || k === 'pitch' ? 'sound is not converted yet' : k === 'color' || k === 'secondaryColor' ? `${fam.component} keeps its own palette (no colour knob)` : `no matching knob on ${fam.component}`;
    lines.push({ field: k, old: recipe.parameters[k], status: 'unused', note });
  }
  return { doc, report: { family: recipe.family, component: fam.component, lines, recipeHash: hash } };
}

/** Plain-text report for the user (shown before/after converting and downloadable). */
export function formatMigrationReport(r: MigrationReport): string {
  return [`Converted v1 ${r.family} (hash ${r.recipeHash}) to the ${r.component} component.`,
    ...r.lines.map(l => `- ${l.field}: ${JSON.stringify(l.old)} → ${l.status}${l.target ? ` ${l.target}` : ''}${l.value !== undefined && l.status !== 'kept' ? ` = ${JSON.stringify(l.value)}` : ''}${l.note ? ` (${l.note})` : ''}`)].join('\n');
}
