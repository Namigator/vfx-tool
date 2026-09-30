// Shared draw order for mixed particle + ribbon preview layers, and diagnostic merging for the two
// visual compilers. Pure: no DOM, React or Three.
import type { Diagnostic } from '../model/types.ts';

/** visualOrder slots per renderOrderOffset step; root visual connection counts stay far below this. */
export const VISUAL_ORDER_STRIDE = 1024;

/**
 * Three.js renderOrder for a layer: renderOrderOffset dominates, root EffectOutput.visual connection order
 * breaks ties, so particle and ribbon layers interleave exactly as wired.
 */
export function layerRenderOrder(offset: number, visualOrder: number): number {
  if (!Number.isFinite(offset)) throw new RangeError(`renderOrderOffset must be finite; got ${offset}.`);
  if (!Number.isInteger(visualOrder) || visualOrder < 0 || visualOrder >= VISUAL_ORDER_STRIDE) {
    throw new RangeError(`visualOrder must be an integer in [0, ${VISUAL_ORDER_STRIDE}); got ${visualOrder}.`);
  }
  return offset * VISUAL_ORDER_STRIDE + visualOrder;
}

/**
 * Concatenates diagnostic lists in order, dropping exact duplicates (same severity, code, nodeId,
 * fieldPath and message), e.g. analysis errors both compilers report for the same document.
 */
export function mergeDiagnostics(...lists: readonly (readonly Diagnostic[])[]): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const list of lists) {
    for (const d of list) {
      const key = JSON.stringify([d.severity, d.code, d.nodeId ?? null, d.fieldPath ?? null, d.message]);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}
