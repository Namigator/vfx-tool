// Export media renderer (browser only): steps an effect tick by tick in an offscreen PreviewViewport, reads every
// frame back and hands it to the format's encoder. Deterministic and not real time: each frame is a seek + draw +
// readback, never a recording of the live canvas. Shared by the editor's Export media dialog and the capture page that
// the MCP tool drives.
import type { EffectDocumentV2, Vec3 } from '../../model/types.ts';
import { PreviewViewport } from '../../render/PreviewViewport.ts';
import type { FramePointSet } from '../../render/RibbonGeometry.ts';
import { loadDocumentIntoViewport } from './source.ts';
import { resolveMediaOptions, sheetSidecar, mediaExtension, type MediaOptions, type MediaFormat, type SheetSidecar } from './layout.ts';
import { acesSrgb, applyFlash, compositeChecker, hexToBytes, matteFrame, opaqueFrame } from './matte.ts';
import { downscaleRgba, encodePngRgba } from './png.ts';
import { encodeGif, encodePngSequenceZip, packSheet } from './encoders.ts';
import { planVideo, startVideo } from './video.ts';

export type CameraSpec = 'fit' | { position: Vec3; target: Vec3; fov?: number };
export type MediaRequest = Partial<MediaOptions> & {
  format: MediaFormat;
  camera?: CameraSpec;
  /** With camera "fit": keep the automatic framing but look from another direction (yaw/pitch degrees, distance multiplier). */
  orbit?: { yaw: number; pitch: number; distance?: number };
  /** File base name without extension (default: the document id). */
  name?: string;
  /** Solid backgrounds include the effect's camera shake and screen flash (default true); transparent frames never do. */
  presentation?: boolean;
};
export type MediaHooks = { onProgress?: (done: number, total: number, phase: string) => void; cancelled?: () => boolean };
export type MediaFile = { name: string; mime: string; bytes: Uint8Array };
export type PreviewFrame = { tick: number; width: number; height: number; rgba: Uint8ClampedArray };
export type MediaResult = {
  files: MediaFile[];
  format: MediaFormat;
  /** The container actually written (mp4 can fall back to webm). */
  container: string;
  frameCount: number; width: number; height: number; fps: number; ticks: number[];
  options: MediaOptions;
  sidecar?: SheetSidecar;
  notes: string[];
  /** A few evenly spaced frames (straight RGBA8) for contact strips / previews. */
  previews: PreviewFrame[];
  timing: { renderMs: number; encodeMs: number };
};

export class ExportCancelled extends Error { constructor() { super('Export cancelled.'); } }

/** The dark arena colour (0x0b0d12) and light arena colour (0xb9bec8) in sRGB. */
const ARENA: Record<'dark' | 'light', number> = { dark: 0x0b0d12, light: 0xb9bec8 };
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const arenaLinear = (k: 'dark' | 'light'): [number, number, number] => [(ARENA[k] >> 16) & 255, (ARENA[k] >> 8) & 255, ARENA[k] & 255].map(v => srgbToLinear(v / 255)) as [number, number, number];
const BLACK: [number, number, number] = [0, 0, 0], WHITE: [number, number, number] = [1, 1, 1];
const tick = () => new Promise<void>(r => setTimeout(r, 0));
const FIT_SAMPLES = 48, PREVIEW_COUNT = 8, REFINE_SAMPLES = 48;

export function safeBaseName(s: string): string { return (s || 'effect').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'effect'; }

/**
 * Renders one frame at the viewport's current tick. Transparent frames use difference matting (see matte.ts); solid
 * frames are the editor's own output on the chosen arena colour, including camera shake and screen flash.
 */
export function renderCurrentFrame(vp: PreviewViewport, o: Pick<MediaOptions, 'background' | 'glow'> & { presentation?: boolean }): Uint8ClampedArray {
  if (o.background === 'transparent') {
    // The display render sits on the dark arena so the matte reproduces it exactly when composited over that colour.
    const arena = arenaLinear('dark');
    const display = vp.exportRender({ background: arena, bloom: o.glow, linear: false }).data;
    const linBlack = vp.exportRender({ background: BLACK, bloom: false, linear: true }).data;
    const linWhite = vp.exportRender({ background: WHITE, bloom: false, linear: true }).data;
    return matteFrame(display, linBlack, linWhite, undefined, acesSrgb(arena));
  }
  const r = vp.exportRender({ background: arenaLinear(o.background), bloom: o.glow, linear: false, presentation: o.presentation !== false });
  const px = opaqueFrame(r.data);
  if (r.flash) applyFlash(px, hexToBytes(r.flash.color), r.flash.alpha);
  return px;
}

async function waitForTextures(vp: PreviewViewport, ms = 15_000): Promise<void> {
  const t0 = Date.now();
  while (!vp.texturesReady() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 100));
}

/** Fill of the frame the visible bounds should reach after the image-based fit (the rest is margin for the glow). */
const FIT_FILL = 0.82;
/** A pixel counts as part of the effect when some scene-linear channel (glow off, black background) exceeds this. */
const VISIBLE_THRESHOLD = 0.12;
/** ... or when it covers at least this much of the background (0..1), so dim smoke counts too. */
const VISIBLE_COVERAGE = 0.12;

async function refineFit(vp: PreviewViewport, ticks: number[], o: MediaOptions, width: number, height: number, check: () => void): Promise<void> {
  const k = 160 / Math.max(width, height), w = Math.max(16, Math.round(width * k)), h = Math.max(16, Math.round(height * k));
  const step = Math.max(1, Math.ceil(ticks.length / REFINE_SAMPLES));
  vp.exportResize(w, h);
  try {
    for (let iter = 0; iter < 3; iter++) {
      // Lit-pixel counts per column and row over all sampled ticks; the extent ignores the sparsest 0.4 % at each end so a
      // few stray embers or sparks do not decide the framing.
      const cols = new Float64Array(w), rows = new Float64Array(h);
      let lit = 0;
      for (let i = 0; i < ticks.length; i += step) {
        check();
        if (!vp.exportSeek(ticks[i])) continue;
        // Lit = emits light or covers the background (dim smoke has coverage but little light), measured without glow.
        const k = vp.exportRender({ background: BLACK, bloom: false, linear: true }).data, wt = vp.exportRender({ background: WHITE, bloom: false, linear: true }).data;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const j = (y * w + x) * 4, cov = 1 - ((wt[j] - k[j]) + (wt[j + 1] - k[j + 1]) + (wt[j + 2] - k[j + 2])) / 3;
          if (cov > VISIBLE_COVERAGE || Math.max(k[j], k[j + 1], k[j + 2]) > VISIBLE_THRESHOLD) { cols[x]++; rows[y]++; lit++; }
        }
        if ((i / step) % 6 === 5) await tick();
      }
      if (lit < 4) return; // nothing visible: keep the analytic framing
      const span = (hist: Float64Array): [number, number] => {
        const cut = lit * 0.004;
        let a = 0, acc = 0;
        while (a < hist.length - 1 && acc + hist[a] <= cut) acc += hist[a++];
        let z = hist.length - 1; acc = 0;
        while (z > a && acc + hist[z] <= cut) acc += hist[z--];
        return [a, z];
      };
      const [x0, x1] = span(cols), [y0, y1] = span(rows);
      const cx = (x0 + x1 + 1) / 2 - w / 2, cy = (y0 + y1 + 1) / 2 - h / 2, halfW = (x1 - x0 + 1) / 2, halfH = (y1 - y0 + 1) / 2;
      const scale = Math.max(halfW / (w / 2), halfH / (h / 2)) / FIT_FILL;
      if (Math.abs(scale - 1) < 0.05 && Math.abs(cx) < w * 0.03 && Math.abs(cy) < h * 0.03) break; // already framed
      vp.exportShiftZoom(cx / (w / 2), -cy / (h / 2), scale);
    }
  } finally { vp.exportResize(width, height); }
}

export async function renderMedia(doc: EffectDocumentV2, request: MediaRequest, hooks: MediaHooks = {}): Promise<MediaResult> {
  const resolved = resolveMediaOptions(request, doc.durationTicks);
  if (!resolved.ok) throw new Error(resolved.message);
  const { options, ticks, layout } = resolved, { width, height } = options, total = ticks.length;
  const notes: string[] = [];
  const base = safeBaseName(request.name ?? doc.id);
  const progress = (done: number, phase: string) => hooks.onProgress?.(done, total, phase);
  const check = () => { if (hooks.cancelled?.()) throw new ExportCancelled(); };

  // Video: settle the codec first so an unsupported browser fails before any rendering.
  let videoPlan: Awaited<ReturnType<typeof planVideo>> | null = null;
  if (options.format === 'mp4' || options.format === 'webm') {
    videoPlan = await planVideo(options.format, width, height, options.fps);
    if ('error' in videoPlan) throw new Error(videoPlan.error);
    if (videoPlan.note) notes.push(videoPlan.note);
  }

  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: '320px', height: '240px', overflow: 'hidden', pointerEvents: 'none' });
  document.body.appendChild(host);
  let failure = '';
  const vp = new PreviewViewport(host, { onError: e => { failure = e.map(d => `${d.nodeId ?? ''} ${d.message}`.trim()).join(' | '); } });
  const t0 = performance.now();
  let encodeMs = 0;
  try {
    const loaded = loadDocumentIntoViewport(vp, doc);
    if (!loaded.ok) throw new Error(loaded.message);
    vp.setGlow(options.glow);
    await waitForTextures(vp);
    vp.beginExport(width, height);

    // ---- camera ----
    const cam = request.camera ?? 'fit';
    if (cam === 'fit') {
      const o = request.orbit;
      if (o) vp.orbitCamera(o.yaw, o.pitch, 1);
      const sets: FramePointSet[] = [], step = Math.max(1, Math.ceil(total / FIT_SAMPLES));
      for (let i = 0; i < total; i += step) {
        check();
        if (!vp.exportSeek(ticks[i])) throw new Error(`The effect failed at tick ${ticks[i]}: ${failure || 'see the editor diagnostics'}`);
        vp.exportBounds(sets);
        if ((i / step) % 8 === 7) { progress(0, 'framing'); await tick(); }
      }
      // Always include the last exported frame.
      if (vp.exportSeek(ticks[total - 1])) vp.exportBounds(sets);
      if (!vp.exportFit(sets)) notes.push('The effect drew nothing to frame; the default camera was used.');
      // Stage 2: the analytic bounds are conservative (padded by the largest sprite, drifting smoke and embers), so refine
      // from the pixels that actually show: render small previews across the tick range, measure the lit bounding box and
      // re-centre / zoom until it fills the frame. Glow is left out of the measurement (its soft halo would always reach the edges).
      await refineFit(vp, ticks, options, width, height, check);
      if (o?.distance && o.distance !== 1) {
        const p = vp.cameraPose(), k = o.distance;
        vp.setCameraPose([p.target[0] + (p.position[0] - p.target[0]) * k, p.target[1] + (p.position[1] - p.target[1]) * k, p.target[2] + (p.position[2] - p.target[2]) * k], p.target);
      }
    } else vp.setCameraPose(cam.position, cam.target, cam.fov);

    // ---- frames ----
    const frames: Uint8ClampedArray[] = [], pngs: Uint8Array[] = [], previewIdx = new Set(Array.from({ length: Math.min(PREVIEW_COUNT, total) }, (_, i) => Math.round((i * (total - 1)) / Math.max(1, Math.min(PREVIEW_COUNT, total) - 1))));
    const previews: PreviewFrame[] = [];
    const video = videoPlan && !('error' in videoPlan) ? startVideo(videoPlan, width, height, options.fps) : null;
    try {
      for (let i = 0; i < total; i++) {
        check();
        if (!vp.exportSeek(ticks[i])) throw new Error(`The effect failed at tick ${ticks[i]}: ${failure || 'see the editor diagnostics'}`);
        const px = renderCurrentFrame(vp, { ...options, presentation: request.presentation });
        if (previewIdx.has(i)) previews.push({ tick: ticks[i], width, height, rgba: new Uint8ClampedArray(px) });
        if (options.format === 'png-sequence') { const s = performance.now(); pngs.push(encodePngRgba(px, width, height, 4)); encodeMs += performance.now() - s; }
        else if (video) { const s = performance.now(); await video.addFrame(px, i); encodeMs += performance.now() - s; }
        else frames.push(px);
        progress(i + 1, 'rendering');
        if (i % 2 === 1) await tick();
      }
      check();
      const s = performance.now();
      progress(total, 'encoding');
      await tick();
      const files: MediaFile[] = [];
      let sidecar: SheetSidecar | undefined, container: string = mediaExtension(options.format);
      if (options.format === 'spritesheet' && layout) {
        const sheet = packSheet(frames, width, height, layout.columns);
        const name = `${base}.png`;
        sidecar = sheetSidecar(layout, options, name, doc.name);
        files.push({ name, mime: 'image/png', bytes: encodePngRgba(sheet.rgba, sheet.width, sheet.height, 6) }, { name: `${base}.json`, mime: 'application/json', bytes: new TextEncoder().encode(JSON.stringify(sidecar, null, 2)) });
      } else if (options.format === 'png-sequence') {
        files.push({ name: `${base}_png.zip`, mime: 'application/zip', bytes: encodePngSequenceZip(pngs, base) });
      } else if (options.format === 'gif') {
        files.push({ name: `${base}.gif`, mime: 'image/gif', bytes: encodeGif(frames, width, height, { fps: options.fps, loop: options.loop, transparent: options.background === 'transparent' }) });
      } else if (video && videoPlan && !('error' in videoPlan)) {
        container = videoPlan.container;
        files.push({ name: `${base}.${videoPlan.container}`, mime: videoPlan.container === 'mp4' ? 'video/mp4' : 'video/webm', bytes: await video.finish() });
      }
      encodeMs += performance.now() - s;
      return { files, format: options.format, container, frameCount: total, width, height, fps: options.fps, ticks, options, ...(sidecar ? { sidecar } : {}), notes, previews, timing: { renderMs: performance.now() - t0 - encodeMs, encodeMs } };
    } catch (e) { video?.abort(); throw e; }
  } finally {
    try { vp.endExport(); } catch { /* disposed below */ }
    vp.dispose();
    host.remove();
  }
}

/** One picture of a finished export for humans: the sheet itself, or a strip of the preview frames, over a checkerboard when transparent. */
export function previewPicture(result: MediaResult, maxSide = 1024): { png: Uint8Array; width: number; height: number } {
  const transparent = result.options.background === 'transparent';
  const cell = Math.max(64, Math.floor(maxSide / Math.min(4, Math.max(1, result.previews.length)))), cols = Math.min(4, result.previews.length), rows = Math.ceil(result.previews.length / cols);
  const cw = Math.min(cell, result.width), ch = Math.round(cw * (result.height / result.width));
  const out = new Uint8ClampedArray(cols * cw * rows * ch * 4);
  result.previews.forEach((p, i) => {
    const s = downscaleRgba(p.rgba, p.width, p.height, cw), shown = transparent ? compositeChecker(s.data, s.width, s.height, 6) : s.data;
    const ox = (i % cols) * cw, oy = Math.floor(i / cols) * ch, W = cols * cw;
    for (let y = 0; y < s.height && y < ch; y++) out.set(shown.subarray(y * s.width * 4, (y + 1) * s.width * 4), ((oy + y) * W + ox) * 4);
  });
  return { png: encodePngRgba(out, cols * cw, rows * ch, 3), width: cols * cw, height: rows * ch };
}
