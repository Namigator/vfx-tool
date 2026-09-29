// 16-PORTABILITY capability classes: every node (and material operation) declares the capabilities it needs and one
// class — Core (authored intent any adapter must keep), Approximation (needs target-specific reconstruction) or
// Enhancement (optional presentation). These describe the authoring contract, not a verified engine support matrix:
// the UI says "Portable intent" / "May need approximation" / "Preview enhancement", never "<engine> supported".
import type { EffectDocumentV2 } from '../model/types.ts';

export type PortabilityClass = 'core' | 'approximation' | 'enhancement';
export type Portability = { class: PortabilityClass; capabilities: string[] };

const P = (cls: PortabilityClass, ...capabilities: string[]): Portability => ({ class: cls, capabilities });

/** Per node type, from the 16 capability inventory. */
export const NODE_PORTABILITY: Record<string, Portability> = {
  Anchor: P('core', 'anchors'), OffsetAnchor: P('core', 'anchors'),
  Schedule: P('core', 'timed-burst-rate-lifetime'), EventDelay: P('core', 'events'), MergeEvents: P('core', 'events'),
  Emitter: P('core', 'timed-burst-rate-lifetime'), InitialProperties: P('core', 'timed-burst-rate-lifetime'),
  Gravity: P('core', 'particle-forces'), Drag: P('core', 'particle-forces'),
  NoiseForce: P('approximation', 'particle-forces', 'custom-noise-motion'), Attract: P('approximation', 'particle-forces'),
  Vortex: P('approximation', 'particle-forces'), GroundCollision: P('approximation', 'particle-forces', 'collision'),
  ParticleEvents: P('core', 'events'), OverLife: P('core', 'gradient-curve'),
  RandomRange: P('core', 'values'), Constant: P('core', 'values'), ScalarMath: P('core', 'values'), PublicParameter: P('core', 'public-controls'),
  Curve: P('core', 'gradient-curve'), Gradient: P('core', 'gradient-curve'),
  EffectTimeCurve: P('core', 'gradient-curve'), Oscillator: P('core', 'values'), Time: P('core', 'values'),
  Material: P('core', 'textured-billboard-flipbook'), BillboardRenderer: P('core', 'textured-billboard-flipbook'),
  SpriteRenderer: P('core', 'textured-billboard-flipbook'),
  ParticleTrail: P('approximation', 'path-branch-ribbon'), MotionTrail: P('approximation', 'path-branch-ribbon'),
  MeshRenderer: P('core', 'static-mesh-instances'), PropMesh: P('core', 'static-mesh-instances'),
  PointLight: P('core', 'lights'),
  PathFollower: P('core', 'path-branch-ribbon'), LinePath: P('core', 'path-branch-ribbon'), BezierPath: P('core', 'path-branch-ribbon'),
  HelixPath: P('core', 'path-branch-ribbon'), PathTransform: P('core', 'path-branch-ribbon'), MergePaths: P('core', 'path-branch-ribbon'),
  RingPath: P('core', 'path-branch-ribbon'), RadialPath: P('core', 'path-branch-ribbon'), RevealPath: P('core', 'path-branch-ribbon'),
  ParticlePaths: P('approximation', 'path-branch-ribbon'), JaggedPath: P('approximation', 'path-branch-ribbon', 'custom-noise-motion'),
  BranchPath: P('approximation', 'path-branch-ribbon', 'arbitrary-branching'),
  RibbonRenderer: P('core', 'path-branch-ribbon'), RingRenderer: P('core', 'path-branch-ribbon'),
  ScreenFlash: P('enhancement', 'presentation'), CameraImpulse: P('enhancement', 'presentation'),
  AudioSource: P('core', 'layered-audio'), AudioEnvelope: P('core', 'layered-audio'), AudioFilter: P('core', 'layered-audio'),
  AudioMix: P('core', 'layered-audio'), AudioOutput: P('core', 'layered-audio'),
  EffectOutput: P('core', 'effect-output'), Group: P('core', 'groups'), GroupInput: P('core', 'groups'), GroupOutput: P('core', 'groups'),
};

/** Material operations that are not plain textured billboards (checked on each Material's parameters). */
const MATERIAL_OPS: { param: string; active: (v: unknown) => boolean; label: string; p: Portability }[] = [
  { param: 'dissolve', active: v => typeof v === 'number' && v > 0, label: 'dissolve', p: P('approximation', 'dissolve-rim') },
  { param: 'rim', active: v => typeof v === 'number' && v > 0, label: 'rim', p: P('approximation', 'dissolve-rim') },
  { param: 'liquid', active: v => typeof v === 'number' && v > 0, label: 'liquid shading', p: P('approximation', 'water-refraction') },
  { param: 'reflection', active: v => typeof v === 'number' && v > 0, label: 'reflection', p: P('approximation', 'pbr-material') },
  { param: 'surfaceDetail', active: v => typeof v === 'number' && v > 0, label: 'surface detail', p: P('approximation', 'pbr-material') },
  { param: 'uvDistort', active: v => typeof v === 'number' && v > 0, label: 'UV distortion', p: P('approximation', 'material-uv-animation') },
];

/** The class a node needs as authored (a Material with dissolve/rim/... needs approximation). */
export function nodePortability(type: string, params: Record<string, unknown> = {}): Portability & { reasons: string[] } {
  const base = NODE_PORTABILITY[type] ?? P('approximation', 'unknown');
  if (type !== 'Material') return { ...base, reasons: [] };
  const ops = MATERIAL_OPS.filter(o => o.active(params[o.param]));
  return ops.length ? { class: 'approximation', capabilities: [...new Set([...base.capabilities, ...ops.flatMap(o => o.p.capabilities)])], reasons: ops.map(o => o.label) } : { ...base, reasons: [] };
}

export const PORTABILITY_LABEL: Record<PortabilityClass, string> = { core: 'Portable intent', approximation: 'May need approximation', enhancement: 'Preview enhancement (optional)' };

/** Document summary: which authored parts may need approximation or are optional enhancements (glow counts as one). */
export function portabilityReport(doc: EffectDocumentV2): { approximations: string[]; enhancements: string[] } {
  const approximations: string[] = [], enhancements: string[] = [];
  for (const n of doc.graphs.flatMap(g => g.nodes)) {
    if (!n.enabled) continue;
    const p = nodePortability(n.type, n.params);
    const what = `${n.label || n.id}${p.reasons.length ? ` (${p.reasons.join(', ')})` : ` (${n.type})`}`;
    if (p.class === 'approximation') approximations.push(what);
    else if (p.class === 'enhancement') enhancements.push(what);
  }
  enhancements.push('glow (bloom)');
  return { approximations, enhancements };
}
