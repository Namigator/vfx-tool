import { useEffect, useRef } from 'react';
import { PreviewViewport } from '../render/PreviewViewport.ts';
import { loadDocumentIntoViewport } from '../export/media/source.ts';
import type { EffectDocumentV2 } from '../model/types.ts';
import introText from '../intro/intro.json?raw';

type IntroConfig = {
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number };
  handoffTick: number; openSeconds: number; holeInset: number;
};
export const INTRO: IntroConfig = JSON.parse(introText);

type Props = {
  /** The Portal effect (src/intro/portal.vfx.json, built with the MCP tools). */
  portal: EffectDocumentV2;
  /** Called when the portal has opened over the whole page (or the visitor skipped). */
  onFinish: () => void;
};

type Key = { x: number; y: number };
const sample = (keys: Key[], x: number) => {
  if (x <= keys[0].x) return keys[0].y;
  for (let i = 1; i < keys.length; i++) if (x <= keys[i].x) { const a = keys[i - 1], b = keys[i]; return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x); }
  return keys[keys.length - 1].y;
};

/** The ring's world radius over effect seconds and the second its trace completes, read from the Portal document. */
function ringOf(portal: EffectDocumentV2) {
  const nodes = portal.graphs.find(g => g.id === portal.rootGraphId)?.nodes ?? [];
  const param = (id: string, key: string) => (nodes.find(n => n.id === id)?.params as Record<string, unknown> | undefined)?.[key];
  const grow = (param('grow', 'curve') as { keys: Key[] } | undefined)?.keys ?? [{ x: 0, y: 1 }];
  const trace = (param('trace', 'curve') as { keys: Key[] } | undefined)?.keys ?? [{ x: 0, y: 1 }];
  const radius = Number(param('ring', 'radius') ?? 1);
  return { radiusAt: (s: number) => radius * sample(grow, s), traced: trace[trace.length - 1].x };
}

/**
 * First-visit intro over the loaded editor: a black cover, and on top of it a second viewport playing the Portal
 * effect, screen-blended so only its light shows. Once the ring has traced itself, a hole the size of the ring
 * opens in the cover, so the editor shows through the circle, and it widens with the ring until the editor is
 * uncovered. Any click or key ends it.
 */
export function IntroReveal({ portal, onFinish }: Props) {
  const coverRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  useEffect(() => {
    const cover = coverRef.current, host = hostRef.current;
    if (!cover || !host) return;
    let vp: PreviewViewport | null = null, raf = 0, done = false, started = false;
    const finish = () => { if (done) return; done = true; finishRef.current(); };
    try {
      vp = new PreviewViewport(host, {});
      const loaded = loadDocumentIntoViewport(vp, portal);
      if (!loaded.ok) throw new Error(loaded.message);
      vp.setBackground('black');
      vp.setGrid(false);
      vp.setFloor(false);
      vp.setLoop(false);
      vp.setCameraPose(INTRO.camera.position, INTRO.camera.target, INTRO.camera.fov);
    } catch { finish(); return () => vp?.dispose(); }
    const ring = ringOf(portal);
    const view = Math.tan((INTRO.camera.fov * Math.PI) / 360) * Math.hypot(...INTRO.camera.position.map((p, i) => p - INTRO.camera.target[i]) as [number, number, number]);
    const frame = () => {
      const v = vp!;
      if (!started && v.texturesReady()) { started = true; v.play(); }
      if (started && !v.isPlaying && v.currentTick < INTRO.handoffTick) v.play(); // a recompile can stop it
      const s = v.currentTick / 60;
      // World radius -> CSS pixels: the camera looks straight at the ring, `view` metres span half the height.
      const px = (ring.radiusAt(s) / view) * (innerHeight / 2);
      const open = Math.min(1, Math.max(0, (s - ring.traced) / INTRO.openSeconds));
      const hole = px * INTRO.holeInset * (1 - Math.pow(1 - open, 3));
      cover.style.setProperty('--intro-hole', `${hole.toFixed(1)}px`);
      if (v.currentTick >= INTRO.handoffTick || hole > Math.hypot(innerWidth, innerHeight) / 2 + 20) { finish(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener('keydown', finish);
    window.addEventListener('pointerdown', finish);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', finish);
      window.removeEventListener('pointerdown', finish);
      vp?.dispose();
    };
  }, [portal]);

  return (
    <div className="pv2-intro" aria-hidden="true">
      <div ref={coverRef} className="pv2-intro-cover" />
      <div ref={hostRef} className="pv2-intro-portal" />
    </div>
  );
}
