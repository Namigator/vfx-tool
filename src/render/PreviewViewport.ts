// V2 graph preview viewport (WP03-PREVIEW-ADAPTER.md "Visual route"). Point particles only: consumes a
// compiled ParticlePreviewPlan, never a graph document. One ParticleSimulation per plan system, driven by
// PlaybackClock fixed ticks; scrubbing replays from tick 0 so any tick is reproduced deterministically.
// Each layer is one camera-facing instanced quad mesh with a fixed 8192-instance pool, allocated once per
// plan; uploads write into those existing GPU instance buffers. Not allocation-free: each advanced tick
// takes a fresh ParticleSimulation snapshot (new particle state objects). No bloom, textures or sound.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
//
// Path mode (setPathSource): a document with RibbonRenderer sinks is recompiled per tick by the caller's
// compile function (pure, deterministic per tick, so scrubbing needs no replay). Each layer owns one
// RibbonGeometry + mesh, created once per source from the tick-0 plan and rebuilt only when the layer
// set changes; billboard sides are recomputed when the camera moves.
//
// Mixed mode (setMixedSource): point simulations and a path source share one clock; render order of
// both layer kinds comes from layerRenderOrder(renderOrderOffset, visualOrder).
import type { Diagnostic, ValidationResult, Vec3 } from '../model/types.ts';
import type { ParticlePreviewLayer, ParticlePreviewPlan } from '../graph/toParticles.ts';
import { compileLifeCurve, lifeFraction, sampleLifeCurve, type LifeCurveSampler } from './billboardLife.ts';
import { MAX_PREVIEW_POINTS, type PathPreviewLayer, type PathPreviewPlan } from '../graph/toPaths.ts';
import { DEFAULT_MAX_LIVE_PARTICLES, PARTICLE_DT, ParticleSimulation, type ParticleState } from '../runtime/particles.ts';
import { PlaybackClock } from '../runtime/clock.ts';
import { framePoints, RibbonGeometry, ribbonSoftness, type FramePointSet } from './RibbonGeometry.ts';
import { pathViewDirection } from './pathView.ts';
import { layerRenderOrder } from './layerOrder.ts';

/** Fraction of the preview half-extent path framing fills (leaves a margin, never clips). */
const PATH_FRAME_FILL = 0.85;
/** Point-mode camera pose; restored when a point plan follows path framing. */
const DEFAULT_CAMERA: Vec3 = [2.2, 1.6, 3.2];
const DEFAULT_TARGET: Vec3 = [0, 0.5, 0];
const DEFAULT_NEAR = 0.01, DEFAULT_FAR = 200;

export const PREVIEW_POOL_SIZE = DEFAULT_MAX_LIVE_PARTICLES;
/** Largest wall-clock step fed to the clock per frame (tab switches must not jump the preview). */
const MAX_FRAME_SECONDS = 0.25;

export type PreviewFrameInfo = {
  tick: number;
  durationTicks: number;
  playing: boolean;
  /** Paused because the tab was hidden; resumes only on explicit play. */
  suspended: boolean;
  /** Live particles plus drawn ribbon paths (mixed mode counts both). */
  live: number;
  mode: 'points' | 'paths' | 'mixed' | 'none';
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
attribute float lifeOpacity;
varying vec2 vUv;
varying float vLifeOpacity;
void main() {
  vUv = uv;
  vLifeOpacity = lifeOpacity;
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
varying float vLifeOpacity;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = uAlpha * vLifeOpacity * (1.0 - smoothstep(0.6, 1.0, d));
  if (uCutout > 0.5) { if (a < uCutoff) discard; a = 1.0; }
  else if (a <= 0.0) discard;
  gl_FragColor = vec4(uColor * (1.0 + uEmission), a);
  #include <colorspace_fragment>
}`;

const RIBBON_VERTEX = /* glsl */ `
attribute float opacity;
attribute float side;
varying float vOpacity;
varying float vSide;
void main() {
  vOpacity = opacity;
  vSide = side;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const RIBBON_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uEmission;
uniform float uCutoff;
uniform float uCutout;
uniform float uSoftness;
varying float vOpacity;
varying float vSide;
void main() {
  // Transverse falloff: full on the centreline, fading to 0 at the strip edge over the outer
  // uSoftness fraction (1 = whole half-width, soft glow; 0 = hard edge).
  float s = abs(vSide);
  float edge = uSoftness > 0.0 ? 1.0 - smoothstep(1.0 - uSoftness, 1.0, s) : 1.0;
  float a = uAlpha * vOpacity * edge;
  if (uCutout > 0.5) { if (a < uCutoff) discard; a = 1.0; }
  else if (a <= 0.0) discard;
  gl_FragColor = vec4(uColor * (1.0 + uEmission), a);
  #include <colorspace_fragment>
}`;

type LayerMesh = { layer: ParticlePreviewLayer; mesh: THREE.InstancedMesh; material: THREE.ShaderMaterial; sizeSampler: LifeCurveSampler; opacitySampler: LifeCurveSampler };
type RibbonMesh = { nodeId: string; ribbon: RibbonGeometry; mesh: THREE.Mesh; material: THREE.ShaderMaterial };

/** Per-tick path compile supplied by the caller (e.g. `t => compilePathPreview(doc, t)`). */
export type PathCompile = (tick: number) => ValidationResult<PathPreviewPlan>;

/** Blend/colour/opacity/emission uniforms and state shared by point and ribbon materials. */
function materialFor(
  vertexShader: string, fragmentShader: string,
  m: { color: { srgb: string; alpha: number }; opacity: number; emission: number; blend: 'normal' | 'additive' | 'cutout'; alphaCutoff: number },
): THREE.ShaderMaterial {
  const cutout = m.blend === 'cutout';
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uColor: { value: new THREE.Color().setStyle(m.color.srgb) }, // sRGB → linear working space.
      uAlpha: { value: m.color.alpha * m.opacity },
      uEmission: { value: m.emission },
      uCutoff: { value: m.alphaCutoff },
      uCutout: { value: cutout ? 1 : 0 },
    },
    transparent: !cutout,
    depthWrite: cutout,
    blending: m.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/** Layer set identity: meshes are rebuilt only when these change between ticks. */
function ribbonKey(layers: readonly PathPreviewLayer[]): string {
  return JSON.stringify(layers.map(l => [l.nodeId, l.color, l.opacity, l.emission, l.blend, l.alphaCutoff, l.renderOrderOffset, l.visualOrder]));
}

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
  #pathCompile: PathCompile | null = null;
  #pathPlan: PathPreviewPlan | null = null;
  #ribbons: RibbonMesh[] = [];
  #ribbonKey = '';
  #ribbonCamera = new THREE.Vector3(Number.NaN, 0, 0);
  #drawnPaths = 0;
  /** Tick-0 path points framed on entering path mode; refit on resize until cleared. */
  #frameSets: FramePointSet[] | null = null;
  /** Set once the user orbits/zooms; path sources then keep the user's direction. */
  #userOrbited = false;
  /** Camera was moved by path framing; point plans restore the default pose. */
  #pathCamera = false;
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

      this.#camera.position.set(...DEFAULT_CAMERA);
      controls = new OrbitControls(this.#camera, renderer.domElement);
      controls.target.set(...DEFAULT_TARGET);
      controls.enableDamping = true;
      controls.update();
      // Once the user orbits/zooms, resizes stop refitting the path frame.
      controls.addEventListener('start', () => { this.#frameSets = null; this.#userOrbited = true; });

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
    if (this.#pathCamera) this.#resetCamera(); // Point preview never inherits the path framing.
    this.#clock = new PlaybackClock({ durationTicks: plan.durationTicks });
    this.#failed = false;
    this.#suspended = false;
    this.#addPointLayers(plan);
    this.#replayTo(0);
  }

  /**
   * Path mode: `plan` is the caller's already-validated tick-0 compile; `compile` produces later ticks.
   * Starts paused at tick 0. Replaces any point plan.
   */
  setPathSource(plan: PathPreviewPlan, compile: PathCompile): void {
    if (this.#disposed) return;
    this.#clearLayers();
    this.#resetCamera();
    this.#plan = null;
    this.#clock = new PlaybackClock({ durationTicks: plan.durationTicks });
    this.#failed = false;
    this.#suspended = false;
    this.#beginPathSource(plan, compile);
    this.#emitFrame(true);
  }

  /**
   * Mixed mode: point simulations and a per-tick path source share one clock (the longer duration).
   * Replay/scrub rebuilds the simulations from tick 0 and recompiles the path tick, so both are
   * deterministic. Layers of both kinds are ordered globally by `visualOrder`. Starts paused at tick 0.
   */
  setMixedSource(points: ParticlePreviewPlan, paths: PathPreviewPlan, compile: PathCompile): void {
    if (this.#disposed) return;
    this.#clearLayers();
    this.#resetCamera();
    this.#clock = new PlaybackClock({ durationTicks: Math.max(points.durationTicks, paths.durationTicks) });
    this.#failed = false;
    this.#suspended = false;
    this.#addPointLayers(points);
    this.#beginPathSource(paths, compile);
    this.#replayTo(0);
  }

  #addPointLayers(plan: ParticlePreviewPlan): void {
    this.#plan = plan;
    for (const layer of plan.layers) {
      const material = materialFor(VERTEX, FRAGMENT, layer);
      // Per-layer geometry: the per-instance opacity attribute cannot live on the shared quad.
      const geometry = this.#quad.clone();
      const lifeOpacity = new THREE.InstancedBufferAttribute(new Float32Array(PREVIEW_POOL_SIZE).fill(1), 1);
      lifeOpacity.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('lifeOpacity', lifeOpacity);
      const mesh = new THREE.InstancedMesh(geometry, material, PREVIEW_POOL_SIZE);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = layerRenderOrder(layer.renderOrderOffset, layer.visualOrder);
      this.#scene.add(mesh);
      this.#layers.push({ layer, mesh, material, sizeSampler: compileLifeCurve(layer.sizeOverLife), opacitySampler: compileLifeCurve(layer.opacityOverLife) });
    }
  }

  /** Frames the tick-0 paths and uploads them; the caller owns the clock and emits the frame. */
  #beginPathSource(plan: PathPreviewPlan, compile: PathCompile): void {
    this.#pathCompile = compile;
    const sets: FramePointSet[] = [];
    for (const layer of plan.layers) if (layer.active) {
      for (const p of layer.paths) if (p.points.length) sets.push({ points: p.points, pad: (layer.width * p.widthScale) / 2 });
    }
    this.#frameSets = sets.length ? sets : null;
    // Broadside initial view until the user orbits; later edits keep their orbit direction.
    if (sets.length && !this.#userOrbited) {
      const cam = this.#camera, target = this.#controls.target;
      const d = pathViewDirection(sets.map(s => s.points));
      cam.position.set(target.x + d[0], target.y + d[1], target.z + d[2]);
    }
    this.#framePaths();
    this.#applyPathPlan(plan);
  }

  /** Restores the point-mode camera pose, clip planes and orbit target. */
  #resetCamera(): void {
    this.#camera.position.set(...DEFAULT_CAMERA);
    this.#controls.target.set(...DEFAULT_TARGET);
    this.#camera.near = DEFAULT_NEAR;
    this.#camera.far = DEFAULT_FAR;
    this.#camera.updateProjectionMatrix();
    this.#controls.update();
    this.#pathCamera = false;
    this.#userOrbited = false;
  }

  /** Fits the tick-0 path points into the view, keeping the current orbit direction. */
  #framePaths(): void {
    const sets = this.#frameSets;
    if (!sets) return;
    const cam = this.#camera, target = this.#controls.target;
    const dir = cam.position.clone().sub(target);
    const f = framePoints(sets, { viewDirection: [dir.x, dir.y, dir.z], fovDeg: cam.fov, aspect: cam.aspect, fill: PATH_FRAME_FILL });
    if (!f) return;
    this.#pathCamera = true;
    target.set(f.target[0], f.target[1], f.target[2]);
    cam.position.set(f.position[0], f.position[1], f.position[2]);
    cam.near = Math.max(1e-4, f.distance / 1000);
    cam.far = Math.max(200, f.distance * 10);
    cam.updateProjectionMatrix();
    this.#controls.update();
  }

  /** Removes all output (e.g. when the document no longer compiles). */
  clearPlan(): void {
    if (this.#disposed) return;
    this.#clearLayers();
    this.#plan = null;
    this.#pathCompile = null;
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
      l.mesh.geometry.dispose(); // Per-layer quad clone carrying the lifeOpacity attribute.
      l.material.dispose();
    }
    this.#layers = [];
    this.#sims.clear();
    this.#snapshots.clear();
    this.#clearRibbons();
    this.#pathCompile = null;
    this.#pathPlan = null;
    this.#drawnPaths = 0;
    this.#frameSets = null;
  }

  #clearRibbons(): void {
    for (const r of this.#ribbons) {
      this.#scene.remove(r.mesh);
      r.ribbon.dispose();
      r.material.dispose();
    }
    this.#ribbons = [];
    this.#ribbonKey = '';
  }

  /** Compiles the path source at `tick` and uploads it; compile/geometry errors stop playback. */
  #pathTick(tick: number): void {
    const compile = this.#pathCompile;
    if (!compile) return;
    let r: ValidationResult<PathPreviewPlan>;
    try {
      r = compile(tick);
    } catch (e) {
      return this.#fail([{ code: 'INVALID_VALUE', severity: 'error', message: `Path preview failed at tick ${tick}: ${e instanceof Error ? e.message : String(e)}` }]);
    }
    if (!r.ok) return this.#fail(r.errors);
    this.#applyPathPlan(r.value);
  }

  /** (Re)builds ribbon meshes when the layer set changed, then rebuilds geometry for the current camera. */
  #applyPathPlan(plan: PathPreviewPlan): void {
    this.#pathPlan = plan;
    const key = ribbonKey(plan.layers);
    if (key !== this.#ribbonKey) {
      this.#clearRibbons();
      for (const layer of plan.layers) {
        const ribbon = new RibbonGeometry({ maxPoints: MAX_PREVIEW_POINTS });
        const material = materialFor(RIBBON_VERTEX, RIBBON_FRAGMENT, layer);
        material.side = THREE.DoubleSide; // Camera-facing strips can wind either way.
        material.uniforms.uSoftness = { value: ribbonSoftness(layer.blend) };
        const mesh = new THREE.Mesh(ribbon.geometry, material);
        mesh.renderOrder = layerRenderOrder(layer.renderOrderOffset, layer.visualOrder);
        this.#scene.add(mesh);
        this.#ribbons.push({ nodeId: layer.nodeId, ribbon, mesh, material });
      }
      this.#ribbonKey = key;
    }
    this.#updateRibbons();
  }

  /** Billboards every ribbon toward the current camera position. */
  #updateRibbons(): void {
    const plan = this.#pathPlan;
    if (!plan || this.#failed) return;
    const c = this.#camera.position;
    const cameraPosition: Vec3 = [c.x, c.y, c.z];
    let drawn = 0, i = 0;
    try {
      for (; i < plan.layers.length; i++) {
        const layer = plan.layers[i];
        // Inactive (outside window) layers carry no paths and draw nothing.
        drawn += this.#ribbons[i].ribbon.update(layer.active ? layer.paths : [], { cameraPosition, width: layer.width, endFade: layer.endFade }).drawnPaths;
      }
    } catch (e) {
      const nodeId = plan.layers[i]?.nodeId;
      return this.#fail([{ code: e instanceof RangeError ? 'BUDGET_EXCEEDED' : 'INVALID_VALUE', severity: 'error', message: `Ribbon geometry failed: ${e instanceof Error ? e.message : String(e)}`, ...(nodeId ? { nodeId } : {}) }]);
    }
    this.#drawnPaths = drawn;
    this.#ribbonCamera.copy(c);
  }

  /** Rebuilds point simulations from tick 0 and/or recompiles the path tick; lands paused. */
  #replayTo(tick: number): void {
    const plan = this.#plan, clock = this.#clock;
    if (!clock || (!plan && !this.#pathCompile)) return;
    this.#failed = false;
    clock.pause(); // Replays always land paused; restart() resumes explicitly.
    clock.seek(tick);
    if (plan) {
      this.#sims.clear();
      for (const s of plan.systems) {
        const created = ParticleSimulation.create(s.descriptor);
        if (!created.ok) return this.#fail(created.errors.map(e => ({ ...e, nodeId: e.nodeId ?? s.id })));
        this.#sims.set(s.id, created.value);
      }
      for (const [id, sim] of this.#sims) {
        // Mixed clocks may outlast a system; stop at its own duration as #advanceSims does.
        const end = Math.min(tick, sim.descriptor.durationTicks);
        while (sim.tick < end) {
          const r = sim.advance();
          if (!r.ok) return this.#fail(r.errors.map(e => ({ ...e, nodeId: e.nodeId ?? id })));
        }
      }
      this.#takeSnapshots();
      this.#upload(0);
    }
    this.#pathTick(tick);
    if (!this.#failed) this.#emitFrame(true);
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
    // Path mode keeps its compile function (restart/scrub retry) but drops all ribbon output.
    this.#clearRibbons();
    this.#pathPlan = null;
    this.#drawnPaths = 0;
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
      const opAttr = l.mesh.geometry.getAttribute('lifeOpacity') as THREE.InstancedBufferAttribute;
      const op = opAttr.array as Float32Array;
      for (let i = 0; i < n; i++) {
        const p = (particles as ParticleState[])[i];
        const u = lifeFraction(p.ageTicks, p.lifetimeTicks, alpha);
        const o = i * 16, s = p.size * sampleLifeCurve(l.sizeSampler, u);
        op[i] = sampleLifeCurve(l.opacitySampler, u);
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
      opAttr.needsUpdate = true;
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
    let live = this.#drawnPaths;
    for (const ps of this.#snapshots.values()) live += ps.length;
    const first = this.#plan?.systems[0];
    const ps = first ? this.#snapshots.get(first.id) : undefined;
    const mode = this.#pathCompile ? (this.#plan ? 'mixed' : 'paths') : this.#plan ? 'points' : 'none';
    cb({
      tick, playing, suspended, live, mode,
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
      if (r.ticksAdvanced > 0 && this.#plan) this.#advanceSims(r.ticksAdvanced);
      // Paths are a pure function of the tick: compile only the landing tick, no interpolation.
      if (r.ticksAdvanced > 0 && !this.#failed) this.#pathTick(clock.tick);
      if (this.#plan && !this.#failed) this.#upload(clock.alpha);
    }
    this.#emitFrame(false);
    if (this.#disposed) return; // onFrame may have disposed the viewport; never render after dispose.
    this.#controls.update();
    // Re-billboard ribbons when orbiting (damping keeps moving the camera after input stops).
    if (this.#pathPlan && !this.#camera.position.equals(this.#ribbonCamera)) this.#updateRibbons();
    if (this.#disposed) return;
    this.#renderer.render(this.#scene, this.#camera);
  };

  #resize(): void {
    if (this.#disposed) return;
    const w = Math.max(1, this.#container.clientWidth), h = Math.max(1, this.#container.clientHeight);
    this.#renderer.setSize(w, h, false);
    this.#camera.aspect = w / h;
    this.#camera.updateProjectionMatrix();
    this.#framePaths();
  }
}
