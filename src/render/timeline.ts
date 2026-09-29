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
