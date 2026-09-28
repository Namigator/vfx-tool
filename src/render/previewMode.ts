// V2 preview mode choice (points, path ribbons or mixed) and ribbon style support checks. Pure: no DOM,
// React or Three. The path compiler skips BillboardRenderer sinks and the point compiler skips
// RibbonRenderer sinks only with `ribbonsHandled`, so mixed documents must run both compilers.
import type { Diagnostic, EffectDocumentV2 } from '../model/types.ts';
import { analyzeGraph } from '../graph/analyze.ts';
import { createL01Document } from '../graph/fixtures.ts';
import { createL01AudioDocument } from '../graph/audioFixtures.ts';
import { EFFECT_OUTPUT_NODE_TYPE } from '../model/document.ts';
import { expandGroups } from '../graph/expand.ts';
import { createRegistry } from '../graph/registry.ts';
import type { PathPreviewLayer } from '../graph/toPaths.ts';

export type PreviewModeChoice =
  | { mode: 'points' }
  | { mode: 'paths' }
  | { mode: 'mixed' };

/**
 * `paths` when a RibbonRenderer feeds root EffectOutput.visual (after group expansion), `mixed` when an
 * enabled BillboardRenderer feeds it too (compile both: particles with `ribbonsHandled`, then paths, and
 * order layers with layerRenderOrder), else `points`. Documents that do not analyze fall back to
 * `points` so the point compiler reports their errors as before.
 */
export function choosePreviewMode(doc: unknown): PreviewModeChoice {
  const analysis = analyzeGraph(doc, { registry: createRegistry() });
  if (!analysis.ok) return { mode: 'points' };
  const expansion = expandGroups(analysis.value);
  if (!expansion.ok) return { mode: 'points' };
  const x = expansion.value;
  const nodes = new Map(x.nodes.map(n => [n.node.id, n]));
  const ribbons: string[] = [], billboards: string[] = [];
  for (const c of x.connections) {
    if (c.target.nodeId !== x.rootOutputNodeId || c.target.port !== 'visual' || c.source.kind !== 'node') continue;
    const n = nodes.get(c.source.nodeId);
    if (!n) continue;
    if (n.node.type === 'RibbonRenderer' && n.effectiveEnabled && !ribbons.includes(n.node.id)) ribbons.push(n.node.id);
    if ((n.node.type === 'BillboardRenderer' || n.node.type === 'ParticleTrail' || n.node.type === 'SpriteRenderer' || n.node.type === 'PropMesh' || n.node.type === 'PointLight' || n.node.type === 'MeshRenderer' || n.node.type === 'MotionTrail') && n.effectiveEnabled && !billboards.includes(n.node.id)) billboards.push(n.node.id);
  }
  if (x.connections.some(c => c.target.nodeId === x.rootOutputNodeId && c.target.port === 'presentation' && c.source.kind === 'node')) billboards.push('<presentation>');
  if (ribbons.length === 0) return { mode: 'points' };
  if (billboards.length === 0) return { mode: 'paths' };
  return { mode: 'mixed' };
}

/** The browser's lightning demo is the shared editable L01 fixture (three ribbon layers, no hidden recipe). */
export function createLightningDemoDocument(): EffectDocumentV2 {
  return createL01Document();
}

/** The browser's "Load lightning demo": L01 plus its validated root audio mix (shared audio fixture). */
export function createLightningAudioDemoDocument(): EffectDocumentV2 {
  return createL01AudioDocument();
}

/**
 * True when any root-graph edge targets the root EffectOutput `audio` port. Such documents must be compiled
 * with compileAudio before the visual compiler may be told `audioHandled`. Purely structural; malformed
 * documents return false so the visual compiler reports their errors as before.
 */
export function hasRootAudio(doc: EffectDocumentV2): boolean {
  const root = doc.graphs?.find(g => g.id === doc.rootGraphId);
  if (!root) return false;
  const outputs = new Set(root.nodes.filter(n => n.type === EFFECT_OUTPUT_NODE_TYPE).map(n => n.id));
  return root.edges.some(e => outputs.has(e.target.nodeId) && e.target.port === 'audio');
}

function nodeFieldPath(doc: EffectDocumentV2, nodeId: string): string | undefined {
  for (let gi = 0; gi < doc.graphs.length; gi++) {
    const ni = doc.graphs[gi].nodes.findIndex(n => n.id === nodeId);
    if (ni >= 0) return `graphs[${gi}].nodes[${ni}]`;
  }
  return undefined;
}

/** A widthOverPath curve whose every key is 1 has no effect; anything else is unsupported for now. */
export function isTrivialWidthCurve(curve: PathPreviewLayer['widthOverPath']): boolean {
  return curve.keys.every(k => k.y === 1);
}

/**
 * Addressed diagnostics for authored ribbon style values the preview cannot honour. Errors block the
 * preview (widthOverPath shaping, parallel-transport orientation); UV settings are warnings because the
 * preview draws untextured ribbons, so UV mapping has no visible effect.
 */
export function ribbonStyleDiagnostics(doc: EffectDocumentV2, layers: readonly PathPreviewLayer[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  const at = (nodeId: string, param: string) => {
    const p = nodeFieldPath(doc, nodeId);
    return p === undefined ? {} : { fieldPath: `${p}.params.${param}` };
  };
  for (const l of layers) {
    if (!isTrivialWidthCurve(l.widthOverPath)) {
      out.push({ code: 'INVALID_VALUE', severity: 'error', nodeId: l.nodeId, ...at(l.nodeId, 'widthOverPath'), message: `RibbonRenderer "${l.nodeId}" widthOverPath varies along the path; width shaping is not supported by the preview yet. Set every key to 1.` });
    }
    if (l.orientation !== 'camera') {
      out.push({ code: 'INVALID_VALUE', severity: 'error', nodeId: l.nodeId, ...at(l.nodeId, 'orientation'), message: `RibbonRenderer "${l.nodeId}" orientation "${l.orientation}" is not supported by the preview; use "camera".` });
    }
    if (l.uvMode !== 'stretch' && !l.sprite) {
      out.push({ code: 'INVALID_VALUE', severity: 'warning', nodeId: l.nodeId, ...at(l.nodeId, 'uvMode'), message: `RibbonRenderer "${l.nodeId}" uvMode "${l.uvMode}" (tile length ${l.uvTileLength}) has no visible effect: this ribbon is untextured (use a SpriteTextured material).` });
    }
  }
  return out;
}
