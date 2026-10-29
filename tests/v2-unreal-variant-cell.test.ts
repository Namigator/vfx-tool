// A random-variant sprite sheet on a one-particle emitter (a lone halo or core) exports the cell the editor draws for
// that particle, so Unreal shows the same glow style (ring vs tight dot) instead of a per-run random one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { compileParticlePreview } from '../src/graph/toParticles.ts';
import { unrealEffectFrom } from '../src/export/unreal/fromPlan.ts';
import { sampleParticlesAtTick } from '../src/runtime/particles.ts';
import { spriteCell } from '../src/assets/spriteLibrary.ts';
import { fnv1a32Utf8 } from '../src/runtime/random.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { insertComponent, COMPONENT_TEMPLATES } from '../src/graph/components.ts';

/** For every one-particle emitter with a random-variant sheet: the cell the editor's renderer picks for its particle. */
function editorCells(doc: Parameters<typeof compileParticlePreview>[0]): Map<string, number> {
  const plan = compileParticlePreview(doc, { ribbonsHandled: true, audioHandled: true });
  assert.ok(plan.ok);
  const systems = new Map(plan.value.systems.map(s => [s.id, s.descriptor]));
  const out = new Map<string, number>();
  for (const layer of plan.value.layers) {
    const d = systems.get(layer.systemId), sp = layer.sprite;
    if (!d || !sp || sp.sheet.kind !== 'variants' || sp.variant >= 0 || d.rate) continue;
    const live = d.bursts.filter(b => b.count > 0);
    if (live.length !== 1 || live[0].count !== 1) continue;
    const snap = sampleParticlesAtTick(d, Math.min(d.durationTicks - 1, live[0].tick + 1));
    assert.ok(snap.ok);
    const p = snap.value.particles[0];
    if (!p) continue;
    out.set(layer.nodeId, spriteCell(sp.sheet, sp.mode, sp.fps, 0, 0, fnv1a32Utf8(p.parentRandomKey) / 4294967296, sp.randomStart, sp.variant));
  }
  return out;
}

function checkDoc(doc: Parameters<typeof unrealEffectFrom>[0]): number {
  const want = editorCells(doc);
  if (!want.size) return 0;
  const r = unrealEffectFrom(doc);
  assert.ok(r.ok);
  let n = 0;
  for (const [nodeId, cell] of want) {
    const name = nodeId.replace(/[^A-Za-z0-9_]/g, '_');
    const e: { flipbook?: { variantFrame?: number } } | undefined = r.value.emitters.find(x => x.name === name);
    if (!e) continue;
    assert.equal(e.flipbook?.variantFrame, cell, `${nodeId}: exported cell ${e.flipbook?.variantFrame}, editor draws ${cell}`);
    n++;
  }
  return n;
}

test('one-particle variant sprites export the editor-drawn cell (included components)', () => {
  let checked = 0;
  for (const c of COMPONENT_TEMPLATES) {
    const doc = insertComponent(createBlankDocument(`t-${c.id}`, c.id), c.id, undefined, { group: true }).doc;
    checked += checkDoc(doc);
  }
  assert.ok(checked > 0, 'no one-particle variant sprite found in the included components');
});

test('one-particle variant sprites export the editor-drawn cell (saved Arcane docs, when present)', t => {
  const dir = join(import.meta.dirname, '..', 'work', 'mcp');
  const files = existsSync(dir) ? readdirSync(dir).filter(f => /^ab\d\d-arcane-.*\.json$/.test(f)) : [];
  if (!files.length) { t.skip('work/mcp Arcane docs not present'); return; }
  let checked = 0;
  for (const f of files) checked += checkDoc(JSON.parse(readFileSync(join(dir, f), 'utf8')));
  assert.ok(checked > 0);
});
