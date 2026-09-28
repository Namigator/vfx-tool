// VFX Studio MCP server (19-WORK-PACKAGES "Agent tooling", WP-MCP1 headless core). Tools wrap the same
// pure modules the editor uses — registry, document validation, particle/path/audio compilers and the
// particle runtime — so there is no MCP-only behaviour. Documents live in memory and are mirrored to
// work/mcp/<id>.json after every successful change, which the editor opens via ?workspace=v2&doc=...
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Diagnostic, EffectDocumentV2, NodeDefinition, ParameterValue, Vec3 } from '../src/model/types.ts';
import { validateDocument } from '../src/model/document.ts';
import { createRegistry } from '../src/graph/registry.ts';
import { createBlankDocument, createF01Document, createForcesDemoDocument, createL01Document } from '../src/graph/fixtures.ts';
import { COMPONENT_TEMPLATES, insertComponent } from '../src/graph/components.ts';
import { createL01AudioDocument } from '../src/graph/audioFixtures.ts';
import { compileParticlePreview } from '../src/graph/toParticles.ts';
import { compilePathPreview } from '../src/graph/toPaths.ts';
import { compileAudio } from '../src/graph/toAudio.ts';
import { sampleParticlesAtTick } from '../src/runtime/particles.ts';
import { encodeWavPcm16Stereo } from '../src/audio/wav.ts';
import { createTextureAsset } from '../src/assets/importTexture.ts';
import { createMeshAsset } from '../src/assets/importMesh.ts';
import { buildPack, readPack, type PackAsset } from '../src/model/vfxpack.ts';

export type VfxServerOptions = { root?: string; editorUrl?: string; chromePath?: string };

const CHROME_CANDIDATES = [
  process.env.VFX_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const TEMPLATES = ['blank', 'f01', 'forces', 'lightning', 'lightning-audio'] as const;
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
type Result = { content: Content[]; isError?: boolean };
const ok = (text: string): Result => ({ content: [{ type: 'text', text }] });
const bad = (text: string): Result => ({ content: [{ type: 'text', text }], isError: true });
const fmtErrors = (errors: Diagnostic[]) => errors.map(e => `- [${e.code}]${e.nodeId ? ` ${e.nodeId}` : ''}${e.fieldPath ? ` (${e.fieldPath})` : ''}: ${e.message}`).join('\n');

export function createVfxServer(options: VfxServerOptions = {}): McpServer {
  const root = resolve(options.root ?? process.cwd());
  const editorUrl = options.editorUrl ?? 'http://127.0.0.1:5174/';
  const registry = createRegistry();
  const docs = new Map<string, EffectDocumentV2>();
  const server = new McpServer({ name: 'vfx-studio', version: '0.1.0' });

  const mirrorPath = (id: string) => join(root, 'work', 'mcp', `${id}.json`);
  const persist = (d: EffectDocumentV2) => { mkdirSync(dirname(mirrorPath(d.id)), { recursive: true }); writeFileSync(mirrorPath(d.id), JSON.stringify(d, null, 2)); };
  const getDoc = (id: string) => { const d = docs.get(id); if (!d) throw new Error(`No open document "${id}". Open ones: ${[...docs.keys()].join(', ') || 'none'}.`); return d; };
  const rootGraph = (d: EffectDocumentV2, graphId?: string) => {
    const g = d.graphs.find(x => x.id === (graphId ?? d.rootGraphId));
    if (!g) throw new Error(`Graph "${graphId}" not found.`);
    return g;
  };
  /** Applies a mutation to a copy; commits only if the result passes structural validation. */
  const mutate = (id: string, fn: (d: EffectDocumentV2) => string): Result => {
    const next = structuredClone(getDoc(id));
    const msg = fn(next);
    const v = validateDocument(next, { registry });
    if (!v.ok) return bad(`Rejected (document unchanged):\n${fmtErrors(v.errors)}`);
    docs.set(id, v.value); persist(v.value);
    return ok(msg);
  };
  const tool = <S extends z.ZodRawShape>(name: string, description: string, shape: S, fn: (a: z.infer<z.ZodObject<S>>) => Result | Promise<Result>) =>
    server.registerTool(name, { description, inputSchema: shape }, (async (a: z.infer<z.ZodObject<S>>) => {
      try { return await fn(a); } catch (e) { return bad(e instanceof Error ? e.message : String(e)); }
    }) as never);

  // ---------- catalog ----------
  tool('vfx_list_node_types', 'List registered node types with their ports. Use vfx_describe_node_type for parameters.', { filter: z.string().optional() }, ({ filter }) => {
    const lines = [...registry.values()].filter(s => !filter || s.type.toLowerCase().includes(filter.toLowerCase())).map(s =>
      `${s.type}  in[${s.inputs.map(p => `${p.id}:${p.type}${p.required ? '!' : ''}`).join(', ')}]  out[${s.outputs.map(p => `${p.id}:${p.type}`).join(', ')}]`);
    return ok(lines.join('\n'));
  });
  tool('vfx_describe_node_type', 'Parameters (id, type, unit, default, bounds, choices, description) and ports of one node type.', { type: z.string() }, ({ type }) => {
    const s = [...registry.values()].find(x => x.type === type);
    if (!s) return bad(`Unknown node type "${type}".`);
    return ok(JSON.stringify({ type: s.type, disabledBehavior: s.disabledBehavior, inputs: s.inputs, outputs: s.outputs, parameters: s.parameters }, null, 1));
  });

  // ---------- documents ----------
  tool('vfx_new_document', `Create an in-memory document from a template (${TEMPLATES.join(', ')}). "blank" has Source/Target anchors and an EffectOutput only.`,
    { template: z.enum(TEMPLATES), id: z.string().regex(ID).optional(), name: z.string().optional() }, ({ template, id, name }) => {
      const fresh = template === 'blank' ? createBlankDocument('doc', 'Blank') : template === 'f01' ? createF01Document() : template === 'forces' ? createForcesDemoDocument()
        : template === 'lightning' ? createL01Document() : createL01AudioDocument();
      fresh.id = id ?? `doc-${template}-${docs.size + 1}`;
      if (name) fresh.name = name; else if (template === 'blank') fresh.name = fresh.id;
      const v = validateDocument(fresh, { registry });
      if (!v.ok) return bad(fmtErrors(v.errors));
      docs.set(fresh.id, v.value); persist(v.value);
      return ok(`Created "${fresh.id}" from ${template}. Mirror: work/mcp/${fresh.id}.json`);
    });
  tool('vfx_open_document', 'Open a document JSON file (path relative to the project root) into memory.', { path: z.string() }, ({ path }) => {
    const v = validateDocument(JSON.parse(readFileSync(resolve(root, path), 'utf8')), { registry });
    if (!v.ok) return bad(fmtErrors(v.errors));
    docs.set(v.value.id, v.value); persist(v.value);
    return ok(`Opened "${v.value.id}".`);
  });
  tool('vfx_save_document', 'Write a document to a JSON file (path relative to the project root; default presets/<id>.vfx.json).', { docId: z.string(), path: z.string().optional() }, ({ docId, path }) => {
    const p = resolve(root, path ?? join('presets', `${docId}.vfx.json`));
    mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(getDoc(docId), null, 2));
    return ok(`Saved ${p}`);
  });
  tool('vfx_get_document', 'Readable summary: anchors, nodes (non-default params) and edges. full=true returns the raw JSON.', { docId: z.string(), full: z.boolean().optional() }, ({ docId, full }) => {
    const d = getDoc(docId);
    if (full) return ok(JSON.stringify(d, null, 1));
    const out = [`${d.id} "${d.name}" duration ${d.durationTicks} ticks, seed ${d.seed}`, 'anchors: ' + d.anchors.map(a => `${a.id}=${JSON.stringify(a.position)}`).join(' ')];
    for (const g of d.graphs) {
      out.push(`graph ${g.id}:`);
      for (const n of g.nodes) out.push(`  ${n.id} ${n.type}${n.enabled ? '' : ' (disabled)'}${Object.keys(n.params).length ? ' ' + JSON.stringify(n.params) : ''}`);
      for (const e of g.edges) out.push(`  ${e.id}: ${e.source.nodeId}.${e.source.port} -> ${e.target.nodeId}.${e.target.port}`);
    }
    return ok(out.join('\n'));
  });
  tool('vfx_set_document', 'Set document duration (ticks, 60/s), seed or name.', { docId: z.string(), durationTicks: z.number().int().optional(), seed: z.number().int().optional(), name: z.string().optional() }, a =>
    mutate(a.docId, d => { if (a.durationTicks !== undefined) d.durationTicks = a.durationTicks; if (a.seed !== undefined) d.seed = a.seed; if (a.name !== undefined) d.name = a.name; return 'Updated document settings.'; }));
  tool('vfx_set_anchor', 'Create or move a document anchor (world meters).', { docId: z.string(), anchorId: z.string().regex(ID), position: z.tuple([z.number(), z.number(), z.number()]), name: z.string().optional() }, a =>
    mutate(a.docId, d => {
      const ex = d.anchors.find(x => x.id === a.anchorId);
      if (ex) { ex.position = a.position as Vec3; if (a.name) ex.name = a.name; return `Moved anchor ${a.anchorId}.`; }
      d.anchors.push({ id: a.anchorId, name: a.name ?? a.anchorId, position: a.position as Vec3 }); return `Added anchor ${a.anchorId}.`;
    }));

  // ---------- components ----------
  tool('vfx_list_components', 'Ready-made, pre-wired components (the same list as the editor Add component menu).', {}, () =>
    ok(COMPONENT_TEMPLATES.map(c => `${c.id}: ${c.label} — ${c.description} (${c.nodes.length} nodes)`).join('\n')));
  tool('vfx_add_component', 'Insert a component, auto-wired to its Source/Target anchors and Output. Node ids are prefixed; returns the prefix. group=true wraps its visual nodes in one Group node (own graph "graph-<prefix>", knobs exposed on the Group; sound nodes stay in the root), like the editor.', {
    docId: z.string(), component: z.string(), prefix: z.string().regex(ID).optional(), group: z.boolean().optional(),
  }, a => { let used = '', gid: string | undefined; const r = mutate(a.docId, d => { const x = insertComponent(d, a.component, a.prefix, { group: a.group === true }); used = x.prefix; gid = x.groupNodeId; Object.assign(d, x.doc); return ''; }); return r.isError ? r : ok(`Inserted ${a.component} with prefix "${used}" (node ids "${used}-<node>")${gid ? `; Group node "${gid}" wraps graph "graph-${used}"` : ''}.`); });

  tool('vfx_list_controls', 'Published knobs (document controls) with value, bounds and what they drive.', { docId: z.string() }, ({ docId }) =>
    ok(getDoc(docId).controls.map(c => `${c.id} [${c.section}] ${c.label} = ${JSON.stringify(c.value)} (${c.min ?? '-'}..${c.max ?? '-'} ${c.unit}) -> ${c.bindings.map(b => `${b.nodeId}.${b.parameter}${b.scale ? ' x' + b.scale : ''}`).join(', ')}`).join('\n') || 'No controls.'));
  tool('vfx_set_control', 'Set a published knob by id or label (document validation enforces its bounds). Colour knobs take {srgb:"#RRGGBB",alpha}; vector knobs take [x,y,z].', { docId: z.string(), control: z.string(), value: z.union([z.number(), z.boolean(), z.string(), z.array(z.number()), z.object({ srgb: z.string(), alpha: z.number() })]) }, a =>
    mutate(a.docId, d => {
      const c = d.controls.find(x => x.id === a.control) ?? d.controls.filter(x => x.label === a.control).at(-1);
      if (!c) throw new Error(`No control "${a.control}". Use vfx_list_controls.`);
      c.value = a.value as never;
      return `${c.label} = ${JSON.stringify(a.value)}`;
    }));

  // ---------- graph editing ----------
  tool('vfx_add_node', 'Add a node. Unspecified params use registry defaults. Returns the node id.', {
    docId: z.string(), type: z.string(), id: z.string().regex(ID).optional(), label: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(), enabled: z.boolean().optional(), graphId: z.string().optional(),
  }, a => mutate(a.docId, d => {
    const spec = [...registry.values()].find(s => s.type === a.type);
    if (!spec) throw new Error(`Unknown node type "${a.type}". Use vfx_list_node_types.`);
    const g = rootGraph(d, a.graphId);
    let id = a.id ?? `node-${a.type.toLowerCase()}`;
    if (!a.id) for (let i = 2; g.nodes.some(n => n.id === id); i++) id = `node-${a.type.toLowerCase()}-${i}`;
    if (g.nodes.some(n => n.id === id)) throw new Error(`Node id "${id}" already exists.`);
    const node: NodeDefinition = { id, type: spec.type, definitionVersion: spec.definitionVersion, label: a.label ?? spec.type, enabled: a.enabled ?? true, randomStreamId: `rs-${id}`, params: (a.params ?? {}) as Record<string, ParameterValue> };
    g.nodes.push(node);
    const layout = d.editor.graphs[g.id]?.nodes;
    if (layout) layout[id] = { x: 260 * (Object.keys(layout).length % 7), y: 180 * Math.floor(Object.keys(layout).length / 7) + 320 };
    return `Added ${id} (${spec.type}).`;
  }));
  tool('vfx_remove_node', 'Remove a node and every edge touching it.', { docId: z.string(), nodeId: z.string(), graphId: z.string().optional() }, a => mutate(a.docId, d => {
    const g = rootGraph(d, a.graphId);
    if (!g.nodes.some(n => n.id === a.nodeId)) throw new Error(`No node "${a.nodeId}".`);
    g.nodes = g.nodes.filter(n => n.id !== a.nodeId);
    const before = g.edges.length;
    g.edges = g.edges.filter(e => e.source.nodeId !== a.nodeId && e.target.nodeId !== a.nodeId);
    delete d.editor.graphs[g.id]?.nodes[a.nodeId];
    return `Removed ${a.nodeId} and ${before - g.edges.length} edge(s).`;
  }));
  tool('vfx_set_params', 'Merge parameter values into a node (null resets a param to its default); optionally set enabled/label.', {
    docId: z.string(), nodeId: z.string(), params: z.record(z.string(), z.unknown()).optional(), enabled: z.boolean().optional(), label: z.string().optional(), graphId: z.string().optional(),
  }, a => mutate(a.docId, d => {
    const n = rootGraph(d, a.graphId).nodes.find(x => x.id === a.nodeId);
    if (!n) throw new Error(`No node "${a.nodeId}".`);
    for (const [k, v] of Object.entries(a.params ?? {})) { if (v === null) delete n.params[k]; else n.params[k] = v as ParameterValue; }
    if (a.enabled !== undefined) n.enabled = a.enabled;
    if (a.label !== undefined) n.label = a.label;
    return `Updated ${a.nodeId}.`;
  }));
  tool('vfx_connect', 'Connect "nodeId.port" → "nodeId.port" (output to input).', { docId: z.string(), from: z.string(), to: z.string(), graphId: z.string().optional() }, a => mutate(a.docId, d => {
    const split = (s: string) => { const i = s.lastIndexOf('.'); if (i < 1) throw new Error(`Expected "nodeId.port", got "${s}".`); return { nodeId: s.slice(0, i), port: s.slice(i + 1) }; };
    const g = rootGraph(d, a.graphId), source = split(a.from), target = split(a.to);
    const order = g.edges.filter(e => e.target.nodeId === target.nodeId && e.target.port === target.port).length;
    let id = `edge-${source.nodeId}-${target.nodeId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60);
    for (let i = 2; g.edges.some(e => e.id === id); i++) id = `${id.replace(/-\d+$/, '')}-${i}`;
    g.edges.push({ id, source, target, order });
    return `Connected ${a.from} -> ${a.to} (${id}).`;
  }));
  tool('vfx_disconnect', 'Remove an edge by id, or every edge from "node.port" to "node.port".', { docId: z.string(), edgeId: z.string().optional(), from: z.string().optional(), to: z.string().optional(), graphId: z.string().optional() }, a => mutate(a.docId, d => {
    const g = rootGraph(d, a.graphId), before = g.edges.length;
    g.edges = g.edges.filter(e => !(a.edgeId ? e.id === a.edgeId : `${e.source.nodeId}.${e.source.port}` === a.from && `${e.target.nodeId}.${e.target.port}` === a.to));
    if (g.edges.length === before) throw new Error('No matching edge.');
    return `Removed ${before - g.edges.length} edge(s).`;
  }));

  // ---------- compile / simulate / listen ----------
  tool('vfx_compile', 'Compile particles, paths (at tick 0) and audio; report diagnostics and a summary. Always run after editing.', { docId: z.string() }, ({ docId }) => {
    const d = getDoc(docId), out: string[] = [];
    const p = compileParticlePreview(d, { audioHandled: true, ribbonsHandled: true });
    out.push(p.ok ? `particles OK: ${p.value.systems.length} system(s), ${p.value.layers.length} billboard layer(s), ${p.value.trails.length} trail layer(s)` + p.value.systems.map(s => `\n  ${s.id}: shape ${s.descriptor.shape}, ${s.descriptor.bursts.length} burst(s)${s.descriptor.rate ? `, rate ${s.descriptor.rate.perSecond}/s ticks ${s.descriptor.rate.startTick}-${s.descriptor.rate.endTick}` : ''}, ops [${s.descriptor.operators.map(o => o.kind).join(', ')}]`).join('') : `particles FAILED:\n${fmtErrors(p.errors)}`);
    const r = compilePathPreview(d, 0, { audioHandled: true });
    out.push(r.ok ? `paths OK at tick 0: ${r.value.layers.length} ribbon layer(s)` : `paths FAILED:\n${fmtErrors(r.errors)}`);
    const hasAudio = d.graphs.some(g => g.edges.some(e => e.target.nodeId === 'node-output' && e.target.port === 'audio'));
    if (hasAudio) { const a = compileAudio(d); out.push(a.ok ? `audio OK: ${a.value.kind}, peak ${a.value.mix.postPeak.toFixed(3)}${a.value.mix.severeLimiting ? ' (SEVERE LIMITING)' : ''}` : `audio FAILED:\n${fmtErrors(a.errors)}`); }
    return ok(out.join('\n'));
  });
  tool('vfx_sample_particles', 'Simulate to a tick and report, per particle system, live count, bounding box, mean speed and the first few particles.', { docId: z.string(), tick: z.number().int().min(0), show: z.number().int().min(0).max(50).optional() }, ({ docId, tick, show }) => {
    const p = compileParticlePreview(getDoc(docId), { audioHandled: true, ribbonsHandled: true });
    if (!p.ok) return bad(fmtErrors(p.errors));
    const out: string[] = [];
    for (const s of p.value.systems) {
      const r = sampleParticlesAtTick(s.descriptor, Math.min(tick, s.descriptor.durationTicks));
      if (!r.ok) { out.push(`${s.id}: FAILED\n${fmtErrors(r.errors)}`); continue; }
      const ps = r.value.particles, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      let speed = 0;
      for (const q of ps) { for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], q.position[i]); hi[i] = Math.max(hi[i], q.position[i]); } speed += Math.hypot(...q.velocity); }
      const f = (v: number[]) => `[${v.map(x => x.toFixed(2)).join(', ')}]`;
      out.push(`${s.id}: ${ps.length} live, births total ${r.value.totalBirths}` + (ps.length ? `, bbox ${f(lo)}..${f(hi)}, mean speed ${(speed / ps.length).toFixed(2)} m/s` : ''));
      for (const q of ps.slice(0, show ?? 3)) out.push(`  age ${q.ageTicks}/${q.lifetimeTicks} pos ${f(q.position)} vel ${f(q.velocity)} size ${q.size.toFixed(3)}`);
    }
    return ok(out.join('\n') || 'No particle systems.');
  });
  tool('vfx_render_audio', 'Render the root audio mix to a 48 kHz stereo WAV (default work/mcp/<id>.wav) and report peak/limiting.', { docId: z.string(), path: z.string().optional() }, ({ docId, path }) => {
    const a = compileAudio(getDoc(docId));
    if (!a.ok) return bad(fmtErrors(a.errors));
    const m = a.value.mix, p = resolve(root, path ?? join('work', 'mcp', `${docId}.wav`));
    mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, encodeWavPcm16Stereo(m.left, m.right, m.sampleRate));
    return ok(`Wrote ${p}: ${(m.left.length / m.sampleRate).toFixed(2)} s, pre-peak ${m.prePeak.toFixed(3)}, post-peak ${m.postPeak.toFixed(3)}, limited ${(m.limitedFraction * 100).toFixed(1)}%${m.severeLimiting ? ' SEVERE' : ''}.`);
  });
  // ---------- assets and packs ----------
  // Imported bytes live beside the mirrored documents (work/mcp/assets/<sha256>.<ext>), which is where the
  // capture page and the editor's ?doc= loader look for a document's bundle assets.
  const assetDir = join(root, 'work', 'mcp', 'assets');
  const safeProjectPath = (p: string) => { const abs = resolve(root, p); if (!abs.startsWith(root)) throw new Error(`Path "${p}" is outside the project.`); return abs; };
  tool('vfx_import_texture', 'Import a PNG/static WebP/JPEG (path relative to the project) as a document texture or flipbook asset (≤16 MiB, ≤4096 px; grid 1..16). Optionally set it on a Material (template SpriteTextured, textureAsset). Returns the asset id.', {
    docId: z.string(), path: z.string(), role: z.enum(['color', 'mask']).optional(), rows: z.number().int().min(1).max(16).optional(), columns: z.number().int().min(1).max(16).optional(), materialId: z.string().optional(),
  }, async ({ docId, path, role, rows, columns, materialId }) => {
    const bytes = new Uint8Array(readFileSync(safeProjectPath(path)));
    const grid = (rows ?? 1) * (columns ?? 1) > 1 ? { rows: rows ?? 1, columns: columns ?? 1 } : undefined;
    const r = await createTextureAsset(bytes, { filename: path.split(/[\\/]/).pop() ?? path, role: role ?? 'color', ...(grid ? { flipbook: grid } : {}) });
    if (!r.ok) return bad(r.message);
    const { asset, path: bundlePath } = r.value;
    mkdirSync(assetDir, { recursive: true });
    writeFileSync(join(root, 'work', 'mcp', bundlePath), bytes);
    return mutate(docId, d => {
      if (!d.assets.some(a => a.id === asset.id)) d.assets.push(asset);
      if (materialId) {
        const m = rootGraph(d).nodes.find(n => n.id === materialId);
        if (!m || m.type !== 'Material') throw new Error(`"${materialId}" is not a Material in the root graph.`);
        m.params.template = 'SpriteTextured'; m.params.textureAsset = asset.id;
      }
      return `Imported ${asset.provenance.originalFilename} as ${asset.kind} ${asset.width}×${asset.height} (id ${asset.id})${materialId ? `; set on ${materialId}` : ''}.`;
    });
  });
  tool('vfx_import_mesh', 'Import a self-contained .glb (project path; ≤20 MiB, ≤50k triangles, no animation/cameras/lights) as a mesh asset; optionally set it on a MeshRenderer (meshAsset). The model is fitted to ≈1 m; particle size × Scale sets its size.', {
    docId: z.string(), path: z.string(), rendererId: z.string().optional(),
  }, async ({ docId, path, rendererId }) => {
    const bytes = new Uint8Array(readFileSync(safeProjectPath(path)));
    const r = await createMeshAsset(bytes, path.split(/[\\/]/).pop() ?? path);
    if (!r.ok) return bad(r.message);
    const { asset, path: bundlePath, summary } = r.value;
    mkdirSync(assetDir, { recursive: true });
    writeFileSync(join(root, 'work', 'mcp', bundlePath), bytes);
    return mutate(docId, d => {
      if (!d.assets.some(a => a.id === asset.id)) d.assets.push(asset);
      if (rendererId) {
        const m = rootGraph(d).nodes.find(n => n.id === rendererId);
        if (!m || m.type !== 'MeshRenderer') throw new Error(`"${rendererId}" is not a MeshRenderer in the root graph.`);
        m.params.meshAsset = asset.id;
      }
      return `Imported ${asset.provenance.originalFilename} (${summary.triangles} triangles, id ${asset.id})${rendererId ? `; set on ${rendererId}` : ''}.`;
    });
  });
  tool('vfx_export_pack', 'Write a portable .vfxpack (effect + imported asset bytes + manifest checksums) to a project path (default work/mcp/<id>.vfxpack). draft=true allows missing asset bytes.', {
    docId: z.string(), path: z.string().optional(), draft: z.boolean().optional(),
  }, async ({ docId, path, draft }) => {
    const d = getDoc(docId), bytes = new Map<string, PackAsset>();
    for (const a of d.assets) {
      if (a.source.kind !== 'bundle') continue;
      const f = join(root, 'work', 'mcp', a.source.path);
      if (existsSync(f)) bytes.set(a.sha256, { sha256: a.sha256, mime: a.mime, bytes: new Uint8Array(readFileSync(f)) });
    }
    const r = await buildPack(d, bytes, { draft: draft === true, tool: 'vfx-studio-mcp' });
    if (!r.ok) return bad(r.message);
    const out = safeProjectPath(path ?? `work/mcp/${docId}.vfxpack`);
    mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, r.value);
    return ok(`Wrote ${out} (${r.value.length} bytes).`);
  });
  tool('vfx_open_pack', 'Open a .vfxpack (project path): verifies paths and checksums, restores asset bytes, validates the document and opens it under its document id (or docId).', {
    path: z.string(), docId: z.string().regex(ID).optional(),
  }, async ({ path, docId }) => {
    const r = await readPack(new Uint8Array(readFileSync(safeProjectPath(path))));
    if (!r.ok) return bad(`Pack rejected: ${r.message}`);
    const v = validateDocument(r.value.document, { registry });
    if (!v.ok) return bad(`Pack document is invalid:\n${fmtErrors(v.errors)}`);
    const d = { ...v.value, id: docId ?? v.value.id };
    mkdirSync(assetDir, { recursive: true });
    for (const a of r.value.assets) { const ref = d.assets.find(x => x.sha256 === a.sha256); if (ref && ref.source.kind === 'bundle') writeFileSync(join(root, 'work', 'mcp', ref.source.path), a.bytes); }
    docs.set(d.id, d); persist(d);
    return ok(`Opened "${d.id}" (${r.value.manifest.state}; ${r.value.assets.length} asset file(s)).`);
  });

  tool('vfx_preview_url', 'URL that opens this document in the running editor (vite dev server) for visual inspection.', { docId: z.string() }, ({ docId }) => {
    persist(getDoc(docId));
    return ok(`${editorUrl}?workspace=v2&doc=/work/mcp/${encodeURIComponent(docId)}.json`);
  });
  tool('vfx_render_frames', 'Render effect frames to PNG with headless Chrome (needs the vite dev server) and return the images. Look at them before claiming anything about the visual result.', {
    docId: z.string(), ticks: z.array(z.number().int().min(0)).min(1).max(8), width: z.number().int().min(160).max(1920).optional(), height: z.number().int().min(120).max(1080).optional(), glow: z.boolean().optional(), background: z.enum(['dark', 'light']).optional(),
  }, ({ docId, ticks, width, height, glow, background }) => {
    const d = getDoc(docId); persist(d);
    const chrome = options.chromePath ?? CHROME_CANDIDATES.find(p => p && existsSync(p));
    if (!chrome) return bad('No Chrome/Edge found; set VFX_CHROME to its executable path.');
    const dir = join(root, 'work', 'mcp', 'frames'); mkdirSync(dir, { recursive: true });
    const content: Content[] = [], paths: string[] = [];
    for (const tick of ticks) {
      const out = join(dir, `${docId}-t${tick}${background === 'light' ? '-light' : ''}.png`), profile = mkdtempSync(join(tmpdir(), 'vfx-chrome-'));
      rmSync(out, { force: true });
      const url = new URL(`capture.html?doc=/work/mcp/${encodeURIComponent(docId)}.json&tick=${tick}&label=1${glow === false ? '&glow=0' : ''}${background === 'light' ? '&bg=light' : ''}`, editorUrl).href;
      spawnSync(chrome, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
        `--user-data-dir=${profile}`, `--window-size=${width ?? 960},${height ?? 540}`, '--virtual-time-budget=6000', `--screenshot=${out}`, url], { timeout: 90_000, stdio: 'ignore' });
      rmSync(profile, { recursive: true, force: true });
      if (!existsSync(out)) return bad(`Chrome produced no image for tick ${tick}. Is the dev server running at ${editorUrl}?`);
      content.push({ type: 'image', data: readFileSync(out).toString('base64'), mimeType: 'image/png' }); paths.push(out);
    }
    content.unshift({ type: 'text', text: `Rendered ${ticks.length} frame(s): ${paths.join(', ')}` });
    return { content };
  });
  return server;
}
