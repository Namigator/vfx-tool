// Graph "Tidy up" (user 2026-10-07: "a genuinely comfortable app"): lays a graph out left to right by data flow so a
// graph built by an AI or grown over time reads at a glance. Pure: columns = longest chain from the inputs, rows ordered
// to keep links short (barycentre sweeps), sizes from the editor's measured cards when known.

export type TidyNode = { id: string; width?: number; height?: number };
export type TidyEdge = { source: string; target: string };

export const TIDY_DEFAULT_SIZE = { width: 240, height: 150 } as const;
export const TIDY_GAP = { x: 90, y: 36 } as const;

/** New top-left positions for every node (unconnected nodes go in the first column, after the connected ones). */
export function tidyLayout(nodes: readonly TidyNode[], edges: readonly TidyEdge[]): Record<string, { x: number; y: number }> {
  const ids = new Set(nodes.map(n => n.id));
  const es = edges.filter(e => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
  const preds = new Map<string, string[]>(), succs = new Map<string, string[]>();
  for (const n of nodes) { preds.set(n.id, []); succs.set(n.id, []); }
  for (const e of es) { preds.get(e.target)!.push(e.source); succs.get(e.source)!.push(e.target); }
  // Longest chain from a source; capped relaxation keeps a (not normally possible) cycle from looping forever.
  const depth = new Map<string, number>(nodes.map(n => [n.id, 0]));
  for (let pass = 0, changed = true; changed && pass < nodes.length; pass++) {
    changed = false;
    for (const e of es) {
      const d = depth.get(e.source)! + 1;
      if (d > depth.get(e.target)!) { depth.set(e.target, d); changed = true; }
    }
  }
  // Pull sources right next to their first consumer (a Material used by a late renderer sits beside it, not at column 0).
  for (const n of nodes) {
    const s = succs.get(n.id)!;
    if (preds.get(n.id)!.length === 0 && s.length) depth.set(n.id, Math.max(0, Math.min(...s.map(t => depth.get(t)!)) - 1));
  }
  const cols: string[][] = [];
  const order = nodes.map(n => n.id);
  const lonely = order.filter(id => !preds.get(id)!.length && !succs.get(id)!.length);
  for (const id of order) if (!lonely.includes(id)) (cols[depth.get(id)!] ??= []).push(id);
  if (lonely.length) (cols[0] ??= []).push(...lonely);
  const filled = cols.map(c => c ?? []);
  const row = new Map<string, number>();
  const index = () => filled.forEach(c => c.forEach((id, i) => row.set(id, i)));
  index();
  const bary = (id: string, nb: Map<string, string[]>) => { const r = nb.get(id)!.map(x => row.get(x)!).filter(v => v !== undefined); return r.length ? r.reduce((a, b) => a + b, 0) / r.length : row.get(id)!; };
  for (let sweep = 0; sweep < 4; sweep++) {
    const nb = sweep % 2 === 0 ? preds : succs;
    const seq = sweep % 2 === 0 ? filled.keys() : [...filled.keys()].reverse();
    for (const ci of seq) { filled[ci].sort((a, b) => bary(a, nb) - bary(b, nb)); filled[ci].forEach((id, i) => row.set(id, i)); }
  }
  const size = new Map(nodes.map(n => [n.id, { w: n.width ?? TIDY_DEFAULT_SIZE.width, h: n.height ?? TIDY_DEFAULT_SIZE.height }]));
  const out: Record<string, { x: number; y: number }> = {};
  let x = 0;
  for (const c of filled) {
    if (!c.length) continue;
    let y = 0, w = 0;
    for (const id of c) { const s = size.get(id)!; out[id] = { x: Math.round(x), y: Math.round(y) }; y += s.h + TIDY_GAP.y; w = Math.max(w, s.w); }
    x += w + TIDY_GAP.x;
  }
  return out;
}
