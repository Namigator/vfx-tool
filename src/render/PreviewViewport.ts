// V2 graph preview viewport (WP03-PREVIEW-ADAPTER.md "Visual route"). Point particles only: consumes a
// compiled ParticlePreviewPlan, never a graph document. One ParticleSimulation per plan system, driven by
// PlaybackClock fixed ticks; scrubbing replays from tick 0 so any tick is reproduced deterministically.
// Each layer is one camera-facing instanced quad mesh with a fixed 8192-instance pool, allocated once per
// plan; uploads write into those existing GPU instance buffers. Not allocation-free: each advanced tick
// takes a fresh ParticleSimulation snapshot (new particle state objects). No bloom, textures or sound.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Diagnostic } from '../model/types.ts';
import type { ParticlePreviewLayer, ParticlePreviewPlan } from '../graph/toParticles.ts';
import { DEFAULT_MAX_LIVE_PARTICLES, PARTICLE_DT, ParticleSimulation, type ParticleState } from '../runtime/particles.ts';
import { PlaybackClock } from '../runtime/clock.ts';

export const PREVIEW_POOL_SIZE = DEFAULT_MAX_LIVE_PARTICLES;
/** Largest wall-clock step fed to the clock per frame (tab switches must not jump the preview). */
const MAX_FRAME_SECONDS = 0.25;

export type PreviewFrameInfo = {
  tick: number;
  durationTicks: number;
  playing: boolean;
  /** Paused because the tab was hidden; resumes only on explicit play. */
  suspended: boolean;
  live: number;
  /** First live particle of the first system, namespaced `${systemId}/${particleId}`; '' if none. */
  sampleParticleId: string;
};

export type PreviewViewportCallbacks = {
  /** Called whenever tick/playing changes (not every frame). */
  onFrame?: (info: PreviewFrameInfo) => void;
  /** Runtime failure: output is cleared and playback paused. */
  onError?: (errors: Diagnostic[]) => void;
};

/** Particle IDs are only unique per emitter; namespace them by system when crossing systems. */
export function namespacedParticleId(systemId: string, particleId: string): string {
  return `${systemId}/${particleId}`;
}

export class WebGLUnavailableError extends Error {}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  // Instance matrix carries translation (column 3) and uniform size (column 0.x); quad faces the camera.
  vec4 mv = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
  mv.xy += position.xy * instanceMatrix[0][0];
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uEmission;
uniform float uCutoff;
uniform float uCutout;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = uAlpha * (1.0 - smoothstep(0.6, 1.0, d));
  if (uCutout > 0.5) { if (a < uCutoff) discard; a = 1.0; }
  else if (a <= 0.0) discard;
  gl_FragColor = vec4(uColor * (1.0 + uEmission), a);
  #include <colorspace_fragment>
}`;

type LayerMesh = { layer: ParticlePreviewLayer; mesh: THREE.InstancedMesh; material: THREE.ShaderMaterial };

export class PreviewViewport {
  readonly #container: HTMLElement;
  readonly #callbacks: PreviewViewportCallbacks;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
  readonly #controls: OrbitControls;
  readonly #observer: ResizeObserver;
  readonly #quad = new THREE.PlaneGeometry(1, 1);
  readonly #grid: THREE.GridHelper;
  readonly #ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  #plan: ParticlePreviewPlan | null = null;
  #sims = new Map<string, ParticleSimulation>();
  #snapshots = new Map<string, ParticleState[]>();
  #layers: LayerMesh[] = [];
  #clock: PlaybackClock | null = null;
  #raf = 0;
  #lastTime = -1;
  #lastTick = -1;
  #lastPlaying = false;
  #lastSuspended = false;
  #suspended = false;
  #failed = false;
  #disposed = false;

  constructor(container: HTMLElement, callbacks: PreviewViewportCallbacks = {}) {
    this.#container = container;
    this.#callbacks = callbacks;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (e) {
      throw new WebGLUnavailableError(`WebGL could not be initialised; the v2 preview cannot render. ${e instanceof Error ? e.message : String(e)}`);
    }
    this.#renderer = renderer;
    // Partial construction failure releases everything created so far before rethrowing.
    let controls: OrbitControls | null = null, observer: ResizeObserver | null = null;
    let grid: THREE.GridHelper | null = null, ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
    try {
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setClearColor(0x0b0d12, 1);
      renderer.domElement.className = 'pv2-canvas';
      container.appendChild(renderer.domElement);

      this.#camera.position.set(2.2, 1.6, 3.2);
      controls = new OrbitControls(this.#camera, renderer.domElement);
      controls.target.set(0, 0.5, 0);
      controls.enableDamping = true;
      controls.update();

      grid = new THREE.GridHelper(10, 20, 0x3a4150, 0x1d222c);
      this.#scene.add(grid);
      ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ color: 0x10131a, depthWrite: true }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.001;
      this.#scene.add(ground);

      observer = new ResizeObserver(() => this.#resize());
      observer.observe(container);
    } catch (e) {
      observer?.disconnect();
      controls?.dispose();
      grid?.geometry.dispose();
      (grid?.material as THREE.Material | undefined)?.dispose();
      ground?.geometry.dispose();
      ground?.material.dispose();
      this.#quad.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      this.#disposed = true;
      throw e;
    }
    this.#controls = controls!;
    this.#grid = grid!;
    this.#ground = ground!;
    this.#observer = observer!;
    document.addEventListener('visibilitychange', this.#onVisibility);
    this.#resize();
    this.#raf = requestAnimationFrame(this.#loop);
  }

  /** Hidden tab pauses playback; it stays paused (suspended) until an explicit play/resume. */
  #onVisibility = (): void => {
    if (this.#disposed) return;
    this.#lastTime = -1;
    if (document.hidden && this.#clock?.playing) {
      this.#clock.pause();
      this.#suspended = true;
      this.#emitFrame(true);
    }
  };

  /** Replaces the plan: rebuilds simulations and layer meshes, paused at tick 0. */
  setPlan(plan: ParticlePreviewPlan): void {
    if (this.#disposed) return;
    this.#clearLayers();
    this.#plan = plan;
    this.#clock = new PlaybackClock({ durationTicks: plan.durationTicks });
    this.#failed = false;
    this.#suspended = false;
    plan.layers.forEach((layer, i) => {
      const color = new THREE.Color().setStyle(layer.color.srgb); // sRGB → linear working space.
      const cutout = layer.blend === 'cutout';
      const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uColor: { value: color },
          uAlpha: { value: layer.color.alpha * layer.opacity },
          uEmission: { value: layer.emission },
          uCutoff: { value: layer.alphaCutoff },
          uCutout: { value: cutout ? 1 : 0 },
        },
        transparent: !cutout,
        depthWrite: cutout,
        blending: layer.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const mesh = new THREE.InstancedMesh(this.#quad, material, PREVIEW_POOL_SIZE);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = layer.renderOrderOffset + i * 1e-3;
      this.#scene.add(mesh);
      this.#layers.push({ layer, mesh, material });
    });
    this.#replayTo(0);
  }

  /** Removes all output (e.g. when the document no longer compiles). */
  clearPlan(): void {
    if (this.#disposed) return;
    this.#clearLayers();
    this.#plan = null;
    this.#clock = null;
    this.#suspended = false;
    this.#emitFrame(true);
  }

  play(): void {
    if (this.#disposed || !this.#clock || this.#failed) return;
    this.#suspended = false;
    this.#lastTime = -1; // First playing frame advances by 0, not by a stale wall-clock gap.
    if (this.#clock.ended) this.restart();
    else this.#clock.play();
    this.#emitFrame(true);
  }

  pause(): void {
    if (this.#disposed) return;
    this.#suspended = false;
    this.#clock?.pause();
    this.#emitFrame(true);
  }

  restart(): void {
    if (this.#disposed || !this.#clock) return;
    this.#suspended = false;
    this.#replayTo(0);
    this.#lastTime = -1;
    if (!this.#failed) this.#clock.restart();
    this.#emitFrame(true);
  }

  /** Deterministic scrub: pauses, then replays every simulation from tick 0 to the target tick. */
  seek(tick: number): void {
    if (this.#disposed || !this.#clock || !Number.isFinite(tick)) return;
    this.#suspended = false;
    this.#clock.pause();
    this.#replayTo(Math.max(0, Math.min(this.#clock.durationTicks, Math.round(tick))));
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    document.removeEventListener('visibilitychange', this.#onVisibility);
    cancelAnimationFrame(this.#raf);
    this.#observer.disconnect();
    this.#controls.dispose();
    this.#clearLayers();
    this.#quad.dispose();
    this.#grid.geometry.dispose();
    (this.#grid.material as THREE.Material).dispose();
    this.#ground.geometry.dispose();
    this.#ground.material.dispose();
    this.#renderer.dispose();
    this.#renderer.forceContextLoss();
    this.#renderer.domElement.remove();
  }

  #clearLayers(): void {
    for (const l of this.#layers) {
      this.#scene.remove(l.mesh);
      l.mesh.dispose();
      l.material.dispose();
    }
    this.#layers = [];
    this.#sims.clear();
    this.#snapshots.clear();
  }

  #replayTo(tick: number): void {
    const plan = this.#plan, clock = this.#clock;
    if (!plan || !clock) return;
    this.#failed = false;
    this.#sims.clear();
    for (const s of plan.systems) {
      const created = ParticleSimulation.create(s.descriptor);
      if (!created.ok) return this.#fail(created.errors.map(e => ({ ...e, nodeId: e.nodeId ?? s.id })));
      this.#sims.set(s.id, created.value);
    }
    clock.pause(); // Replays always land paused; restart() resumes explicitly.
    clock.seek(tick);
    for (const [id, sim] of this.#sims) {
      while (sim.tick < tick) {
        const r = sim.advance();
        if (!r.ok) return this.#fail(r.errors.map(e => ({ ...e, nodeId: e.nodeId ?? id })));
      }
    }
    this.#takeSnapshots();
    this.#upload(0);
    this.#emitFrame(true);
  }

  #advanceSims(ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      for (const [id, sim] of this.#sims) {
        if (sim.tick >= sim.descriptor.durationTicks) continue;
        const r = sim.advance();
        if (!r.ok) return this.#fail(r.errors.map(e => ({ ...e, nodeId: e.nodeId ?? id })));
      }
    }
    this.#takeSnapshots();
  }

  /** Allocates new particle state arrays per call (per advanced tick); render buffers are reused. */
  #takeSnapshots(): void {
    for (const [id, sim] of this.#sims) this.#snapshots.set(id, sim.snapshot().particles);
  }

  #fail(errors: Diagnostic[]): void {
    if (this.#disposed) return;
    this.#failed = true;
    this.#suspended = false;
    this.#clock?.pause();
    this.#snapshots.clear();
    for (const l of this.#layers) l.mesh.count = 0;
    this.#callbacks.onError?.(errors);
    if (this.#disposed) return; // The callback may have disposed the viewport.
    this.#emitFrame(true);
  }

  /** Writes particle positions/sizes into existing instance buffers; alpha interpolates within a tick. */
  #upload(alpha: number): void {
    const step = alpha * PARTICLE_DT;
    for (const l of this.#layers) {
      const particles = this.#snapshots.get(l.layer.systemId);
      const n = particles ? Math.min(particles.length, PREVIEW_POOL_SIZE) : 0;
      const m = l.mesh.instanceMatrix.array as Float32Array;
      for (let i = 0; i < n; i++) {
        const p = (particles as ParticleState[])[i];
        const o = i * 16, s = p.size;
        m[o] = s; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
        m[o + 4] = 0; m[o + 5] = s; m[o + 6] = 0; m[o + 7] = 0;
        m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = s; m[o + 11] = 0;
        m[o + 12] = p.position[0] + p.velocity[0] * step;
        m[o + 13] = p.position[1] + p.velocity[1] * step;
        m[o + 14] = p.position[2] + p.velocity[2] * step;
        m[o + 15] = 1;
      }
      l.mesh.count = n;
      l.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  #emitFrame(force: boolean): void {
    const cb = this.#callbacks.onFrame;
    const clock = this.#clock;
    const tick = clock ? clock.tick : 0;
    const playing = clock ? clock.playing : false;
    const suspended = this.#suspended;
    if (this.#disposed || !cb) return;
    if (!force && tick === this.#lastTick && playing === this.#lastPlaying && suspended === this.#lastSuspended) return;
    this.#lastTick = tick;
    this.#lastPlaying = playing;
    this.#lastSuspended = suspended;
    let live = 0;
    for (const ps of this.#snapshots.values()) live += ps.length;
    const first = this.#plan?.systems[0];
    const ps = first ? this.#snapshots.get(first.id) : undefined;
    cb({
      tick, playing, suspended, live,
      durationTicks: clock ? clock.durationTicks : 0,
      sampleParticleId: first && ps && ps.length ? namespacedParticleId(first.id, ps[0].id) : '',
    });
  }

  #loop = (now: number): void => {
    if (this.#disposed) return;
    this.#raf = requestAnimationFrame(this.#loop);
    const dt = this.#lastTime < 0 ? 0 : Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - this.#lastTime) / 1000));
    this.#lastTime = now;
    const clock = this.#clock;
    if (clock && clock.playing && !this.#failed) {
      const r = clock.advance(dt);
      if (r.ticksAdvanced > 0) this.#advanceSims(r.ticksAdvanced);
      if (!this.#failed) this.#upload(clock.alpha);
    }
    this.#emitFrame(false);
    if (this.#disposed) return; // onFrame may have disposed the viewport; never render after dispose.
    this.#controls.update();
    this.#renderer.render(this.#scene, this.#camera);
  };

  #resize(): void {
    if (this.#disposed) return;
    const w = Math.max(1, this.#container.clientWidth), h = Math.max(1, this.#container.clientHeight);
    this.#renderer.setSize(w, h, false);
    this.#camera.aspect = w / h;
    this.#camera.updateProjectionMatrix();
  }
}
