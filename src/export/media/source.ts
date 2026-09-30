// Loads an effect document into a PreviewViewport the same way the capture page and the editor do (points, paths or
// mixed), so exports show exactly what the preview shows. Browser only (the viewport needs WebGL).
import type { Diagnostic, EffectDocumentV2 } from '../../model/types.ts';
import { compileParticlePreview } from '../../graph/toParticles.ts';
import { compilePathPreview } from '../../graph/toPaths.ts';
import { choosePreviewMode, hasRootAudio } from '../../render/previewMode.ts';
import type { PreviewViewport } from '../../render/PreviewViewport.ts';
import { glowSettings } from '../../graph/glow.ts';

const fmt = (e: Diagnostic[]) => e.map(d => `${d.nodeId ?? ''} ${d.message}`.trim()).join(' | ');

export function loadDocumentIntoViewport(vp: PreviewViewport, d: EffectDocumentV2): { ok: true } | { ok: false; message: string } {
  const opts = { audioHandled: hasRootAudio(d) };
  const mode = choosePreviewMode(d).mode;
  if (mode === 'mixed') {
    const points = compileParticlePreview(d, { ...opts, ribbonsHandled: true }), first = compilePathPreview(d, 0, opts);
    if (!points.ok) return { ok: false, message: fmt(points.errors) };
    if (!first.ok) return { ok: false, message: fmt(first.errors) };
    vp.setMixedSource(points.value, first.value, t => compilePathPreview(d, t, opts));
  } else if (mode === 'paths') {
    const first = compilePathPreview(d, 0, opts);
    if (!first.ok) return { ok: false, message: fmt(first.errors) };
    vp.setPathSource(first.value, t => compilePathPreview(d, t, opts));
  } else {
    const p = compileParticlePreview(d, opts);
    if (!p.ok) return { ok: false, message: fmt(p.errors) };
    vp.setPlan(p.value);
  }
  vp.setGlowSettings(glowSettings(d));
  return { ok: true };
}
