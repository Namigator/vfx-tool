// Headless capture page (WP-MCP2): /capture.html?doc=<url>&tick=<n>[&label=1]. Renders one effect tick
// full-window with the same compilers and PreviewViewport as the editor, then sets document.title to
// "READY <tick>" (or "ERROR ..."). Used by the MCP vfx_render_frames tool through headless Chrome.
import type { Diagnostic } from './model/types.ts';
import { validateDocument } from './model/document.ts';
import { createRegistry } from './graph/registry.ts';
import { compileParticlePreview } from './graph/toParticles.ts';
import { compilePathPreview } from './graph/toPaths.ts';
import { choosePreviewMode, hasRootAudio } from './render/previewMode.ts';
import { PreviewViewport } from './render/PreviewViewport.ts';
import type { FramePointSet } from './render/RibbonGeometry.ts';
import { registerAssetUrl } from './assets/assetUrls.ts';
import { glowSettings } from './graph/glow.ts';

import { soloMask } from './graph/solo.ts';
const q = new URLSearchParams(location.search);
const msg = document.getElementById('msg') as HTMLElement;
const fail = (text: string) => { document.title = `ERROR ${text.slice(0, 200)}`; msg.textContent = text; };
const fmt = (e: Diagnostic[]) => e.map(d => `${d.nodeId ?? ''} ${d.message}`).join(' | ');

async function main(): Promise<void> {
  const url = q.get('doc');
  if (!url) return fail('missing ?doc=');
  const tick = Math.max(0, Math.floor(Number(q.get('tick') ?? '0')));
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return fail(`HTTP ${res.status} for ${url}`);
  const v = validateDocument(JSON.parse(await res.text()), { registry: createRegistry() });
  if (!v.ok) return fail(fmt(v.errors));
  const d = v.value;
  // Bundle assets are served beside the document (the MCP writes them to work/mcp/assets/).
  const base = new URL(url, location.href);
  for (const a of d.assets) if (a.source.kind === 'bundle') registerAssetUrl(a.sha256, new URL(a.source.path, base).href);
  const opts = { audioHandled: hasRootAudio(d) };
  const vp = new PreviewViewport(document.getElementById('view') as HTMLElement, { onError: e => fail(fmt(e)) });
  const mode = choosePreviewMode(d).mode;
  if (mode === 'mixed') {
    const points = compileParticlePreview(d, { ...opts, ribbonsHandled: true }), first = compilePathPreview(d, 0, opts);
    if (!points.ok) return fail(fmt(points.errors));
    if (!first.ok) return fail(fmt(first.errors));
    vp.setMixedSource(points.value, first.value, t => compilePathPreview(d, t, opts));
  } else if (mode === 'paths') {
    const first = compilePathPreview(d, 0, opts);
    if (!first.ok) return fail(fmt(first.errors));
    vp.setPathSource(first.value, t => compilePathPreview(d, t, opts));
  } else {
    const p = compileParticlePreview(d, opts);
    if (!p.ok) return fail(fmt(p.errors));
    vp.setPlan(p.value);
  }
  // 06 Solo (MCP parity with the editor's Outline Solo): solo=<nodeId>,<nodeId> shows only those sinks/components.
  const solo = (q.get('solo') ?? '').split(',').filter(Boolean);
  if (solo.length) vp.setSoloMask(soloMask(d, new Set(solo)));
  vp.setGlow(q.get('glow') !== '0');
  vp.setGlowSettings(glowSettings(d));
  vp.setBackground(q.get('bg') === 'light' ? 'light' : 'dark');
  // Optional matched camera: cam=x,y,z&look=x,y,z[&fov=deg].
  const vec = (s: string | null) => { const v = (s ?? '').split(',').map(Number); return v.length === 3 && v.every(Number.isFinite) ? v as [number, number, number] : undefined; };
  const cam = vec(q.get('cam')), look = vec(q.get('look'));
  if (cam && look) vp.setCameraPose(cam, look, q.get('fov') ? Number(q.get('fov')) : undefined);
  // Auto framing covers the WHOLE effect (every tick, sampled), not just its first moments: growing content (crystals
  // shooting up, expanding rings) is not cut off at late ticks, and every tick of one document renders with the same
  // camera, so frames compare. ?fit=early keeps the preview's own early-sample framing.
  if (!(cam && look) && q.get('fit') !== 'early' && !(Number(q.get('bench')) > 0)) {
    const sets: FramePointSet[] = [], step = Math.max(1, Math.ceil(d.durationTicks / 48));
    for (let t = 0; t < d.durationTicks; t += step) if (vp.exportSeek(t)) vp.exportBounds(sets);
    if (vp.exportSeek(d.durationTicks - 1)) vp.exportBounds(sets);
    vp.exportFit(sets, 0.85);
  }
  // Oblique evidence angles on top of the auto framing: orbit=yawDeg,pitchDeg[,distanceScale] (after the framing settles).
  const orbit = (q.get('orbit') ?? '').split(',').map(Number);
  if (!cam && orbit.length >= 2 && orbit.every(Number.isFinite)) { await new Promise(r => setTimeout(r, 150)); vp.orbitCamera(orbit[0], orbit[1], orbit[2] ?? 1); }
  // Benchmark mode (15/T37): ?bench=seconds[&profile=reference|balanced|economy] plays from the start and records
  // frame intervals; the result lands in window.__benchResult and the title.
  const bench = Number(q.get('bench'));
  if (bench > 0) {
    const profile = q.get('profile');
    if (profile === 'reference' || profile === 'balanced' || profile === 'economy') vp.setQualityProfile(profile);
    await new Promise(r => setTimeout(r, 800)); // Sprite atlases load.
    // Draw every 6th tick synchronously and wait for the GPU: frame cost independent of rAF throttling.
    const costs: number[] = [], cpu: number[] = [];
    for (let t = 0; t < d.durationTicks; t += 6) {
      vp.seek(t);
      const m = [vp.measureFrame(), vp.measureFrame(), vp.measureFrame()].sort((a, b) => a.totalMs - b.totalMs)[1];
      costs.push(m.totalMs); cpu.push(m.cpuMs);
    }
    const sorted = [...costs].sort((a, b) => a - b), avg = costs.reduce((a, b) => a + b, 0) / costs.length;
    const result = { frames: costs.length, avgMs: +avg.toFixed(2), p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2), maxMs: +sorted[sorted.length - 1].toFixed(2), cpuAvgMs: +(cpu.reduce((a, b) => a + b, 0) / cpu.length).toFixed(2), over16ms: costs.filter(c => c > 16.7).length };
    (window as unknown as { __benchResult?: unknown }).__benchResult = result;
    document.title = `BENCH ${JSON.stringify(result)}`;
    return;
  }
  vp.seek(Math.min(tick, d.durationTicks - 1));
  if (q.get('label') === '1') msg.textContent = `${d.name} — tick ${tick}/${d.durationTicks}`;
  // Let sprite atlases finish loading and a few frames present before the screenshot is taken.
  await new Promise(r => setTimeout(r, 1200));
  vp.seek(Math.min(tick, d.durationTicks - 1));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.title = `READY ${tick}`;
}

main().catch(e => fail(e instanceof Error ? e.message : String(e)));
