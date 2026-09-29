// Validation, analysis and group expansion of a document, shared by the particle and path preview compilers.
// None of it depends on the tick or on which compiler asks, yet one edit used to run it three times (particle
// compile, path compile, and the particle probe inside the path compile) — about 60 ms of a lightning edit — and
// the path preview recompiles every tick. Cached per input object; a hit is reused only while the object's JSON
// text is unchanged, so an in-place edit can never serve a stale result. Callers must treat the result as
// read-only (it is shared).
import { analyzeGraph } from './analyze.ts';
import { expandGroups } from './expand.ts';
import { createRegistry } from './registry.ts';

export type PreparedDocument = { registry: ReturnType<typeof createRegistry>; analysis: ReturnType<typeof analyzeGraph>; expansion?: ReturnType<typeof expandGroups> };
const cache = new WeakMap<object, { text: string; prepared: PreparedDocument }>();

/** Same-content check for tick-independent caches: the input's JSON text (undefined if it cannot be serialised). */
export function sameInputText(input: unknown): string | undefined {
  try { return JSON.stringify(input); } catch { return undefined; }
}

export function prepareDocument(input: unknown): PreparedDocument {
  const key = typeof input === 'object' && input !== null ? input : undefined;
  const text = key ? sameInputText(input) : undefined;
  const cached = key ? cache.get(key) : undefined;
  if (cached && text !== undefined && cached.text === text) return cached.prepared;
  const registry = createRegistry();
  const analysis = analyzeGraph(input, { registry });
  const prepared: PreparedDocument = { registry, analysis, expansion: analysis.ok ? expandGroups(analysis.value) : undefined };
  if (key && text !== undefined) cache.set(key, { text, prepared });
  return prepared;
}
