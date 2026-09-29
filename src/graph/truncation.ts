// 10 "The global document duration must include its tail; warn if a user shortens it and will truncate output."
// The document is recompiled with the maximum duration so nothing is clipped, and the last tick anything is
// still visible is measured: particles (last emission + longest life, plus trail history), lights, sprite
// windows and ribbon windows. Sound is not measured here (the audio compiler reports its own overruns).
import { MAX_DURATION_TICKS, type Diagnostic, type EffectDocumentV2 } from '../model/types.ts';
import { compileParticlePreview } from './toParticles.ts';
import { compilePathPreview } from './toPaths.ts';

/**
 * 15 performance: one edit asked this three times (grownDuration before/after, then truncationWarning), each a full
 * compile at the maximum duration. The answer depends only on the document content, so recent answers are cached by
 * its JSON text (the duration field excluded: the measurement always uses the maximum).
 */
const endCache = new Map<string, number | undefined>();
const END_CACHE_SIZE = 8;

/** Last tick (exclusive) at which the effect still shows something, or undefined when it cannot be measured. */
export function effectEndTick(doc: EffectDocumentV2): number | undefined {
  let key: string | undefined;
  try { key = JSON.stringify({ ...doc, durationTicks: 0 }); } catch { key = undefined; }
  if (key !== undefined && endCache.has(key)) { const v = endCache.get(key); endCache.delete(key); endCache.set(key, v); return v; }
  const v = measureEnd(doc);
  if (key !== undefined) { endCache.set(key, v); if (endCache.size > END_CACHE_SIZE) endCache.delete(endCache.keys().next().value as string); }
  return v;
}

function measureEnd(doc: EffectDocumentV2): number | undefined {
  const full = { ...doc, durationTicks: MAX_DURATION_TICKS };
  const p = compileParticlePreview(full, { ribbonsHandled: true, audioHandled: true });
  if (!p.ok) return undefined;
  let end = 0;
  const trailHistory = new Map<string, number>();
  for (const t of p.value.trails) trailHistory.set(t.systemId, Math.max(trailHistory.get(t.systemId) ?? 0, t.historyTicks));
  for (const s of p.value.systems) {
    const d = s.descriptor;
    const lastEmit = Math.max(-1, ...d.bursts.map(b => b.tick), d.rate && d.rate.perSecond > 0 ? d.rate.endTick - 1 : -1);
    if (lastEmit >= 0) end = Math.max(end, lastEmit + d.lifetimeTicks.max + (trailHistory.get(s.id) ?? 0) + 1);
  }
  for (const l of p.value.lights) end = Math.max(end, l.endTick);
  const paths = compilePathPreview(full, 0, { audioHandled: true });
  if (paths.ok) for (const l of paths.value.layers) if (l.window) end = Math.max(end, l.window.endTick);
  return end;
}

/**
 * Knob edits never cut an effect off: when a change (a longer travel, a later Start at, a longer burn) pushes the
 * visible end past the document duration, the duration grows to fit (capped). Returns the new duration, or undefined
 * when nothing needs to change. It never shortens, and ignores tails that were already cut before the edit.
 */
export function grownDuration(before: EffectDocumentV2, after: EffectDocumentV2): number | undefined {
  const endAfter = effectEndTick(after);
  if (endAfter === undefined || endAfter <= after.durationTicks) return undefined;
  const endBefore = effectEndTick(before) ?? 0;
  if (endAfter <= endBefore) return undefined;
  const grown = Math.min(MAX_DURATION_TICKS, endAfter);
  return grown > after.durationTicks ? grown : undefined;
}

/** Warning when the document ends before its content does (the Start at knob and long tails are the usual cause). */
export function truncationWarning(doc: EffectDocumentV2): Diagnostic | undefined {
  const end = effectEndTick(doc);
  if (end === undefined || end <= doc.durationTicks) return undefined;
  const cut = Math.min(end, MAX_DURATION_TICKS);
  return {
    code: 'BUDGET_EXCEEDED', severity: 'warning', fieldPath: 'durationTicks',
    message: `The effect ends at tick ${doc.durationTicks} but parts are still visible until tick ${cut} (${(cut / 60).toFixed(2)} s); they are cut off. Lengthen the effect to ${cut} ticks to keep its tail.`,
  };
}
