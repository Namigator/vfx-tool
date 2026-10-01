import type { EffectDocumentV2 } from '../model/types.ts';
import type { AiFrame } from './types.ts';
import { PreviewViewport } from '../render/PreviewViewport.ts';
import type { FramePointSet } from '../render/RibbonGeometry.ts';
import { loadDocumentIntoViewport } from '../export/media/source.ts';
import { renderCurrentFrame } from '../export/media/render.ts';
import { encodePngRgba } from '../export/media/png.ts';

export async function renderAiFrames(doc: EffectDocumentV2, ticks: number[], signal?: AbortSignal): Promise<AiFrame[]> {
  const cancelled = () => { if (signal?.aborted) throw new Error('AI render cancelled.'); };
  cancelled(); const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:384px;height:216px;pointer-events:none'; document.body.append(host);
  let vp: PreviewViewport | undefined, failure = '';
  try {
    vp = new PreviewViewport(host, { onError: e => { failure = e.map(x => x.message).join('\n'); } });
    const loaded = loadDocumentIntoViewport(vp, doc); if (!loaded.ok) throw new Error(loaded.message);
    vp.beginExport(384, 216);
    const deadline = Date.now() + 15000;
    while (!vp.texturesReady()) { cancelled(); if (Date.now() > deadline) throw new Error('Draft textures did not load within 15 seconds.'); await new Promise(r => setTimeout(r, 50)); }
    const bounds: FramePointSet[] = [];
    for (const tick of ticks) { cancelled(); if (!vp.exportSeek(tick)) throw new Error(failure || 'Draft simulation failed.'); vp.exportBounds(bounds); }
    vp.exportFit(bounds); const frames: AiFrame[] = [];
    for (const tick of ticks) {
      cancelled(); if (!vp.exportSeek(tick)) throw new Error(failure || 'Draft simulation failed.');
      const bytes = encodePngRgba(renderCurrentFrame(vp, { background: 'dark', glow: true }), 384, 216);
      let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      frames.push({ tick, image: `data:image/png;base64,${btoa(binary)}` });
      await new Promise(r => setTimeout(r, 0));
    }
    if (failure) throw new Error(failure); return frames;
  } finally { vp?.dispose(); host.remove(); }
}
