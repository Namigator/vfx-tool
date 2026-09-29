// Ready-made components (01 "Simple surface", 12 "Add component"): complete, pre-wired node templates
// inserted into a document's root graph. Node ids get a unique prefix; the reserved endpoints
// node-source / node-target / node-output bind to the document's Source anchor, Target anchor and
// EffectOutput (created if missing). Pure: returns a new document, never mutates the input.
import type { EffectDocumentV2, GraphDefinition, NodeDefinition, ParameterValue, Vec3 } from '../model/types.ts';
import { createRegistry } from './registry.ts';
import { COMPONENT_TEMPLATES } from './components.generated.ts';
import { BLANK_SOURCE, BLANK_TARGET } from './fixtures.ts';
import { chroma } from './recolor.ts';

export type ComponentTemplate = {
  id: string; label: string; description: string;
  /** Minimum document duration the component needs (0 = no requirement). */
  durationTicks: number;
  /** Extra anchors the component positions itself (ids get the prefix). */
  anchors: { id: string; position: Vec3 }[];
  nodes: { id: string; type: string; params?: Record<string, unknown> }[];
  /** [from "node.port", to "node.port"]. */
  edges: [string, string][];
  /** Published big knobs (01 "4–8 primary controls"): document controls bound to component node params. */
  knobs: ComponentKnob[];
  /** Source/Target positions the component was designed with (adopted when inserted into a fresh effect). */
  layout?: { source: Vec3; target: Vec3 };
};
/**
 * A knob is a number (affine scale/offset per binding; `axis` drives one component of a vec2/vec3 parameter,
 * with optional explicit min/max) or a non-number value (colour, vector, boolean, choice) copied as-is to
 * same-typed parameters.
 */
export type ComponentKnob = {
  id: string; label: string; value: number | ParameterValue; min?: number; max?: number;
  bindings: { node: string; parameter: string; scale?: number; offset?: number; axis?: number }[];
};

export { COMPONENT_TEMPLATES };

const RESERVED: Record<string, { type: string; anchorId?: string }> = {
  'node-source': { type: 'Anchor', anchorId: 'source' },
  'node-target': { type: 'Anchor', anchorId: 'target' },
  'node-output': { type: 'EffectOutput' },
};

export function getComponent(id: string): ComponentTemplate {
  const c = COMPONENT_TEMPLATES.find(t => t.id === id);
  if (!c) throw new Error(`Unknown component "${id}". Known: ${COMPONENT_TEMPLATES.map(t => t.id).join(', ')}`);
  return c;
}

const isAudioType = (type: string) => type.startsWith('Audio');

/**
 * Inserts `componentId`. Flat (default): every node goes into the root graph. `group: true` (06 "Group"):
 * the component's visual nodes go into their own graph wrapped by one Group node in the root (Source/Target
 * become Anchor nodes inside; knobs become the Group's exposed controls, scope = the child graph). Audio nodes
 * stay in the root (one shared audio chain per document; the audio compiler does not take grouped chains), and
 * every link from inside the group to the root — EffectOutput ports, Schedule cues for sounds — becomes an
 * interface output through a GroupOutput bridge. Returns the new document, the prefix and the Group node id.
 */
/**
 * A fresh effect (only Source, Target and Output, anchors still at the New defaults) adopts the component's designed
 * Source/Target layout, so the first component looks as designed; any other document keeps the user's anchors.
 */
function adoptLayout(d: EffectDocumentV2, c: ComponentTemplate): void {
  if (!c.layout || d.graphs.length !== 1) return;
  const root = d.graphs[0];
  if (root.nodes.some(n => !['Anchor', 'EffectOutput'].includes(n.type)) || root.nodes.length > 3) return;
  const at = (id: string) => d.anchors.find(a => a.id === id)?.position;
  const same = (p: Vec3 | undefined, q: Vec3) => !!p && p.every((v, i) => Math.abs(v - q[i]) < 1e-9);
  if (!same(at('source'), BLANK_SOURCE) || !same(at('target'), BLANK_TARGET)) return;
  d.anchors = d.anchors.map(a => a.id === 'source' ? { ...a, position: [...c.layout!.source] as Vec3 } : a.id === 'target' ? { ...a, position: [...c.layout!.target] as Vec3 } : a);
}

// Colour pickers (user 2026-09-29: "why not as a colour picker?" → "lets do both"): the component's representative
// colour (its most colourful material/light colour) is the swatch of the whole-component Colour picker, and its
// materials/lights are sorted into parts (main body, sparks, smoke, flash, light) that each get their own picker.
type ColourPart = { key: string; label: string; swatch: string; nodes: string[] };
const PART_ORDER = ['main', 'sparks', 'smoke', 'flash', 'light'] as const;
type PartKey = (typeof PART_ORDER)[number];
function partOf(id: string, type: string): PartKey | undefined {
  if (type === 'PointLight') return 'light';
  const n = id.toLowerCase();
  if (/steel|barrel|prop/.test(n)) return undefined; // Props (the flamethrower's nozzle) get no part picker.
  if (/smoke|dust|cloud|vapou?r|residue|haze|wisp/.test(n)) return 'smoke';
  if (/ember|spark|mote|glint|drop|pop|bubble|drip|streak|shed|foam|burst|chip/.test(n)) return 'sparks';
  if (/flash|ring|ripple|splash|ignite|impact|imp[a-z]*mat|pulse/.test(n)) return 'flash';
  return 'main';
}
function partLabel(key: PartKey, id: string): string {
  if (key === 'main') {
    return /fire|flame|torch/.test(id) ? 'Flame' : /lightning|arc|tether/.test(id) ? 'Bolt' : /water|fountain|rain/.test(id) ? 'Water'
      : /ice/.test(id) ? 'Ice' : /earth|rock/.test(id) ? 'Rock' : /wind|tornado/.test(id) ? 'Wind' : /poison/.test(id) ? 'Poison'
      : /shadow/.test(id) ? 'Shadow' : /light|holy/.test(id) ? 'Rays' : /energy|charge/.test(id) ? 'Energy' : /helix|beam/.test(id) ? 'Beam' : 'Main';
  }
  if (key === 'sparks') return /fire|flame|torch/.test(id) ? 'Embers' : /water|fountain|rain/.test(id) ? 'Droplets' : /poison/.test(id) ? 'Bubbles' : 'Sparks';
  if (key === 'smoke') return /poison/.test(id) ? 'Cloud' : /shadow|wind/.test(id) ? 'Wisps' : 'Smoke & dust';
  if (key === 'flash') return /water|rain|fountain/.test(id) ? 'Splash & rings' : 'Flash & rings';
  return 'Light';
}
type Rgb = { srgb: string; alpha: number };
const isColour = (v: unknown): v is Rgb => !!v && typeof v === 'object' && typeof (v as Rgb).srgb === 'string';
const coloursIn = (params: Record<string, unknown> | undefined): Rgb[] => Object.values(params ?? {}).flatMap(v =>
  isColour(v) ? [v] : v && typeof v === 'object' && Array.isArray((v as { stops?: unknown }).stops) ? (v as { stops: { color: unknown }[] }).stops.map(st => st.color).filter(isColour) : []);
const mul = (a: Rgb, b: Rgb): Rgb => ({ srgb: `#${[0, 1, 2].map(i => Math.round(parseInt(a.srgb.slice(1 + 2 * i, 3 + 2 * i), 16) * parseInt(b.srgb.slice(1 + 2 * i, 3 + 2 * i), 16) / 255).toString(16).toUpperCase().padStart(2, '0')).join('')}`, alpha: 1 });
const most = (list: Rgb[]) => list.reduce((a, b) => (chroma(b) > chroma(a) + 1e-9 ? b : a));
/** The most colourful colour a material/light draws: its tint × the colours of the renderers (and particle chains) it feeds. */
function swatchOf(c: ComponentTemplate, id: string): Rgb {
  const node = c.nodes.find(n => n.id === id)!;
  const own = node.params?.[node.type === 'PointLight' ? 'color' : 'tint'];
  const tint = isColour(own) ? own : { srgb: '#FFFFFF', alpha: 1 };
  if (node.type === 'PointLight') return tint;
  const seen = new Set<string>(), found: Rgb[] = [];
  const walk = (nid: string, depth: number) => {
    if (seen.has(nid) || depth > 24) return;
    seen.add(nid);
    found.push(...coloursIn(c.nodes.find(n => n.id === nid)?.params));
    for (const [from, to] of c.edges) if (to.startsWith(`${nid}.particles`)) walk(from.slice(0, from.lastIndexOf('.')), depth + 1);
  };
  for (const [from, to] of c.edges) if (from === `${id}.material`) walk(to.slice(0, to.lastIndexOf('.')), 0);
  return most([tint, ...found.map(f => mul(tint, f))]);
}
/** Swatch of the whole component and its colour parts (none when fewer than two parts). */
export function colourParts(c: ComponentTemplate, ids: string[]): { swatch: string; parts: ColourPart[] } {
  if (!ids.length) return { swatch: '#FFFFFF', parts: [] };
  const swatches = new Map(ids.map(id => [id, swatchOf(c, id)]));
  const type = (id: string) => c.nodes.find(n => n.id === id)!.type;
  const best = (list: string[]) => most(list.map(id => swatches.get(id)!)).srgb;
  const usable = ids.filter(id => partOf(id, type(id)));
  const parts = PART_ORDER.map(key => ({ key, nodes: usable.filter(id => partOf(id, type(id)) === key) }))
    .filter(x => x.nodes.length).map(x => ({ key: x.key, label: partLabel(x.key, c.id), swatch: best(x.nodes), nodes: x.nodes }));
  return { swatch: best(usable.length ? usable : ids), parts: parts.length > 1 ? parts : [] };
}

export function insertComponent(doc: EffectDocumentV2, componentId: string | ComponentTemplate, prefix?: string, opts: { group?: boolean } = {}): { doc: EffectDocumentV2; prefix: string; groupNodeId?: string } {
  const c = typeof componentId === 'string' ? getComponent(componentId) : componentId; // A template object: e.g. an imported asset's (assetComponent.ts).
  const d = structuredClone(doc);
  adoptLayout(d, c);
  const root = d.graphs.find(x => x.id === d.rootGraphId);
  if (!root) throw new Error('Document has no root graph.');
  const grouped = opts.group === true;
  const specs = createRegistry();
  const spec = (type: string) => { const s = [...specs.values()].find(x => x.type === type); if (!s) throw new Error(`Component uses unknown node type "${type}".`); return s; };
  const taken = new Set([...d.graphs.flatMap(x => x.nodes.map(n => n.id)), ...d.graphs.flatMap(x => x.edges.map(e => e.id)), ...d.anchors.map(a => a.id)]);
  let p = prefix ?? c.id;
  for (let i = 2; c.nodes.some(n => taken.has(`${p}-${n.id}`)) || taken.has(`${p}-anchor`) || (grouped && (taken.has(p) || d.graphs.some(x => x.id === `graph-${p}`))); i++) p = `${prefix ?? c.id}-${i}`;
  const child: GraphDefinition | undefined = grouped ? { id: `graph-${p}`, inputs: [], outputs: [], nodes: [], edges: [] } : undefined;
  if (child) { d.graphs.push(child); d.editor.graphs[child.id] = { nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } }; }
  /** Graph a template node lives in: grouped visual nodes go to the child, audio (and everything when flat) to the root. */
  const homeOfType = (type: string) => (child && !isAudioType(type) ? child : root);
  const newNode = (g: GraphDefinition, id: string, type: string, label: string, params: Record<string, ParameterValue>) => {
    const s = spec(type);
    g.nodes.push({ id, type: s.type, definitionVersion: s.definitionVersion, label, enabled: true, randomStreamId: `rs-${id}`, params });
  };

  // Endpoints: Source/Target Anchor nodes (reused in the root; own copies inside a group) and the root EffectOutput.
  const endpoint = new Map<string, string>(), endpointGraph = new Map<string, GraphDefinition>();
  for (const [key, want] of Object.entries(RESERVED)) {
    const g = want.type === 'EffectOutput' ? root : homeOfType(want.type);
    const found = g.nodes.find(n => n.type === want.type && (!want.anchorId || n.params.anchorId === want.anchorId));
    endpointGraph.set(key, g);
    if (found) { endpoint.set(key, found.id); continue; }
    const nid = taken.has(key) || g !== root ? `${p}-${key.replace(/^node-/, '')}` : key;
    newNode(g, nid, want.type, want.anchorId ?? 'Output', want.anchorId ? { anchorId: want.anchorId } : {});
    endpoint.set(key, nid);
    if (want.anchorId && !d.anchors.some(a => a.id === want.anchorId)) d.anchors.push({ id: want.anchorId, name: want.anchorId, position: want.anchorId === 'source' ? [-2, 1, 0] : [2, 1, 0] });
  }
  // One audio chain per document: template AudioMix / AudioOutput nodes reuse the document's existing ones.
  for (const type of ['AudioMix', 'AudioOutput']) {
    const existing = root.nodes.find(n => n.type === type), mine = c.nodes.find(n => n.type === type);
    if (existing && mine) { endpoint.set(mine.id, existing.id); endpointGraph.set(mine.id, root); }
  }
  const anchorIds = new Map(c.anchors.map(a => [a.id, `${p}-${a.id}`]));
  for (const a of c.anchors) d.anchors.push({ id: anchorIds.get(a.id)!, name: `${c.label} ${a.id}`, position: [...a.position] as Vec3 });
  const nodeId = (id: string) => endpoint.get(id) ?? `${p}-${id}`;
  const graphOfTemplate = (id: string) => endpointGraph.get(id) ?? homeOfType(c.nodes.find(n => n.id === id)?.type ?? '');
  const tinted = c.nodes.filter(n => n.type === 'Material' || n.type === 'PointLight');
  const tintScope = tinted.length ? graphOfTemplate(tinted[0].id) : undefined;
  const colours = colourParts(c, tinted.filter(n => graphOfTemplate(n.id) === tintScope).map(n => n.id));
  const partSwatch = new Map(colours.parts.flatMap(pt => pt.nodes.map(id => [id, pt.swatch] as const)));
  const placed = new Map<string, number>();
  c.nodes.forEach(n => {
    if (endpoint.has(n.id)) return; // Reused audio mix/output.
    const g = homeOfType(n.type), id = nodeId(n.id);
    const params = structuredClone(n.params ?? {}) as Record<string, ParameterValue>;
    if (n.type === 'Anchor' && typeof params.anchorId === 'string' && anchorIds.has(params.anchorId)) params.anchorId = anchorIds.get(params.anchorId)!;
    const ps = partSwatch.get(n.id);
    if (ps) { params.recolorFrom = { srgb: ps, alpha: 1 }; params.recolorTo = { srgb: ps, alpha: 1 }; }
    newNode(g, id, n.type, `${c.label}: ${n.id}`, params);
    const layout = d.editor.graphs[g.id]?.nodes;
    if (layout) {
      const i = placed.get(g.id) ?? 0; placed.set(g.id, i + 1);
      const baseY = i === 0 ? Math.max(0, ...Object.values(layout).map(v => v.y)) + (g === root ? 220 : 0) : (layout[`__base_${g.id}`]?.y ?? 0);
      if (i === 0) layout[`__base_${g.id}`] = { x: 0, y: baseY };
      layout[id] = { x: 260 * (i % 6), y: baseY + 170 * Math.floor(i / 6) };
    }
  });
  for (const g of d.graphs) { const l = d.editor.graphs[g.id]?.nodes; if (l) delete l[`__base_${g.id}`]; }

  const addEdge = (g: GraphDefinition, base: string, source: { nodeId: string; port: string }, target: { nodeId: string; port: string }) => {
    if (g.edges.some(e => e.source.nodeId === source.nodeId && e.source.port === source.port && e.target.nodeId === target.nodeId && e.target.port === target.port)) return; // Shared chain already wired.
    const order = g.edges.filter(e => e.target.nodeId === target.nodeId && e.target.port === target.port).length;
    let id = base.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60);
    for (let i = 2; d.graphs.some(x => x.edges.some(e => e.id === id)); i++) id = `${id.replace(/-\d+$/, '')}-${i}`;
    g.edges.push({ id, source, target, order });
  };
  /** Interface output of the child for a crossing link, with its GroupOutput bridge; returns the port id. */
  const exposeOutput = (portId: string, type: string) => {
    if (!child!.outputs.some(o => o.id === portId)) {
      child!.outputs.push({ id: portId, label: portId[0].toUpperCase() + portId.slice(1), type: type as 'visual', cardinality: 'many', required: false, direction: 'output' });
      newNode(child!, `${p}-out-${portId}`, 'GroupOutput', `Out: ${portId}`, { portId });
    }
    return portId;
  };
  const crossings: { port: string; target: { nodeId: string; port: string } }[] = [];
  for (const [from, to] of c.edges) {
    const [fn, fp] = [from.slice(0, from.lastIndexOf('.')), from.slice(from.lastIndexOf('.') + 1)];
    const [tn, tp] = [to.slice(0, to.lastIndexOf('.')), to.slice(to.lastIndexOf('.') + 1)];
    const sg = graphOfTemplate(fn), tg = graphOfTemplate(tn);
    const source = { nodeId: nodeId(fn), port: fp }, target = { nodeId: nodeId(tn), port: tp };
    if (sg === tg) { addEdge(sg, `${p}-e-${fn}-${tn}`, source, target); continue; }
    if (sg !== child) throw new Error(`Component "${c.id}": link ${from} → ${to} would enter the group; not supported.`);
    // Leaving the group: EffectOutput ports keep their name; other links get one port per source output.
    const srcType = c.nodes.find(n => n.id === fn)!.type, portType = spec(srcType).outputs.find(o => o.id === fp)?.type ?? 'event';
    const port = exposeOutput(tn === 'node-output' ? tp : `${fn}-${fp}`.replace(/[^A-Za-z0-9_-]/g, '-'), portType);
    addEdge(child!, `${p}-e-${fn}-out-${port}`, source, { nodeId: `${p}-out-${port}`, port: 'in' });
    crossings.push({ port, target });
  }
  // Start at (user feedback 2026-09-27: components must be sequenceable, e.g. impact after charge): one knob shifts
  // every Schedule of the component together, keeping their authored spacing (binding offset = authored start).
  // Event-triggered Schedules already follow their trigger, so shifting them too would double the delay.
  const scheds = c.nodes.filter(n => n.type === 'Schedule' && !c.edges.some(([, to]) => to === `${n.id}.trigger`));
  if (scheds.length) {
    const offs = scheds.map(n => Number(n.params?.startTicks ?? 0)), scope = graphOfTemplate(scheds[0].id);
    d.controls.push({
      id: `ctl-${p}-start-at`, scopeGraphId: scope.id, label: 'Start at', type: 'integer', unit: 'tick', value: 0, default: 0, min: 0, max: 600 - Math.max(...offs), step: 1,
      section: p === c.id ? c.label : `${c.label} (${p})`, description: 'Delays the whole component (60 ticks = 1 second) so it can play after another one.', editPolicy: 'resample',
      bindings: scheds.map((n, i) => ({ nodeId: nodeId(n.id), parameter: 'startTicks', ...(offs[i] ? { offset: offs[i] } : {}) })),
    });
  }
  // Colour (user 2026-09-29: "why can't I change the colour of the flamethrower?", then "why not as a colour picker?"):
  // one knob rotates every colour of the component — materials (tint, colour over life, texture colours) and lights —
  // around the colour wheel; the editor shows it as a picker of the swatch. Then one full-colour picker per part.
  if (tinted.length) {
    const scope = tintScope!, inScope = tinted.filter(n => graphOfTemplate(n.id) === scope);
    const section = p === c.id ? c.label : `${c.label} (${p})`;
    d.controls.push({
      id: `ctl-${p}-colour-shift`, scopeGraphId: scope.id, label: 'Colour', type: 'number', unit: 'none', value: 0, default: 0, min: -180, max: 180, step: 1,
      section, description: 'Changes the colour of the whole component and keeps its light-to-dark look (a flame keeps its bright core): pick a colour, or turn the wheel in degrees (180 makes orange fire blue).', editPolicy: 'live',
      bindings: inScope.map(n => ({ nodeId: nodeId(n.id), parameter: 'hueShift' })), swatch: colours.swatch,
    });
    for (const part of colours.parts) {
      const value = { srgb: part.swatch, alpha: 1 };
      d.controls.push({
        id: `ctl-${p}-colour-${part.key}`, scopeGraphId: scope.id, label: `${part.label} colour`, type: 'color', unit: 'none', value, default: structuredClone(value),
        section, description: `Colour of just the ${part.label.toLowerCase()}: its most colourful tone becomes the picked colour and the rest follows (hue, richness and brightness). Applied before the whole-component Colour.`, editPolicy: 'live',
        bindings: part.nodes.map(id => ({ nodeId: nodeId(id), parameter: 'recolorTo' })),
      });
    }
  }
  // Knobs become document controls bound to the component's (prefixed) nodes; type/unit/bounds come from
  // the first binding's parameter spec, bounds widened so every scaled binding stays inside its own range.
  for (const k of c.knobs) {
    const first = k.bindings[0], scope = graphOfTemplate(first.node), node = scope.nodes.find(n => n.id === nodeId(first.node))!;
    if (k.bindings.some(b => graphOfTemplate(b.node) !== scope)) throw new Error(`Knob "${k.id}" binds nodes on both sides of the group.`);
    const ps = spec(node.type).parameters.find(x => x.id === first.parameter);
    if (!ps) throw new Error(`Knob "${k.id}" binds unknown parameter ${first.node}.${first.parameter}.`);
    const numeric = ps.type === 'number' || ps.type === 'integer' || first.axis !== undefined;
    const section = p === c.id ? c.label : `${c.label} (${p})`;
    const describe = (b: ComponentKnob['bindings'][number]) => `${b.node}.${b.parameter}${b.axis !== undefined ? `[${'xyz'[b.axis]}]` : ''}${b.scale ? ` ×${b.scale}` : ''}`;
    const bindings = k.bindings.map(b => ({ nodeId: nodeId(b.node), parameter: b.parameter, ...(b.scale ? { scale: b.scale } : {}), ...(b.offset ? { offset: b.offset } : {}), ...(b.axis !== undefined ? { axis: b.axis } : {}) }));
    if (!numeric) {
      d.controls.push({
        id: `ctl-${p}-${k.id}`, scopeGraphId: scope.id, label: k.label, type: ps.type, unit: ps.unit, value: structuredClone(k.value), default: structuredClone(k.value),
        ...(ps.choices ? { choices: ps.choices } : {}), section, description: `${c.label}: ${k.bindings.map(describe).join(', ')}`, editPolicy: ps.editPolicy, bindings,
      });
      continue;
    }
    if (typeof k.value !== 'number') throw new Error(`Knob "${k.id}" binds a number but has a non-number value.`);
    const kv = k.value, s0 = first.scale ?? 1, o0 = first.offset ?? 0;
    const type = first.axis !== undefined ? 'number' : ps.type;
    let min = k.min ?? ((ps.min ?? 0) - o0) / s0, max = k.max ?? ((ps.max ?? Math.max(1, kv * 4)) - o0) / s0;
    for (const b of k.bindings) {
      if (b.axis !== undefined) continue; // Vector parameters carry no per-axis bounds; the knob's own min/max apply.
      const bs = spec(scope.nodes.find(n => n.id === nodeId(b.node))!.type).parameters.find(x => x.id === b.parameter);
      if (bs?.min !== undefined) min = Math.max(min, (bs.min - (b.offset ?? 0)) / (b.scale ?? 1));
      if (bs?.max !== undefined) max = Math.min(max, (bs.max - (b.offset ?? 0)) / (b.scale ?? 1));
    }
    const value = type === 'integer' ? Math.round(kv) : kv;
    d.controls.push({
      id: `ctl-${p}-${k.id}`, scopeGraphId: scope.id, label: k.label, type, unit: ps.unit, value, default: value, min, max,
      ...(type === 'integer' ? { step: 1 } : {}), section, description: `${c.label}: ${k.bindings.map(describe).join(', ')}`,
      editPolicy: ps.editPolicy, bindings,
    });
  }
  if (c.durationTicks > d.durationTicks) d.durationTicks = c.durationTicks;
  if (!child) return { doc: d, prefix: p };

  // Root side: the Group node, wired from each interface output to what the component fed outside.
  const groupId = p;
  newNode(root, groupId, 'Group', c.label, { graphId: child.id });
  for (const x of crossings) addEdge(root, `${p}-e-group-${x.port}`, { nodeId: groupId, port: x.port }, x.target);
  const rl = d.editor.graphs[root.id]?.nodes;
  if (rl) rl[groupId] = { x: -300, y: Math.max(0, ...Object.values(rl).map(v => v.y)) + 160 };
  return { doc: d, prefix: p, groupNodeId: groupId };
}

/** Where a component plays, from which document anchors its template wires (shown when choosing a component). */
export function componentPlacement(componentId: string): string {
  const c = getComponent(componentId);
  const uses = (id: string) => c.edges.some(([from]) => from.startsWith(`${id}.`));
  const viaAnchor = (anchorId: string) => c.nodes.some(n => n.type === 'Anchor' && n.params?.anchorId === anchorId && uses(n.id));
  const s = uses('node-source') || viaAnchor('source'), t = uses('node-target') || viaAnchor('target');
  return s && t ? 'travels from Source to Target' : s ? 'plays at Source' : t ? 'plays at Target' : 'plays at its own position';
}

/**
 * 12 workflow 2 ("Add Impact Burst at arrival/discharge event"): starts an inserted component (Group) when an event
 * fires instead of at a fixed time. Adds a "start" event input to the Group's graph, wires it (GroupInput bridge) to
 * every Schedule inside that has no trigger yet — their authored start ticks become delays after the event, keeping
 * their spacing — and connects `from` (an event output in the Group's parent graph) to it. Never mutates `doc`.
 */
export function startComponentOnEvent(doc: EffectDocumentV2, groupNodeId: string, from: { nodeId: string; port: string }): { ok: true; doc: EffectDocumentV2 } | { ok: false; message: string } {
  const d = structuredClone(doc);
  const parent = d.graphs.find(g => g.nodes.some(n => n.id === groupNodeId));
  const group = parent?.nodes.find(n => n.id === groupNodeId);
  if (!parent || group?.type !== 'Group') return { ok: false, message: `"${groupNodeId}" is not a component (Group) node.` };
  const child = d.graphs.find(g => g.id === group.params.graphId);
  if (!child) return { ok: false, message: 'The component has no internal graph.' };
  if (!parent.nodes.some(n => n.id === from.nodeId)) return { ok: false, message: `Event source "${from.nodeId}" is not next to the component.` };
  const scheds = child.nodes.filter(n => n.type === 'Schedule' && !child.edges.some(e => e.target.nodeId === n.id && e.target.port === 'trigger'));
  if (!scheds.length) return { ok: false, message: 'This component has no timed parts to start from an event.' };
  const taken = new Set(d.graphs.flatMap(g => [...g.nodes.map(n => n.id), ...g.edges.map(e => e.id)]));
  const fresh = (base: string) => { let id = base; for (let i = 2; taken.has(id); i++) id = `${base}-${i}`; taken.add(id); return id; };
  let port = 'start';
  for (let i = 2; child.inputs.some(x => x.id === port); i++) port = `start${i}`;
  child.inputs.push({ id: port, label: 'Start', type: 'event', cardinality: 'one', required: false, direction: 'input' });
  const bridge = fresh(`${groupNodeId}-in-${port}`);
  child.nodes.push({ id: bridge, type: 'GroupInput', definitionVersion: 1, label: 'In: start', enabled: true, randomStreamId: `rs-${bridge}`, params: { portId: port } });
  for (const s of scheds) child.edges.push({ id: fresh(`${bridge}-e-${s.id}`), source: { nodeId: bridge, port: 'out' }, target: { nodeId: s.id, port: 'trigger' }, order: 0 });
  parent.edges.push({ id: fresh(`${groupNodeId}-e-start`), source: { nodeId: from.nodeId, port: from.port }, target: { nodeId: groupNodeId, port }, order: 0 });
  // Start at binds only untriggered Schedules; it now reads as a delay after the event (its bindings stay valid).
  for (const c of d.controls) if (c.label === 'Start at' && c.bindings.some(b => scheds.some(s => s.id === b.nodeId))) { c.label = 'Delay after event'; c.description = 'Delay after the chosen event (60 ticks = 1 second).'; }
  const layout = d.editor.graphs[child.id]?.nodes;
  if (layout) layout[bridge] = { x: -260, y: 0 };
  return { ok: true, doc: d };
}

/** Event outputs in `graphId` a component can start from (PathFollower arrival, Schedule start/end, particle events, component event outputs). */
export function eventSources(doc: EffectDocumentV2, graphId: string): { nodeId: string; port: string; label: string }[] {
  const g = doc.graphs.find(x => x.id === graphId), reg = createRegistry(), out: { nodeId: string; port: string; label: string }[] = [];
  if (!g) return out;
  for (const n of g.nodes) {
    if (n.type === 'Group') {
      const child = doc.graphs.find(x => x.id === n.params.graphId);
      for (const p of child?.outputs ?? []) if (p.type === 'event') out.push({ nodeId: n.id, port: p.id, label: `${n.label || n.id}: ${p.label}` });
      continue;
    }
    const spec = reg.get(`${n.type}@${n.definitionVersion}`);
    for (const p of spec?.outputs ?? []) if (p.type === 'event') out.push({ nodeId: n.id, port: p.id, label: `${n.label || n.id}: ${p.label}` });
  }
  return out;
}
