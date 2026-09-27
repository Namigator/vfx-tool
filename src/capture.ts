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
  vp.setGlow(q.get('glow') !== '0');
  vp.seek(Math.min(tick, d.durationTicks - 1));
  if (q.get('label') === '1') msg.textContent = `${d.name} — tick ${tick}/${d.durationTicks}`;
  // Let sprite atlases finish loading and a few frames present before the screenshot is taken.
  await new Promise(r => setTimeout(r, 1200));
  vp.seek(Math.min(tick, d.durationTicks - 1));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.title = `READY ${tick}`;
}

main().catch(e => fail(e instanceof Error ? e.message : String(e)));
