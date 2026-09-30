// 08 glow settings of an effect: the root EffectOutput's glow parameters, resolved like any parameter (so a
// knob may drive them); defaults when absent or when the document does not resolve.
import type { EffectDocumentV2 } from '../model/types.ts';
import { resolveParameters } from '../model/controls.ts';
import { createRegistry } from './registry.ts';

export type GlowSettings = { strength: number; radius: number; threshold: number; limit: number };
export const DEFAULT_GLOW: GlowSettings = { strength: 0.8, radius: 0.45, threshold: 1, limit: 3 };
const registry = createRegistry();

export function glowSettings(doc: EffectDocumentV2): GlowSettings {
  const out = doc.graphs.find(g => g.id === doc.rootGraphId)?.nodes.find(n => n.type === 'EffectOutput');
  if (!out) return { ...DEFAULT_GLOW };
  const r = resolveParameters(doc, registry);
  const num = (k: string, d: number) => {
    const v = r.ok ? r.value.find(x => x.nodeId === out.id && x.parameter === k)?.value : out.params[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : d;
  };
  return { strength: num('glowStrength', DEFAULT_GLOW.strength), radius: num('glowRadius', DEFAULT_GLOW.radius), threshold: num('glowThreshold', DEFAULT_GLOW.threshold), limit: num('glowLimit', DEFAULT_GLOW.limit) };
}
