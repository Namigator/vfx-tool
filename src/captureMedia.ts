// Headless media-export page (MCP vfx_export_media): /capture-media.html?doc=<url>. Loads the document, then exposes
// window.__vfxMedia.run(request) for the DevTools protocol to call; the result carries the files as base64. The title
// becomes "MEDIA READY" once the page can take requests (or "ERROR ..." if the document cannot be loaded).
import { validateDocument } from './model/document.ts';
import { createRegistry } from './graph/registry.ts';
import { registerAssetUrl } from './assets/assetUrls.ts';
import type { EffectDocumentV2 } from './model/types.ts';
import { previewPicture, renderMedia, type MediaRequest, type MediaResult } from './export/media/render.ts';
import { compositeOver, meanAbsDifference } from './export/media/matte.ts';
import { downscaleRgba, encodePngRgba } from './export/media/png.ts';

const msg = document.getElementById('msg') as HTMLElement;
let doc: EffectDocumentV2 | null = null;

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function run(request: MediaRequest & { verifyMatte?: boolean }) {
  if (!doc) throw new Error('No document loaded.');
  const result: MediaResult = await renderMedia(doc, request, { onProgress: (d, t, phase) => { msg.textContent = `${phase} ${d}/${t}`; } });
  const pic = previewPicture(result);
  return {
    container: result.container, frameCount: result.frameCount, width: result.width, height: result.height, fps: result.fps, ticks: result.ticks,
    notes: result.notes, timing: result.timing, sidecar: result.sidecar ?? null,
    files: result.files.map(f => ({ name: f.name, mime: f.mime, bytes: f.bytes.length, base64: b64(f.bytes) })),
    preview: { width: pic.width, height: pic.height, base64: b64(pic.png) },
  };
}

/**
 * Self-check of the transparent export: renders the same tick twice (transparent and solid dark), composites the
 * transparent frame over the dark frame's own background pixel and reports the mean absolute difference per channel.
 */
async function verifyMatte(ticksAt: number[], size: number, glow: boolean) {
  if (!doc) throw new Error('No document loaded.');
  const out: { tick: number; meanAbsDiff: number; bg: number[]; bands: unknown[] }[] = [];
  // The empty dark arena as displayed: a corner pixel of the last tick of the effect, when nothing is left to glow.
  const empty = await renderMedia(doc, { width: size, height: size, startTick: doc.durationTicks - 1, endTick: doc.durationTicks, fps: 60, glow, camera: 'fit', presentation: false, format: 'spritesheet', background: 'dark' });
  const bg = [empty.previews[0].rgba[0], empty.previews[0].rgba[1], empty.previews[0].rgba[2]] as [number, number, number];
  const shots: Record<string, string> = {};
  for (const t of ticksAt) {
    const base = { width: size, height: size, startTick: t, endTick: t + 1, fps: 60, glow, camera: 'fit' as const, presentation: false };
    const a = await renderMedia(doc, { ...base, format: 'spritesheet', background: 'transparent' });
    const b = await renderMedia(doc, { ...base, format: 'spritesheet', background: 'dark' });
    const ta = a.previews[0], db = b.previews[0];
    const comp = compositeOver(ta.rgba, bg);
    const bands = [0, 0.02, 0.1, 0.4, 1.01].slice(0, 4).map(() => ({ n: 0, sum: 0 })), edges = [0, 0.02, 0.1, 0.4, 1.01];
    for (let i = 0; i < comp.length; i += 4) {
      const al = ta.rgba[i + 3] / 255, bi = edges.findIndex((e, k) => al >= e && al < edges[k + 1]);
      if (bi >= 0 && bi < 4) { bands[bi].n++; bands[bi].sum += (Math.abs(comp[i] - db.rgba[i]) + Math.abs(comp[i + 1] - db.rgba[i + 1]) + Math.abs(comp[i + 2] - db.rgba[i + 2])) / 3; }
    }
    { let n = 0; const sd = [0, 0, 0], sc = [0, 0, 0]; for (let i = 0; i < comp.length; i += 4) if (ta.rgba[i + 3] === 0) { n++; for (let c = 0; c < 3; c++) { sd[c] += db.rgba[i + c]; sc[c] += comp[i + c]; } } shots[`t${t}-zeroalpha`] = b64(new TextEncoder().encode(JSON.stringify({ n, direct: sd.map(v => +(v / n).toFixed(2)), comp: sc.map(v => +(v / n).toFixed(2)) }))); }
    out.push({ tick: t, meanAbsDiff: meanAbsDifference(comp, db.rgba), bg, bands: bands.map((b, k) => ({ alpha: `${edges[k]}-${edges[k + 1]}`, pixels: b.n, meanDiff: b.n ? +(b.sum / b.n).toFixed(2) : 0 })) });
    shots[`t${t}-direct`] = b64(encodePngRgba(db.rgba, db.width, db.height, 3));
    shots[`t${t}-matte-over-dark`] = b64(encodePngRgba(comp, ta.width, ta.height, 3));
    shots[`t${t}-transparent`] = b64(encodePngRgba(ta.rgba, ta.width, ta.height, 3));
  }
  void downscaleRgba;
  return { results: out, shots };
}

async function main(): Promise<void> {
  const url = new URLSearchParams(location.search).get('doc');
  if (!url) throw new Error('missing ?doc=');
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const v = validateDocument(JSON.parse(await res.text()), { registry: createRegistry() });
  if (!v.ok) throw new Error(v.errors.map(d => `${d.nodeId ?? ''} ${d.message}`).join(' | '));
  doc = v.value;
  const base = new URL(url, location.href);
  for (const a of doc.assets) if (a.source.kind === 'bundle') registerAssetUrl(a.sha256, new URL(a.source.path, base).href);
  (window as unknown as { __vfxMedia: unknown }).__vfxMedia = { run, verifyMatte };
  document.title = 'MEDIA READY';
  msg.textContent = `${doc.name}: ready`;
}

main().catch(e => { document.title = `ERROR ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`; msg.textContent = String(e); });
