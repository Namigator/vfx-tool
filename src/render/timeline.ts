// 12 "Timeline displays duration, event markers, selected layer's lifetime window": markers and per-node active
// windows read from the compiled preview plans (pure; the editor draws them under the scrub bar).
import type { ParticlePreviewPlan } from '../graph/toParticles.ts';
import type { PathPreviewPlan } from '../graph/toPaths.ts';

export type TimelineMarker = { tick: number; kind: 'burst' | 'start' | 'arrival' | 'flash' | 'shake'; nodeId: string };
export type TimelineInfo = { markers: TimelineMarker[]; windows: Map<string, [number, number]> };

export function timelineInfo(points: ParticlePreviewPlan | null, paths: PathPreviewPlan | null): TimelineInfo {
  const markers: TimelineMarker[] = [], windows = new Map<string, [number, number]>();
  const widen = (id: string, a: number, b: number) => { const w = windows.get(id); windows.set(id, w ? [Math.min(w[0], a), Math.max(w[1], b)] : [a, b]); };
  if (points) {
    const sysWindow = new Map<string, [number, number]>();
    for (const s of points.systems) {
      const d = s.descriptor, starts = [...d.bursts.map(b => b.tick), ...(d.rate ? [d.rate.startTick] : [])];
      if (!starts.length) continue;
      const lastEmit = Math.max(...d.bursts.map(b => b.tick), d.rate ? d.rate.endTick : -Infinity);
      sysWindow.set(s.id, [Math.min(...starts), Math.min(d.durationTicks, lastEmit + d.lifetimeTicks.max)]);
      for (const b of d.bursts) markers.push({ tick: b.tick, kind: 'burst', nodeId: s.id });
      if (d.rate) markers.push({ tick: d.rate.startTick, kind: 'start', nodeId: s.id });
    }
    for (const l of points.layers) { const w = sysWindow.get(l.systemId); if (w) widen(l.nodeId, w[0], w[1]); }
    for (const t of points.trails) { const w = sysWindow.get(t.systemId); if (w) widen(t.nodeId, w[0], w[1] + t.historyTicks); }
    for (const m of points.meshes) { const w = sysWindow.get(m.systemId); if (w) widen(m.nodeId, w[0], w[1]); }
    for (const l of points.lights) widen(l.nodeId, l.startTick, l.endTick);
    for (const f of points.followers) markers.push({ tick: f.startTick + f.travelTicks, kind: 'arrival', nodeId: f.nodeId });
    for (const f of points.presentation.flashes) markers.push({ tick: f.tick, kind: 'flash', nodeId: f.nodeId });
    for (const i of points.presentation.impulses) markers.push({ tick: i.tick, kind: 'shake', nodeId: i.nodeId });
    for (const [id, w] of sysWindow) if (!windows.has(id)) windows.set(id, w);
  }
  if (paths) for (const l of paths.layers) if (l.window) { widen(l.nodeId, l.window.startTick, l.window.endTick); markers.push({ tick: l.window.startTick, kind: 'start', nodeId: l.nodeId }); }
  const seen = new Set<string>();
  return { markers: markers.filter(m => { const k = `${m.tick}:${m.kind}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.tick - b.tick), windows };
}

/**
 * Timeline strip (user order 2026-09-29, after the performance pass): one lane per inserted component, its bar spanning
 * the ticks where any of its parts is active. Components are found by their automatic knobs (ctl-<prefix>-start-at /
 * -colour-shift); a node belongs to the component with the longest matching id prefix (fire-jet-2 vs fire-jet).
 * Dragging the bar edits Start at; dragging the right edge edits the component's length knob when it has one
 * (a tick knob bound to durationTicks: Burn time, Travel time/ticks).
 */
export type TimelineLane = {
  prefix: string; label: string;
  /** Active window [start, end) in effect ticks; undefined when nothing of it shows. */
  span?: [number, number];
  /** Indices into doc.controls. */
  startControl?: number; lengthControl?: number;
  /** Root Group node of a grouped component (selecting the bar selects it). */
  groupNodeId?: string;
};
type LaneDoc = {
  controls: readonly { id: string; label: string; section: string; unit: string; type: string; bindings: readonly { parameter: string }[] }[];
  graphs: readonly { id: string; nodes: readonly { id: string; type: string }[] }[];
  rootGraphId: string;
};

export function timelineLanes(doc: LaneDoc, windows: ReadonlyMap<string, readonly [number, number]>): TimelineLane[] {
  const lanes = new Map<string, TimelineLane>();
  doc.controls.forEach((c, i) => {
    const m = /^ctl-(.+)-(start-at|colour-shift)$/.exec(c.id);
    if (!m) return;
    const lane = lanes.get(m[1]) ?? { prefix: m[1], label: c.section };
    if (m[2] === 'start-at') lane.startControl = i;
    lanes.set(m[1], lane);
  });
  const prefixes = [...lanes.keys()].sort((a, b) => b.length - a.length);
  doc.controls.forEach((c, i) => {
    const p = prefixes.find(x => c.id.startsWith(`ctl-${x}-`));
    if (p && c.unit === 'tick' && c.type === 'integer' && !c.id.endsWith('-start-at') && c.bindings.length > 0 && c.bindings.every(b => b.parameter === 'durationTicks')) {
      lanes.get(p)!.lengthControl ??= i;
    }
  });
  for (const [id, w] of windows) {
    const p = prefixes.find(x => id.startsWith(`${x}-`));
    if (!p) continue;
    const lane = lanes.get(p)!;
    lane.span = lane.span ? [Math.min(lane.span[0], w[0]), Math.max(lane.span[1], w[1])] : [w[0], w[1]];
  }
  const root = doc.graphs.find(g => g.id === doc.rootGraphId);
  for (const lane of lanes.values()) if (root?.nodes.some(n => n.id === lane.prefix && n.type === 'Group')) lane.groupNodeId = lane.prefix;
  return [...lanes.values()];
}
