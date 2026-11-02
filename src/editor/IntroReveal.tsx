import { useEffect, useRef } from 'react';
import type { PreviewViewport } from '../render/PreviewViewport.ts';
import introText from '../intro/intro.json?raw';

type IntroConfig = { camera: { position: [number, number, number]; target: [number, number, number]; fov: number }; handoffTick: number; afterPreset: string };
export const INTRO: IntroConfig = JSON.parse(introText);

type Props = {
  viewport: () => PreviewViewport | null;
  /** True once the intro effect has compiled. */
  ready: boolean;
  /** Called once the portal has widened past the screen (or the visitor skipped); the editor takes over. */
  onFinish: () => void;
};

/**
 * Drives the first-visit intro: the editor's own viewport (made full-screen by the pv2-intro-on class) plays the
 * Portal effect head-on with the floor hidden, then hands over at INTRO.handoffTick. Any click or key hands over at once.
 * Renders nothing; the effect itself is an ordinary VFX Studio document (src/intro/portal.vfx.json).
 */
export function IntroReveal({ viewport, ready, onFinish }: Props) {
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  useEffect(() => {
    let raf = 0, posed = false, done = false;
    const finish = () => { if (done) return; done = true; cancelAnimationFrame(raf); finishRef.current(); };
    const frame = () => {
      const vp = viewport();
      if (vp && readyRef.current) {
        if (!posed) {
          posed = true;
          const c = INTRO.camera;
          vp.setGrid(false);
          vp.setFloor(false);
          vp.setLoop(false);
          vp.setCameraPose(c.position, c.target, c.fov);
        }
        if (vp.currentTick >= INTRO.handoffTick) { finish(); return; }
        // A recompile while sounds and textures arrive stops playback; keep it going.
        if (!vp.isPlaying) vp.play();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener('keydown', finish);
    window.addEventListener('pointerdown', finish);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', finish); window.removeEventListener('pointerdown', finish); };
  }, [viewport]);

  return null;
}
