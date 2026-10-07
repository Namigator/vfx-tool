// Path numbers in the viewport (user 2026-10-07: merged paths lost control, "we need to be able to index them").
// While a path node, PathFollower, PathSplitter or MergePaths is selected the viewport shows each path's number at its
// end: the same numbers PathSplitter From/Offset and Colour by path count with. Pure: no DOM or Three.
import type { EffectDocumentV2, Vec3 } from '../model/types.ts';
import { compilePathPreview } from './toPaths.ts';
import { pathColors, type PathColorMode } from './pathColor.ts';
import type { GradientValue } from '../model/types.ts';

export type PathLabel = { position: Vec3; text: string; color?: string };

/** Most labels drawn (the rest of a huge set stays unnumbered). */
export const MAX_PATH_LABELS = 64;

const CHOSEN = '#6fd48f', LEFT_BEHIND = '#7a8294';

function probe(doc: EffectDocumentV2, nodeId: string, port: string, tick: number) {
  const r = compilePathPreview(doc, tick, { audioHandled: true, probe: { nodeId, port } });
  return r.ok ? r.value.probe ?? [] : undefined;
}

/** The path source feeding `nodeId.port` (first edge into it, in any graph). */
function sourceOf(doc: EffectDocumentV2, nodeId: string, port: string): { nodeId: string; port: string } | undefined {
  for (const g of doc.graphs) for (const e of g.edges) if (e.target.nodeId === nodeId && e.target.port === port) return { nodeId: e.source.nodeId, port: e.source.port };
  return undefined;
}

/** Labels for the selected node at `tick`, or null when it is not a path-set node (or the paths cannot be evaluated). */
export function pathLabelsFor(doc: EffectDocumentV2, nodeId: string | null | undefined, tick: number): PathLabel[] | null {
  if (!nodeId) return null;
  const n = doc.graphs.flatMap(g => g.nodes).find(x => x.id === nodeId);
  if (!n) return null;
  const type = n.type;
  const isPathNode = ['LinePath', 'BezierPath', 'HelixPath', 'RadialPath', 'RingPath', 'JaggedPath', 'BranchPath', 'RevealPath', 'PathTransform', 'MergePaths', 'ParticlePaths'].includes(type);
  if (!isPathNode && type !== 'PathFollower' && type !== 'PathSplitter') return null;
  try {
    const t = Math.max(0, Math.min(doc.durationTicks, Math.round(tick)));
    let set: ReturnType<typeof probe>;
    let colors: (string | undefined)[] = [];
    if (type === 'PathFollower' || type === 'PathSplitter') {
      const src = sourceOf(doc, nodeId, 'paths');
      if (!src) return null;
      set = probe(doc, src.nodeId, src.port, t);
      if (!set) return null;
      if (type === 'PathSplitter') {
        // Numbers count the splitter's INPUT (what From / Offset refer to); chosen ones are green.
        const chosen = new Set((probe(doc, nodeId, 'paths', t) ?? []).map(p => p.id));
        colors = set.map(p => (chosen.has(p.id) ? CHOSEN : LEFT_BEHIND));
      } else {
        const pc = pathColors((n.params.pathColor as PathColorMode | undefined) ?? 'off', (n.params.pathGradient as GradientValue | undefined) ?? { stops: [] }, set.length);
        colors = pc ? pc.map(c => c.srgb) : [];
      }
    } else {
      set = probe(doc, nodeId, type === 'BranchPath' ? 'branches' : 'paths', t);
    }
    if (!set) return null;
    return set.slice(0, MAX_PATH_LABELS).flatMap((p, i) => {
      const end = p.points[p.points.length - 1];
      return end ? [{ position: [end[0], end[1] + 0.14, end[2]] as Vec3, text: String(i), ...(colors[i] ? { color: colors[i] } : {}) }] : [];
    });
  } catch {
    return null;
  }
}
