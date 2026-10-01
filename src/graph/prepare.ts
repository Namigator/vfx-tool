// Validation, analysis and group expansion of a document, shared by the particle and path preview compilers.
// None of it depends on the tick or on which compiler asks, yet one edit used to run it three times (particle
// compile, path compile, and the particle probe inside the path compile) — about 60 ms of a lightning edit — and
// the path preview recompiles every tick. Cached by the input's JSON text (a few recent documents), so an in-place edit
// can never serve a stale result and a clone of the same document (the preview's per-edit snapshot, the editor's
// preview-mode and graph-canvas checks) is analysed once per edit instead of once per caller. Callers must treat the
// result as read-only (it is shared).
import { analyzeGraph } from './analyze.ts';
import { expandGroups } from './expand.ts';
import { createRegistry } from './registry.ts';

export type PreparedDocument = { registry: ReturnType<typeof createRegistry>; analysis: ReturnType<typeof analyzeGraph>; expansion?: ReturnType<typeof expandGroups> };
/** Recent documents kept (an edit's document, its preview snapshot and the previous edit's). */
export const PREPARE_CACHE_SIZE = 4;
const cache = new Map<string, PreparedDocument>();

/** Same-content check for tick-independent caches: the input's JSON text (undefined if it cannot be serialised). */
export function sameInputText(input: unknown): string | undefined {
  try { return JSON.stringify(input); } catch { return undefined; }
}

export function prepareDocument(input: unknown): PreparedDocument {
  const text = typeof input === 'object' && input !== null ? sameInputText(input) : undefined;
  const cached = text !== undefined ? cache.get(text) : undefined;
  if (cached) { cache.delete(text!); cache.set(text!, cached); return cached; } // most recently used last
  const registry = createRegistry();
  const analysis = analyzeGraph(input, { registry });
  const prepared: PreparedDocument = { registry, analysis, expansion: analysis.ok ? expandGroups(analysis.value) : undefined };
  if (text !== undefined) {
    cache.set(text, prepared);
    while (cache.size > PREPARE_CACHE_SIZE) cache.delete(cache.keys().next().value!);
  }
  return prepared;
}
