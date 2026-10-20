// Renders "layer build-up" clips of a component: each clip is the component with only some of its visual layers
// enabled (e.g. charge, then charge + lance, ...), rendered deterministically by the headless media page
// (capture-media.html, the same path as vfx_export_media). For breakdown videos; one job: spec → MP4/PNG files.
//   node --experimental-strip-types tools/render-layer-clips.ts <spec.json>
// Spec: { component, anchors?: {source, target}, outDir, width, height, fps?, glow?, camera?, orbit?, startTick?, endTick?,
//         format?: 'mp4' | 'spritesheet', layers: { <group>: [nodeId, ...] }, clips: [{ name, groups: [<group>...] | 'all' }] }
// Node ids are the component's own ids (without the "<component>-" prefix). Needs the vite dev server (VFX_EDITOR_URL).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { chromeEval } from '../mcp/chromeEval.ts';
import type { EffectDocumentV2, Vec3 } from '../src/model/types.ts';

type Spec = {
  component: string; anchors?: { source: Vec3; target: Vec3 }; outDir: string;
  width: number; height: number; fps?: number; glow?: boolean; format?: 'mp4' | 'spritesheet';
  camera?: { position: Vec3; target: Vec3; fov?: number }; orbit?: { yaw: number; pitch: number; distance?: number };
  startTick?: number; endTick?: number;
  /** Fit the camera once on the full effect (all layers) and render every clip from that same pose. */
  lockCamera?: boolean;
  /** Parameter overrides per node id (component ids, no prefix), e.g. smaller shockwaves for a vertical frame. */
  params?: Record<string, Record<string, unknown>>;
  layers: Record<string, string[]>; clips: { name: string; groups: string[] | 'all' }[];
};
type Pose = { position: Vec3; target: Vec3; fov?: number };
type Payload = { container: string; frameCount: number; width: number; height: number; files: { name: string; base64: string }[]; preview: { base64: string }; camera: Pose };

const spec: Spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const editor = process.env.VFX_EDITOR_URL ?? 'http://127.0.0.1:5174/';
const chrome = process.env.VFX_CHROME ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!chrome) throw new Error('No Chrome/Edge found; set VFX_CHROME.');

const { doc: base } = insertComponent(createBlankDocument(), spec.component, undefined, { group: true });
if (spec.anchors) for (const a of base.anchors) if (a.id === 'source' || a.id === 'target') a.position = [...spec.anchors[a.id]] as Vec3;
const prefix = `${spec.component}-`;
const allLayers = new Set(Object.values(spec.layers).flat());
const known = new Set(base.graphs.flatMap(g => g.nodes.map(n => n.id)));
for (const id of [...allLayers, ...Object.keys(spec.params ?? {})]) if (!known.has(prefix + id)) throw new Error(`node "${id}" is not in component ${spec.component}`);
for (const g of base.graphs) for (const n of g.nodes) {
  const o = spec.params?.[n.id.slice(prefix.length)];
  if (o && n.id.startsWith(prefix)) n.params = { ...(n.params ?? {}), ...structuredClone(o) } as typeof n.params;
}

mkdirSync(spec.outDir, { recursive: true });
mkdirSync('work/mcp', { recursive: true });
/** Renders `doc` with `request` in the headless media page. */
const render = (doc: EffectDocumentV2, request: Record<string, unknown>) => {
  writeFileSync(`work/mcp/${doc.id}.json`, JSON.stringify(doc));
  return chromeEval<Payload>({ chrome, url: new URL(`capture-media.html?doc=/work/mcp/${encodeURIComponent(doc.id)}.json`, editor).href,
    readyTitle: 'MEDIA READY', script: `return await window.__vfxMedia.run(${JSON.stringify(request)});`, gpu: process.env.VFX_MEDIA_GPU === '1' });
};
const range = { ...(spec.startTick !== undefined ? { startTick: spec.startTick } : {}), ...(spec.endTick !== undefined ? { endTick: spec.endTick } : {}) };
let camera: Pose | undefined = spec.camera;
if (spec.lockCamera && !camera) {
  // One tiny frame is enough: the fit pass always samples the whole tick range before rendering.
  const fit = await render({ ...structuredClone(base), id: `layers-${spec.component}-fit` }, { format: 'spritesheet', width: spec.width, height: spec.height, fps: 1,
    ...range, ...(spec.orbit ? { orbit: spec.orbit } : {}), glow: spec.glow ?? true, background: 'dark', name: 'fit' });
  camera = fit.camera;
  console.log(`locked camera: ${JSON.stringify(camera)}`);
}
for (const clip of spec.clips) {
  const on = new Set(clip.groups === 'all' ? [...allLayers] : clip.groups.flatMap(g => spec.layers[g] ?? (() => { throw new Error(`unknown group ${g}`); })()));
  const doc: EffectDocumentV2 = structuredClone(base);
  doc.id = `layers-${spec.component}-${clip.name}`;
  for (const g of doc.graphs) for (const n of g.nodes) {
    const id = n.id.startsWith(prefix) ? n.id.slice(prefix.length) : n.id;
    if (allLayers.has(id)) n.enabled = on.has(id);
  }
  const request = { format: spec.format ?? 'mp4', width: spec.width, height: spec.height, fps: spec.fps ?? 30, glow: spec.glow ?? true, background: 'dark',
    presentation: true, ...range, ...(camera ? { camera } : spec.orbit ? { orbit: spec.orbit } : {}), name: doc.id };
  const t0 = Date.now();
  const r = await render(doc, request);
  const ext = request.format === 'mp4' ? r.container : 'png';
  writeFileSync(join(spec.outDir, `${clip.name}.${ext}`), Buffer.from(r.files[0].base64, 'base64'));
  writeFileSync(join(spec.outDir, `${clip.name}.preview.png`), Buffer.from(r.preview.base64, 'base64'));
  console.log(`${clip.name}: ${on.size} layer nodes on, ${r.frameCount} frames ${r.width}x${r.height} ${ext} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
