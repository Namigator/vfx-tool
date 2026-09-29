// V2 graph preview viewport (WP03-PREVIEW-ADAPTER.md "Visual route"). Point particles only: consumes a
// compiled ParticlePreviewPlan, never a graph document. One ParticleSimulation per plan system, driven by
// PlaybackClock fixed ticks; scrubbing replays from tick 0 so any tick is reproduced deterministically.
// Each layer is one camera-facing instanced quad mesh with a fixed 8192-instance pool, allocated once per
// plan; uploads write into those existing GPU instance buffers. Not allocation-free: each advanced tick
// takes a fresh ParticleSimulation snapshot (new particle state objects). No bloom, textures or sound.
import * as THREE from 'three';
import { ASSET_FILE_PREFIX } from '../assets/importTexture.ts';
import { whenAssetUrl } from '../assets/assetUrls.ts';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
//
// Path mode (setPathSource): a document with RibbonRenderer sinks is recompiled per tick by the caller's
// compile function (pure, deterministic per tick, so scrubbing needs no replay). Each layer owns one
// RibbonGeometry + mesh, created once per source from the tick-0 plan and rebuilt only when the layer
// set changes; billboard sides are recomputed when the camera moves.
//
// Mixed mode (setMixedSource): point simulations and a path source share one clock; render order of
// both layer kinds comes from layerRenderOrder(renderOrderOffset, visualOrder).
import type { Diagnostic, ValidationResult, Vec3 } from '../model/types.ts';
import type { MeshLayer, ParticlePreviewLayer, ParticlePreviewPlan, ParticleTrailLayer, PointLightLayer } from '../graph/toParticles.ts';
import { createBuiltinMesh, type BuiltinMesh } from './builtinMeshes.ts';
import { valueNoise4 } from '../runtime/noise.ts';
import { spriteCellBlend } from '../assets/spriteLibrary.ts';
import { TrailHistory } from './particleTrails.ts';
import { fnv1a32Utf8 } from '../runtime/random.ts';
import { compileLifeCurve, compileLifeGradient, lifeFraction, sampleLifeCurve, sampleLifeGradient, type LifeCurveSampler, type LifeGradientSampler } from './billboardLife.ts';
import { MAX_PREVIEW_POINTS, type PathPreviewLayer, type PathPreviewPlan } from '../graph/toPaths.ts';
import { DEFAULT_MAX_LIVE_PARTICLES, PARTICLE_DT, ParticleSimulation, type ParticleState } from '../runtime/particles.ts';
import { PlaybackClock } from '../runtime/clock.ts';
import { DEFAULT_RIBBON_END_FADE, framePoints, RibbonGeometry, ribbonSoftness, ribbonWidthShape, type FramePointSet } from './RibbonGeometry.ts';
import { pathViewDirection } from './pathView.ts';
import { collectTimelineFrameSets, particleFrameSets } from './pathFraming.ts';
import { layerRenderOrder } from './layerOrder.ts';

/** Fraction of the preview half-extent path framing fills (leaves a margin, never clips). */
const PATH_FRAME_FILL = 0.85;
/** Point-mode camera pose; restored when a point plan follows path framing. */
const DEFAULT_CAMERA: Vec3 = [2.2, 1.6, 3.2];
const DEFAULT_TARGET: Vec3 = [0, 0.5, 0];
const DEFAULT_NEAR = 0.01, DEFAULT_FAR = 200;

export const PREVIEW_POOL_SIZE = DEFAULT_MAX_LIVE_PARTICLES;
/** 15 hard limits enforced while drawing. */
export const MAX_MESH_INSTANCES = 512, MAX_MESH_TRIANGLES = 250_000, MAX_TRAIL_SAMPLES = 65_536;
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
  /** 07 "Catching up": playback frames recently took longer than the simulation can follow in real time (shown for 1 s). */
  catchingUp?: boolean;
};

export type PreviewViewportCallbacks = {
  /** Called whenever tick/playing changes (not every frame). */
  onFrame?: (info: PreviewFrameInfo) => void;
  /** Runtime failure: output is cleared and playback paused. */
  onError?: (errors: Diagnostic[]) => void;
  /** WP24: the GPU context was lost (true) or restored (false); the viewport pauses drawing meanwhile. */
  onContextLost?: (lost: boolean) => void;
  /** Loop mode wrapped playback back to tick 0 (same seed); e.g. restart synced sound. */
  onLoop?: () => void;
};

/** Particle IDs are only unique per emitter; namespace them by system when crossing systems. */
export function namespacedParticleId(systemId: string, particleId: string): string {
  return `${systemId}/${particleId}`;
}

/** Seek checkpoint spacing (12): at most durationTicks / 30 + 1 clones per system. */
const CHECKPOINT_TICKS = 30;
/** 07: checkpoint cache ceiling, with a per-clone size estimate (particle record ≈ 200 B incl. arrays, plus fixed state). */
const CHECKPOINT_CEILING_BYTES = 64 * 1024 * 1024, CHECKPOINT_BASE_BYTES = 4096, CHECKPOINT_PARTICLE_BYTES = 200;

export class WebGLUnavailableError extends Error {}

/** Base pivot: shift a mesh so its lowest point sits at the origin (grows up from the particle position). */
/**
 * 09 rim: adds fresnel edge emission to an instanced mesh material (lit or unlit): view-space normal and view
 * vector from the instance transform, rim = colour × strength × (1 − |n·v|)^power, added before tone mapping.
 */
function addRim(material: THREE.Material, rim: { strength: number; color: { srgb: string }; power: number }): void {
  patchMeshShader(material, rim, 0, 4);
}

/** Object-space value-noise fBm (3 octaves) for 09 surface detail; it stays fixed on each piece as it tumbles. */
const DETAIL_GLSL = /* glsl */ `
float vfxHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vfxNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vfxHash(i), vfxHash(i + vec3(1,0,0)), f.x), mix(vfxHash(i + vec3(0,1,0)), vfxHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(vfxHash(i + vec3(0,0,1)), vfxHash(i + vec3(1,0,1)), f.x), mix(vfxHash(i + vec3(0,1,1)), vfxHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float vfxFbm(vec3 p) { return 0.55 * vfxNoise(p) + 0.3 * vfxNoise(p * 2.13 + 7.1) + 0.15 * vfxNoise(p * 4.37 + 3.3); }
vec3 vfxPerturb(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = normalize(dFdx(surfPos)), sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm), r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  return normalize(abs(det) * surfNorm - sign(det) * (dHdxy.x * r1 + dHdxy.y * r2));
}`;

/**
 * 09 mesh shader patch. Rim: fresnel edge emission, colour x strength x (1 - |n.v|)^power, added before tone
 * mapping (lit or unlit). Detail (lit only): object-space fBm bumps (perturbed normal), grain (albedo) and
 * patchy roughness.
 */
function patchMeshShader(material: THREE.Material, rim: { strength: number; color: { srgb: string }; power: number } | undefined, detail: number, detailScale: number): void {
  const lit = material instanceof THREE.MeshStandardMaterial, useDetail = lit && detail > 0, useRim = !!rim && rim.strength > 0;
  if (!useDetail && !useRim) return;
  const uniforms = { uRim: { value: rim?.strength ?? 0 }, uRimPower: { value: rim?.power ?? 2 }, uRimColor: { value: new THREE.Color().setStyle(rim?.color.srgb ?? '#ffffff') }, uDetail: { value: detail }, uDetailScale: { value: detailScale } };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRimN;\nvarying vec3 vRimV;\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObjPos = transformed;')
      .replace('#include <project_vertex>', `#include <project_vertex>
  vec3 rimObjN = normal;
  #ifdef USE_INSTANCING
    rimObjN = mat3(instanceMatrix) * rimObjN;
  #endif
  vRimN = normalize(normalMatrix * rimObjN);
  vRimV = -mvPosition.xyz;`);
    let f = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRimN;
varying vec3 vRimV;
varying vec3 vObjPos;
uniform float uRim;
uniform float uRimPower;
uniform vec3 uRimColor;
uniform float uDetail;
uniform float uDetailScale;
${DETAIL_GLSL}`)
      .replace('#include <tonemapping_fragment>', `gl_FragColor.rgb += uRimColor * uRim * pow(1.0 - abs(dot(normalize(vRimN), normalize(vRimV))), uRimPower);
#include <tonemapping_fragment>`);
    if (useDetail) {
      f = f
        .replace('#include <color_fragment>', `#include <color_fragment>
  float vfxH = vfxFbm(vObjPos * uDetailScale);
  float vfxGrain = vfxNoise(vObjPos * uDetailScale * 9.0);
  diffuseColor.rgb *= mix(1.0, clamp(0.25 + 1.3 * vfxH + 0.6 * (vfxGrain - 0.5), 0.15, 1.6), uDetail);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = clamp(roughnessFactor * mix(1.0, 0.6 + 0.8 * vfxNoise(vObjPos * uDetailScale * 0.7 + 11.0), uDetail), 0.04, 1.0);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  normal = vfxPerturb(-vViewPosition, normal, vec2(dFdx(vfxH), dFdy(vfxH)) * uDetail * 14.0, faceDirection);`);
    }
    shader.fragmentShader = f;
  };
  material.customProgramCacheKey = () => `mesh-patch:${useRim ? 1 : 0}:${useDetail ? 1 : 0}`;
}

/**
 * OverLife spin speed: the angle after age t with angular velocity w scaled by curve s(u) is w·t·mean(s over [0,u]);
 * the mean is integrated with 8 trapezoids (a flat curve returns exactly 1).
 */
const spinSamplers = new WeakMap<object, LifeCurveSampler>();
function spinAverage(curve: import('../model/types.ts').CurveValue | undefined, u: number): number {
  if (!curve) return 1;
  let s = spinSamplers.get(curve);
  if (!s) { s = compileLifeCurve(curve); spinSamplers.set(curve, s); }
  if (u <= 1e-6) return sampleLifeCurve(s, 0);
  let acc = 0;
  for (let i = 0; i < 8; i++) acc += (sampleLifeCurve(s, (u * i) / 8) + sampleLifeCurve(s, (u * (i + 1)) / 8)) / 2;
  return acc / 8;
}

function basePivot(g: THREE.BufferGeometry, base: boolean): THREE.BufferGeometry {
  if (!base) return g;
  g.computeBoundingBox();
  return g.translate(0, -g.boundingBox!.min.y, 0);
}

const rgbaScratch = new Float32Array(4);

const VERTEX = /* glsl */ `
attribute float lifeOpacity;
attribute vec3 lifeColor;
attribute float spinAngle;
attribute vec3 worldVelocity;
attribute float cell;
attribute vec2 cellMix;
attribute vec2 lifeSeed;
varying vec2 vCellNext;
varying float vCellBlend;
varying vec2 vLifeSeed;
uniform vec2 uGrid;
uniform vec2 uInset;
varying vec2 vCell;
uniform float uAlign;
uniform vec3 uAxisU;
uniform vec3 uAxisV;
uniform float uStretch;
uniform float uPivot;
varying vec2 vUv;
varying float vLifeOpacity;
varying vec3 vLifeColor;
varying float vWorldY;
void main() {
  vUv = uv;
  vLifeOpacity = lifeOpacity;
  vLifeColor = lifeColor;
  vLifeSeed = lifeSeed;
  // Atlas cell (row 0 = top of the image; textures are flipY) with a half-texel inset against bleeding.
  float col = mod(cell, uGrid.x), row = floor(cell / uGrid.x);
  vCell = vec2(col, uGrid.y - 1.0 - row); // Atlas cell origin in cells; the fragment adds the (UV-op) position inside it.
  // 09 flipbook crossfade: the next cell and the blend toward it (blend 0 = no crossfade).
  float ncol = mod(cellMix.x, uGrid.x), nrow = floor(cellMix.x / uGrid.x);
  vCellNext = vec2(ncol, uGrid.y - 1.0 - nrow);
  vCellBlend = cellMix.y;
  // Instance matrix carries translation (column 3) and uniform size (column 0.x); quad faces the camera.
  vec4 mv = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
  // Local quad: pivot shifts the particle along +Y (0 trailing end, 1 leading tip), then stretch along +Y.
  vec2 p = vec2(position.x, (position.y + 0.5 - uPivot) * uStretch);
  float ang = spinAngle;
  if (uAlign > 0.5 && uAlign < 1.5) {
    vec3 vv = (modelViewMatrix * vec4(worldVelocity, 0.0)).xyz;
    ang = dot(vv.xy, vv.xy) > 1e-10 ? atan(vv.y, vv.x) - 1.5707963 : 0.0;
  }
  float c = cos(ang), s = sin(ang);
  vec2 r = vec2(c * p.x - s * p.y, s * p.x + c * p.y) * instanceMatrix[0][0];
  vec3 centre = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  if (uAlign > 1.5) { mv.xyz += (modelViewMatrix * vec4(uAxisU * r.x + uAxisV * r.y, 0.0)).xyz; vWorldY = centre.y + (uAxisU * r.x + uAxisV * r.y).y; } // Quad in the world plane.
  else { mv.xy += r; vWorldY = centre.y + (vec3(r, 0.0) * mat3(viewMatrix)).y; } // View-space offset back to world (orthonormal view).
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */ `
uniform float uHue;
uniform float uDim;
// Colour shift: CSS hue-rotate matrix (same as hueRotate in toParticles), luminance-preserving.
vec3 vfxHue(vec3 c, float r) {
  if (r == 0.0) return c;
  float a = cos(r), b = sin(r);
  return max(vec3(0.0), vec3(
    dot(c, vec3(0.213 + 0.787 * a - 0.213 * b, 0.715 - 0.715 * a - 0.715 * b, 0.072 - 0.072 * a + 0.928 * b)),
    dot(c, vec3(0.213 - 0.213 * a + 0.143 * b, 0.715 + 0.285 * a + 0.140 * b, 0.072 - 0.072 * a - 0.283 * b)),
    dot(c, vec3(0.213 - 0.213 * a - 0.787 * b, 0.715 - 0.715 * a + 0.715 * b, 0.072 + 0.928 * a + 0.072 * b))));
}
uniform vec3 uColor;
uniform float uAlpha;
uniform float uEmission;
uniform float uCutoff;
uniform float uCutout;
varying vec2 vUv;
varying float vLifeOpacity;
varying vec3 vLifeColor;
varying vec2 vCell;
varying vec2 vCellNext;
varying float vCellBlend;
uniform vec2 uGrid;
uniform vec2 uInset;
uniform sampler2D uTex;
uniform float uUseTex;
uniform float uUvOps;
uniform vec4 uUvTileOffset; // tiling xy, offset zw
uniform vec3 uUvRotScroll; // rotation, scroll xy (UV/s)
uniform float uTime;
uniform vec3 uRim; // strength, power, unused
uniform vec3 uRimColor;
uniform float uGroundFade;
varying float vWorldY;
varying vec2 vLifeSeed;
uniform float uDissolve;
uniform vec4 uDissolveShape; // start, softness, edge width, unused
uniform vec3 uDissolveEdgeColor;
uniform sampler2D uDissolveTex;
void main() {
  vec4 t = vec4(1.0);
  float mask;
  if (uUseTex > 0.5) {
    if (uUvOps > 0.5) {
      // 09 UV ops: rotate about the centre, tile, offset, scroll; wrap inside this particle's atlas cell.
      // Gradients come from the unwrapped coordinate so the fract() seam does not pick a tiny mip level.
      vec2 q = vUv - 0.5;
      float c = cos(uUvRotScroll.x), s = sin(uUvRotScroll.x);
      vec2 g = vec2(c * q.x - s * q.y, s * q.x + c * q.y) * uUvTileOffset.xy + 0.5 + uUvTileOffset.zw + uUvRotScroll.yz * uTime;
      vec2 cu = clamp(fract(g), uInset, 1.0 - uInset);
      t = textureGrad(uTex, (vCell + cu) / uGrid, dFdx(g) / uGrid, dFdy(g) / uGrid);
      if (vCellBlend > 0.0) t = mix(t, textureGrad(uTex, (vCellNext + cu) / uGrid, dFdx(g) / uGrid, dFdy(g) / uGrid), vCellBlend);
    } else {
      vec2 cu = clamp(vUv, uInset, 1.0 - uInset);
      t = texture2D(uTex, (vCell + cu) / uGrid);
      if (vCellBlend > 0.0) t = mix(t, texture2D(uTex, (vCellNext + cu) / uGrid), vCellBlend);
    }
    mask = t.a;
  }
  else { float d = length(vUv - 0.5) * 2.0; mask = 1.0 - smoothstep(0.6, 1.0, d); }
  float a = uAlpha * vLifeOpacity * mask;
  // Analytic ground fade (08): soft contact with the floor plane y = 0, no depth texture needed.
  if (uGroundFade > 0.0) a *= smoothstep(0.0, uGroundFade, vWorldY);
  vec3 edgeRgb = vec3(0.0);
  if (uDissolve > 0.0) {
    // 09 dissolve: threshold d rises over life from the start fraction; mask m from the noise texture, offset per particle.
    float d = uDissolve * clamp((vLifeSeed.x - uDissolveShape.x) / max(1e-3, 1.0 - uDissolveShape.x), 0.0, 1.0);
    float m = texture2D(uDissolveTex, vUv * 0.85 + vLifeSeed.y * vec2(7.13, 3.71)).r; // Repeat-wrapped; no fract() (its seam breaks mip selection).
    float s = uDissolveShape.y, w = uDissolveShape.z;
    float keep = d >= 0.999 ? 0.0 : smoothstep(d - s, d + s, m);
    // Edge glow fades out toward the quad border so clipped sprite edges never draw straight glowing lines.
    float border = smoothstep(0.0, 0.18, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
    if (w > 0.0 && d > 0.0) edgeRgb = uDissolveEdgeColor * (keep - smoothstep(d + w - s, d + w + s, m)) * 4.0 * border * mask;
    a *= keep;
  }
  if (uCutout > 0.5) { if (a < uCutoff) discard; a = 1.0; }
  else if (a <= 0.0) discard;
  // 09 sprite rim: radial (a camera-facing quad has no useful fresnel normal).
  vec3 rimRgb = uRim.x > 0.0 ? uRimColor * uRim.x * pow(clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0), uRim.y) : vec3(0.0);
  gl_FragColor = vec4(vfxHue(t.rgb * uColor * vLifeColor * (1.0 + uEmission) + edgeRgb + rimRgb, uHue), a * uDim);
  #include <colorspace_fragment>
}`;

const RIBBON_VERTEX = /* glsl */ `
attribute float opacity;
attribute float side;
attribute vec3 strip;
varying float vOpacity;
varying float vSide;
varying vec3 vStrip;
void main() {
  vOpacity = opacity;
  vSide = side;
  vStrip = strip;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const RIBBON_FRAGMENT = /* glsl */ `
uniform float uHue;
uniform float uDim;
// Colour shift: CSS hue-rotate matrix (same as hueRotate in toParticles), luminance-preserving.
vec3 vfxHue(vec3 c, float r) {
  if (r == 0.0) return c;
  float a = cos(r), b = sin(r);
  return max(vec3(0.0), vec3(
    dot(c, vec3(0.213 + 0.787 * a - 0.213 * b, 0.715 - 0.715 * a - 0.715 * b, 0.072 - 0.072 * a + 0.928 * b)),
    dot(c, vec3(0.213 - 0.213 * a + 0.143 * b, 0.715 + 0.285 * a + 0.140 * b, 0.072 - 0.072 * a - 0.283 * b)),
    dot(c, vec3(0.213 - 0.213 * a - 0.787 * b, 0.715 - 0.715 * a + 0.715 * b, 0.072 + 0.928 * a + 0.072 * b))));
}
uniform vec3 uColor;
uniform float uAlpha;
uniform float uEmission;
uniform float uCutoff;
uniform float uCutout;
uniform float uSoftness;
uniform float uUseTex;
uniform sampler2D uTex;
uniform vec2 uGrid;
uniform float uVariant;
uniform float uTile;
uniform vec2 uScroll;
uniform float uDistort;
uniform float uTime;
uniform sampler2D uNoise;
uniform float uEndFade;
uniform float uFadeHead;
uniform float uLiquid;
varying float vOpacity;
varying float vSide;
varying vec3 vStrip;
void main() {
  // Transverse falloff: full on the centreline, fading to 0 at the strip edge over the outer
  // uSoftness fraction (1 = whole half-width, soft glow; 0 = hard edge).
  float s = abs(vSide);
  float edge = uSoftness > 0.0 ? 1.0 - smoothstep(1.0 - uSoftness, 1.0, s) : 1.0;
  vec3 rgb = uColor;
  float a = uAlpha * vOpacity * edge;
  if (uLiquid > 0.0 && uUseTex < 0.5) {
    // 09 liquid: see-through core, bright edges (like a lit tube seen side-on) and highlights that run along
    // the flow (two drifting streaks on one side of the centreline). Opacity comes mostly from edges and streaks.
    float rimL = smoothstep(0.45, 0.97, s);
    float flow = vStrip.x * 5.0 - uTime * 7.0;
    float streak = pow(0.5 + 0.5 * sin(flow + 2.1 * sin(vStrip.x * 1.7 + uTime)), 8.0);
    float band = 1.0 - smoothstep(0.08, 0.3, abs(vSide - 0.35));
    float hi = streak * band + 0.15 * band;
    a *= mix(1.0, clamp(0.05 + 0.8 * rimL + 0.8 * hi, 0.0, 1.0), uLiquid);
    rgb = mix(rgb, vec3(1.0), clamp(0.55 * rimL + 0.9 * hi, 0.0, 1.0) * uLiquid);
    // Refraction edge: a thin darker line just inside the silhouette so clear liquid still reads on light
    // backgrounds (on a dark arena it is nearly invisible, the bright rim carries the shape there).
    float edgeD = smoothstep(0.84, 0.95, s) * (1.0 - smoothstep(0.95, 1.0, s));
    rgb = mix(rgb, uColor * 0.32, edgeD * 0.85 * uLiquid);
    a = max(a, uAlpha * vOpacity * edgeD * 0.6 * uLiquid);
  }
  if (uUseTex > 0.5) {
    if (vStrip.z < -0.001) discard; // Round-join fans would smear the texture into spikes.
    // u along the strip (stretched over the path, or tiled every uTile metres), v across it.
    float u = uTile > 0.0 ? vStrip.x / uTile : clamp(vStrip.x / max(vStrip.y, 1e-6), 0.0, 1.0);
    float vAcross = vSide * 0.5 + 0.5;
    if (uDistort > 0.0) {
      // 09 UV distortion: a scrolling noise lookup nudges both texture coordinates.
      float n = texture2D(uNoise, vec2(vStrip.x * 0.35 - uTime * 0.6, vAcross * 0.5 + uTime * 0.2)).r - 0.5;
      u += n * uDistort; vAcross += n * uDistort * 2.0;
    }
    u += uScroll.x * uTime; vAcross += uScroll.y * uTime;
    if (uTile > 0.0 || uScroll.x != 0.0) u = fract(u);
    float cells = uGrid.x * uGrid.y;
    float cell = uVariant >= 0.0 ? min(uVariant, cells - 1.0) : floor(vStrip.z * cells);
    float col = mod(cell, uGrid.x), row = floor(cell / uGrid.x);
    vec2 cu = clamp(vec2(u, uScroll.y != 0.0 ? fract(vAcross) : vAcross), 0.002, 0.998);
    vec4 t = texture2D(uTex, vec2((col + cu.x) / uGrid.x, (uGrid.y - 1.0 - row + cu.y) / uGrid.y));
    rgb *= t.rgb;
    a = uAlpha * vOpacity * t.a; // The texture supplies the cross-section; no procedural edge falloff.
  }
  float fadeLength = uEndFade * vStrip.y;
  if (fadeLength > 0.000001) {
    float along = uFadeHead > 0.5 ? min(vStrip.x, vStrip.y - vStrip.x) : vStrip.x;
    a *= smoothstep(0.0, fadeLength, max(0.0, along));
  }
  if (uCutout > 0.5) { if (a < uCutoff) discard; a = 1.0; }
  else if (a <= 0.0) discard;
  gl_FragColor = vec4(vfxHue(rgb * (1.0 + uEmission), uHue), a * uDim);
  #include <colorspace_fragment>
}`;

type LayerMesh = { layer: ParticlePreviewLayer; mesh: THREE.InstancedMesh; material: THREE.ShaderMaterial; sizeSampler: LifeCurveSampler; opacitySampler: LifeCurveSampler; colorSampler: LifeGradientSampler };
type RibbonMesh = { nodeId: string; ribbon: RibbonGeometry; mesh: THREE.Mesh; material: THREE.ShaderMaterial };
type TrailMesh = RibbonMesh & { layer: ParticleTrailLayer; history: TrailHistory };

/** Per-tick path compile supplied by the caller (e.g. `t => compilePathPreview(doc, t)`). */
export type PathCompile = (tick: number) => ValidationResult<PathPreviewPlan>;

/** Blend/colour/opacity/emission uniforms and state shared by point and ribbon materials. */
function materialFor(
  vertexShader: string, fragmentShader: string,
  m: { color: { srgb: string; alpha: number }; opacity: number; emission: number; blend: 'normal' | 'additive' | 'cutout'; alphaCutoff: number; hueShift?: number; depthTest?: false },
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
      uHue: { value: ((m.hueShift ?? 0) * Math.PI) / 180 },
      uDim: { value: 1 },
    },
    transparent: !cutout,
    depthWrite: cutout && m.depthTest !== false,
    depthTest: m.depthTest !== false,
    blending: m.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/** Layer set identity: meshes are rebuilt only when these change between ticks. */
function ribbonKey(layers: readonly PathPreviewLayer[]): string {
  return JSON.stringify(layers.map(l => [l.nodeId, l.color, l.opacity, l.emission, l.blend, l.alphaCutoff, l.liquid, l.hueShift, l.renderOrderOffset, l.visualOrder]));
}

export class PreviewViewport {
  readonly #container: HTMLElement;
  readonly #callbacks: PreviewViewportCallbacks;
  readonly #renderer: THREE.WebGLRenderer;
  /** 08: HDR half-float target → bloom (strength .8, radius .45, threshold 1) → OutputPass (ACES + sRGB once). */
  #composer: EffectComposer | null = null;
  #bloom: UnrealBloomPass | null = null;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
  readonly #controls: OrbitControls;
  readonly #observer: ResizeObserver;
  readonly #quad = new THREE.PlaneGeometry(1, 1);
  readonly #grid: THREE.GridHelper;
  readonly #ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  #plan: ParticlePreviewPlan | null = null;
  #sims = new Map<string, ParticleSimulation>();
  #snapshots = new Map<string, ParticleState[]>();
  #layers: LayerMesh[] = [];
  /** 06 Solo: sink node IDs to show (null = show all). A preview mask only; simulations still run, so timing is unchanged. */
  #solo: ReadonlySet<string> | null = null;
  #pathCompile: PathCompile | null = null;
  #pathPlan: PathPreviewPlan | null = null;
  #ribbons: RibbonMesh[] = [];
  #trails: TrailMesh[] = [];
  #lights: { layer: PointLightLayer; light: THREE.PointLight; curve: LifeCurveSampler }[] = [];
  #meshes: { layer: MeshLayer; mesh: THREE.InstancedMesh; material: THREE.Material; size: LifeCurveSampler; color: LifeGradientSampler }[] = [];
  readonly #meshGeometries = new Map<string, THREE.BufferGeometry>();
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
  #contextLost = false;
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
    let grid: THREE.GridHelper | null = null, ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null = null;
    try {
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.info.autoReset = false; // 08 diagnostics: reset once per frame, before all passes.
      renderer.setClearColor(0x0b0d12, 1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.#scene.background = new THREE.Color(0x0b0d12);
      renderer.toneMappingExposure = 1;
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      this.#composer = new EffectComposer(renderer, target);
      this.#composer.addPass(new RenderPass(this.#scene, this.#camera));
      this.#bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.8, 0.45, 1.0);
      // Glow limit (A-05): brightness fed into the glow is capped, so hundreds of stacked additive sprites
      // glow like one bright surface instead of flooding the frame with a halo. 0 = no cap.
      const hp = this.#bloom.materialHighPassFilter;
      hp.uniforms.uGlowLimit = { value: 3 };
      hp.fragmentShader = hp.fragmentShader
        .replace('uniform float smoothWidth;', 'uniform float smoothWidth;\nuniform float uGlowLimit;')
        .replace('float v = luminance( texel.xyz );', 'float v = luminance( texel.xyz );\nif ( uGlowLimit > 0.0 && v > uGlowLimit ) { texel.rgb *= uGlowLimit / v; v = uGlowLimit; }');
      hp.needsUpdate = true;
      this.#composer.addPass(this.#bloom);
      this.#composer.addPass(new OutputPass());
      renderer.domElement.className = 'pv2-canvas';
      // WP24 context loss (driver reset, GPU memory pressure, too many tabs): keep the page alive, stop drawing,
      // and let three.js rebuild its GPU state when the browser restores the context; then redraw this tick.
      renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); this.#contextLost = true; this.#clock?.pause(); this.#callbacks.onContextLost?.(true); });
      renderer.domElement.addEventListener('webglcontextrestored', () => { this.#contextLost = false; this.#callbacks.onContextLost?.(false); if (!this.#disposed) this.#emitFrame(true); });
      container.appendChild(renderer.domElement);
      const flashEl = document.createElement('div');
      Object.assign(flashEl.style, { position: 'absolute', inset: '0', pointerEvents: 'none', opacity: '0', background: '#ffffff' });
      if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
      container.appendChild(flashEl);
      this.#flashEl = flashEl;

      this.#camera.position.set(...DEFAULT_CAMERA);
      controls = new OrbitControls(this.#camera, renderer.domElement);
      controls.target.set(...DEFAULT_TARGET);
      controls.enableDamping = true;
      controls.maxPolarAngle = Math.PI * 0.495; // 08: orbit stays above the ground by default.
      controls.update();
      // Once the user orbits/zooms, resizes stop refitting the path frame.
      controls.addEventListener('start', () => { this.#frameSets = null; this.#userOrbited = true; });

      grid = new THREE.GridHelper(10, 20, 0x3a4150, 0x1d222c);
      this.#scene.add(grid);
      // Lit (PointLight nodes illuminate it); ambient π reproduces the former unlit base colour.
      // Lighting for lit meshes: a weak flat fill, a sky/ground hemisphere and a stronger key light, so rocks and
      // shards show form and surface detail instead of the former flat ambient pi wash. The ground colour is
      // raised by the same factor the fill dropped, so the floor keeps its former brightness.
      ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: new THREE.Color(0x10131a).multiplyScalar(Math.PI / 1.4), roughness: 0.85, metalness: 0, depthWrite: true }));
      this.#scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      this.#scene.add(new THREE.HemisphereLight(0xbfd0ff, 0x3a3128, 0.8));
      const key = new THREE.DirectionalLight(0xfff4e6, 2.6);
      key.position.set(3, 6, 4);
      this.#scene.add(key);
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
    this.#clock = new PlaybackClock({ durationTicks: plan.durationTicks, speed: this.#speed });
    this.#failed = false;
    this.#suspended = false;
    this.#addPointLayers(plan);
    const sets = particleFrameSets(plan);
    if (sets.length) { this.#frameSets = sets; this.#fitSets = sets; this.#framePaths(); }
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
    this.#clock = new PlaybackClock({ durationTicks: plan.durationTicks, speed: this.#speed });
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
    this.#clock = new PlaybackClock({ durationTicks: Math.max(points.durationTicks, paths.durationTicks), speed: this.#speed });
    this.#failed = false;
    this.#suspended = false;
    this.#addPointLayers(points);
    this.#beginPathSource(paths, compile, particleFrameSets(points));
    this.#replayTo(0);
  }

  #addPointLayers(plan: ParticlePreviewPlan): void {
    this.#plan = plan;
    this.#presentation = plan.presentation ?? null;
    for (const layer of plan.meshes ?? []) {
      const base = layer.pivot === 'base', size = layer.meshAssetSize;
      const gkey = `${layer.meshAsset ? `asset:${layer.meshAsset}:${size?.mode === 'real' ? `real${size.importScale}` : 'fit'}` : layer.mesh}${base ? ':base' : ''}`;
      let geometry = this.#meshGeometries.get(gkey);
      if (!geometry) { geometry = layer.meshAsset ? this.#importedMesh(layer.meshAsset, gkey, base, size?.mode === 'real' ? size.importScale : undefined) : basePivot(createBuiltinMesh(layer.mesh as BuiltinMesh), base); this.#meshGeometries.set(gkey, geometry); }
      const color = new THREE.Color().setStyle(layer.color.srgb), additive = layer.blend === 'additive';
      // 09 refraction (enhancement): a lit mesh with refraction becomes a transmissive physical material (what is behind bends through it).
      const litOpts = { color, roughness: layer.roughness ?? 0.75, metalness: layer.metalness ?? 0.05, flatShading: true, emissive: color.clone().multiplyScalar(layer.emission), transparent: layer.opacity < 1, opacity: layer.opacity };
      const material: THREE.Material = !additive && layer.lit
        ? (layer.refraction ? new THREE.MeshPhysicalMaterial({ ...litOpts, transmission: 1, ior: 1 + 0.06 * layer.refraction, thickness: 0.4 }) : new THREE.MeshStandardMaterial(litOpts))
        : new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1 + layer.emission), transparent: additive || layer.opacity < 1, opacity: layer.opacity, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !additive });
      material.side = layer.faceMode === 'double' ? THREE.DoubleSide : layer.faceMode === 'back' ? THREE.BackSide : THREE.FrontSide;
      if (layer.depthTest === false) { material.depthTest = false; material.depthWrite = false; }
      const surface = layer.surface;
      if (material instanceof THREE.MeshStandardMaterial && surface && surface.reflection > 0) { material.envMap = this.#environment(); material.envMapIntensity = surface.reflection; }
      if (layer.normalMap && material instanceof THREE.MeshStandardMaterial) material.normalMap = this.#dataTexture(layer.normalMap, false);
      patchMeshShader(material, layer.rim, surface?.detail ?? 0, surface?.detailScale ?? 4);
      const mesh = new THREE.InstancedMesh(geometry, material, PREVIEW_POOL_SIZE);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PREVIEW_POOL_SIZE * 3).fill(1), 3);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = layerRenderOrder(layer.renderOrderOffset, layer.visualOrder);
      this.#scene.add(mesh);
      this.#meshes.push({ layer, mesh, material, size: compileLifeCurve(layer.sizeOverLife), color: compileLifeGradient(layer.colorOverLife) });
    }
    for (const layer of plan.lights ?? []) {
      const light = new THREE.PointLight(new THREE.Color().setStyle(layer.color.srgb), 0, layer.range, 2);
      light.position.set(layer.position[0], layer.position[1], layer.position[2]);
      this.#scene.add(light);
      this.#lights.push({ layer, light, curve: compileLifeCurve(layer.intensityOverWindow) });
    }
    for (const layer of plan.trails ?? []) {
      const ribbon = new RibbonGeometry({ maxPoints: MAX_PREVIEW_POINTS });
      const material = materialFor(RIBBON_VERTEX, RIBBON_FRAGMENT, layer);
      material.side = THREE.DoubleSide;
      material.uniforms.uSoftness = { value: ribbonSoftness(layer.blend) };
      Object.assign(material.uniforms, { uUseTex: { value: 0 }, uTex: { value: null }, uGrid: { value: new THREE.Vector2(1, 1) }, uVariant: { value: -1 }, uTile: { value: 0 }, uScroll: { value: new THREE.Vector2(0, 0) }, uDistort: { value: 0 }, uTime: this.#effectTime, uNoise: { value: null }, uLiquid: { value: 0 }, uEndFade: { value: layer.endFade ?? DEFAULT_RIBBON_END_FADE }, uFadeHead: { value: 0 } });
      const mesh = new THREE.Mesh(ribbon.geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = layerRenderOrder(layer.renderOrderOffset, layer.visualOrder);
      this.#scene.add(mesh);
      this.#trails.push({ nodeId: layer.nodeId, ribbon, mesh, material, layer, history: new TrailHistory(layer.historyTicks, layer.maxPoints) });
    }
    for (const layer of plan.layers) {
      const material = materialFor(VERTEX, FRAGMENT, layer);
      // Per-layer geometry: the per-instance opacity attribute cannot live on the shared quad.
      const geometry = this.#quad.clone();
      const lifeOpacity = new THREE.InstancedBufferAttribute(new Float32Array(PREVIEW_POOL_SIZE).fill(1), 1);
      lifeOpacity.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('lifeOpacity', lifeOpacity);
      for (const [name, size, fill] of [['lifeColor', 3, 1], ['spinAngle', 1, 0], ['worldVelocity', 3, 0], ['cell', 1, 0], ['cellMix', 2, 0], ['lifeSeed', 2, 0]] as const) {
        const attr = new THREE.InstancedBufferAttribute(new Float32Array(PREVIEW_POOL_SIZE * size).fill(fill), size);
        attr.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute(name, attr);
      }
      material.uniforms.uAlign = { value: layer.alignment === 'velocity' ? 1 : layer.alignment === 'worldAxis' ? 2 : 0 };
      material.uniforms.uGroundFade = { value: layer.groundFade ?? 0 };
      const dv = layer.dissolve;
      material.uniforms.uDissolve = { value: dv?.amount ?? 0 };
      material.uniforms.uDissolveShape = { value: new THREE.Vector4(dv?.start ?? 0, dv?.softness ?? 0.08, dv?.edge ?? 0, 0) };
      material.uniforms.uDissolveEdgeColor = { value: new THREE.Color().setStyle(dv?.edgeColor.srgb ?? '#ffb040') };
      material.uniforms.uDissolveTex = { value: dv ? (layer.noiseTexture ? this.#dataTexture(layer.noiseTexture, true) : this.#noiseTexture()) : null };
      const uvo = layer.uv;
      material.uniforms.uUvOps = { value: uvo ? 1 : 0 };
      material.uniforms.uUvTileOffset = { value: new THREE.Vector4(uvo?.tiling[0] ?? 1, uvo?.tiling[1] ?? 1, uvo?.offset[0] ?? 0, uvo?.offset[1] ?? 0) };
      material.uniforms.uUvRotScroll = { value: new THREE.Vector3(uvo?.rotation ?? 0, uvo?.scroll[0] ?? 0, uvo?.scroll[1] ?? 0) };
      material.uniforms.uTime = this.#effectTime;
      material.uniforms.uRim = { value: new THREE.Vector3(layer.rim?.strength ?? 0, layer.rim?.power ?? 3, 0) };
      material.uniforms.uRimColor = { value: new THREE.Color().setStyle(layer.rim?.color.srgb ?? '#ffffff') };
      {
        // In-plane basis for worldAxis quads: U, V perpendicular to the axis (right-handed, V toward +Y/-Z).
        const n = new THREE.Vector3(...(layer.worldAxis ?? [0, 1, 0])).normalize();
        const helper = Math.abs(n.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
        const u = new THREE.Vector3().crossVectors(helper, n).normalize(), v = new THREE.Vector3().crossVectors(n, u);
        material.uniforms.uAxisU = { value: u };
        material.uniforms.uAxisV = { value: v };
      }
      material.uniforms.uStretch = { value: layer.stretchRatio };
      material.uniforms.uPivot = { value: layer.pivot };
      const sheet = layer.sprite?.sheet;
      material.uniforms.uUseTex = { value: sheet ? 1 : 0 };
      material.uniforms.uGrid = { value: new THREE.Vector2(sheet?.columns ?? 1, sheet?.rows ?? 1) };
      material.uniforms.uInset = { value: new THREE.Vector2(0.5 / (sheet?.cell[0] ?? 1), 0.5 / (sheet?.cell[1] ?? 1)) };
      material.uniforms.uTex = { value: sheet ? this.#spriteTexture(sheet.file) : null };
      const mesh = new THREE.InstancedMesh(geometry, material, PREVIEW_POOL_SIZE);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = layerRenderOrder(layer.renderOrderOffset, layer.visualOrder);
      this.#scene.add(mesh);
      this.#layers.push({ layer, mesh, material, sizeSampler: compileLifeCurve(layer.sizeOverLife), opacitySampler: compileLifeCurve(layer.opacityOverLife), colorSampler: compileLifeGradient(layer.colorOverLife) });
    }
  }

  /**
   * Imported GLB for MeshRenderer: a small placeholder until the bytes are registered and parsed, then every
   * mesh in the scene is flattened (world transforms applied) into one non-indexed position+normal geometry,
   * centred and fitted to ≈1 m like the included meshes (or, with `realScale`, kept at file units × realScale
   * meters), and swapped into the instanced meshes using it.
   */
  #importedMesh(sha256: string, key: string, base = false, realScale?: number): THREE.BufferGeometry {
    const placeholder = new THREE.OctahedronGeometry(0.15, 0);
    whenAssetUrl(sha256, url => new GLTFLoader().load(url, gltf => {
      if (this.#disposed) return;
      gltf.scene.updateMatrixWorld(true);
      const pos: number[] = [], nor: number[] = [];
      gltf.scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        let g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        if (g.index) g = g.toNonIndexed();
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        for (const x of Array.from(g.getAttribute('position').array as ArrayLike<number>)) pos.push(x);
        for (const x of Array.from(g.getAttribute('normal').array as ArrayLike<number>)) nor.push(x);
      });
      const merged = new THREE.BufferGeometry();
      merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      merged.computeBoundingBox();
      const bb = merged.boundingBox!, size = new THREE.Vector3(), centre = new THREE.Vector3();
      bb.getSize(size); bb.getCenter(centre);
      const k = realScale ?? 1 / Math.max(1e-6, size.x, size.y, size.z);
      merged.translate(-centre.x, -centre.y, -centre.z).scale(k, k, k);
      basePivot(merged, base);
      this.#meshGeometries.set(key, merged);
      for (const x of this.#meshes) if (x.mesh.geometry === placeholder) x.mesh.geometry = merged;
      placeholder.dispose();
      this.#emitFrame(true);
    }, undefined, () => { /* Unreadable bytes: the placeholder stays; import already validated the file. */ }));
    return placeholder;
  }

  /** Effect time in seconds (clock tick + interpolation), shared by materials that animate UVs; set each rendered frame. */
  readonly #effectTime = { value: 0 };
  #noiseTex: THREE.Texture | null = null;
  /** Included dissolve-noise mask, sampled as data (no colour-space conversion) and wrapped for per-particle offsets. */
  /** 09 reflection: a prefiltered procedural studio environment (RoomEnvironment), built once per viewport on first use. */
  #envTexture: THREE.Texture | null = null;
  #environment(): THREE.Texture {
    if (!this.#envTexture) {
      const pmrem = new THREE.PMREMGenerator(this.#renderer), room = new RoomEnvironment();
      this.#envTexture = pmrem.fromScene(room, 0.04).texture;
      room.dispose();
      pmrem.dispose();
    }
    return this.#envTexture;
  }

  #noiseTexture(): THREE.Texture {
    if (!this.#noiseTex) {
      this.#noiseTex = new THREE.TextureLoader().load('/assets/sprites/dissolve-noise.png', () => { if (!this.#disposed) this.#emitFrame(true); });
      this.#noiseTex.wrapS = this.#noiseTex.wrapT = THREE.RepeatWrapping;
    }
    return this.#noiseTex;
  }

  /** 10 normal/noise role textures: imported bytes sampled as data (no colour-space conversion), wrap optional. */
  #dataTexture(file: string, wrap: boolean): THREE.Texture {
    const key = `data:${wrap ? 'wrap:' : ''}${file}`;
    let t = this.#textures.get(key);
    if (!t) {
      const tex = new THREE.Texture();
      t = tex;
      tex.colorSpace = THREE.NoColorSpace;
      if (wrap) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      whenAssetUrl(file.slice(ASSET_FILE_PREFIX.length), url => new THREE.ImageLoader().load(url, img => {
        if (this.#disposed) return;
        tex.image = img; tex.needsUpdate = true; this.#emitFrame(true);
      }));
      this.#textures.set(key, tex);
    }
    return t;
  }

  readonly #textures = new Map<string, THREE.Texture>();
  /** Included-library atlas, loaded once per file and shared across layers (sRGB, mipmapped). */
  #spriteTexture(file: string): THREE.Texture {
    let t = this.#textures.get(file);
    if (!t && file.startsWith(ASSET_FILE_PREFIX)) {
      // Imported asset: an empty texture until its bytes are registered (import or local asset store), then decoded.
      const tex = new THREE.Texture();
      t = tex;
      whenAssetUrl(file.slice(ASSET_FILE_PREFIX.length), url => new THREE.ImageLoader().load(url, img => {
        if (this.#disposed) return;
        tex.image = img; tex.needsUpdate = true; this.#emitFrame(true);
      }));
    } else if (!t) {
      t = new THREE.TextureLoader().load(`/assets/sprites/${file}`, () => { if (!this.#disposed) this.#emitFrame(true); });
    }
    if (!this.#textures.has(file)) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      this.#textures.set(file, t);
    }
    return t;
  }

  /**
   * Frames paths sampled across the effect timeline (fixed during playback) and uploads tick 0;
   * the caller owns the clock (set before this call) and emits the frame.
   */
  #beginPathSource(plan: PathPreviewPlan, compile: PathCompile, extra: FramePointSet[] = []): void {
    this.#pathCompile = compile;
    const duration = this.#clock ? this.#clock.durationTicks : plan.durationTicks;
    const sets: FramePointSet[] = [...collectTimelineFrameSets(plan, duration, compile), ...extra];
    this.#frameSets = sets.length ? sets : null;
    this.#fitSets = this.#frameSets;
    // Broadside initial view until the user orbits; later edits keep their orbit direction.
    if (sets.length && !this.#userOrbited) {
      const cam = this.#camera, target = this.#controls.target;
      const d = pathViewDirection(sets.map(s => s.points));
      cam.position.set(target.x + d[0], target.y + d[1], target.z + d[2]);
    }
    this.#framePaths();
    this.#applyPathPlan(plan);
  }

  /**
   * Explicit camera pose (matched framing for A/B comparisons, 17 Gate B): world position, look-at target and
   * optional vertical field of view in degrees. Stays until the next plan load resets the camera.
   */
  /**
   * Orbits the current (auto-framed) camera around its target: yaw degrees about +Y, then sets the elevation to
   * `pitchDeg` above the horizon (keeps the distance). Evidence captures use it for fixed oblique angles that still
   * fit each effect. Like a user orbit, it stops later auto-framing.
   */
  orbitCamera(yawDeg: number, pitchDeg: number, distanceScale = 1): void {
    const t = this.#controls.target, p = this.#camera.position;
    const dx = p.x - t.x, dy = p.y - t.y, dz = p.z - t.z, dist = Math.hypot(dx, dy, dz) * distanceScale;
    const yaw = Math.atan2(dx, dz) + (yawDeg * Math.PI) / 180, pitch = (Math.max(-80, Math.min(80, pitchDeg)) * Math.PI) / 180;
    const pos: [number, number, number] = [t.x + dist * Math.cos(pitch) * Math.sin(yaw), t.y + dist * Math.sin(pitch), t.z + dist * Math.cos(pitch) * Math.cos(yaw)];
    this.setCameraPose(pos, [t.x, t.y, t.z]);
  }

  setCameraPose(position: readonly [number, number, number], target: readonly [number, number, number], fovDeg?: number): void {
    this.#camera.position.set(position[0], position[1], position[2]);
    this.#controls.target.set(target[0], target[1], target[2]);
    if (fovDeg !== undefined && fovDeg > 1 && fovDeg < 170) this.#camera.fov = fovDeg;
    this.#camera.updateProjectionMatrix();
    this.#controls.update();
    this.#pathCamera = false;
    this.#userOrbited = true; // Plan reloads keep the pose instead of re-framing.
    this.#frameSets = null; // Resizes must not auto-frame over an explicit pose (same as a user orbit).
    this.#emitFrame(true);
  }

  /** 08 "Reset camera fits those bounds": re-frames the whole effect (all ticks) from the current direction. */
  #fitSets: FramePointSet[] | null = null;
  resetView(): void {
    this.#userOrbited = false;
    if (this.#fitSets?.length) { this.#frameSets = this.#fitSets; this.#framePaths(); } else this.#resetCamera();
    this.#emitFrame(true);
  }

  /** 08 arena markers for Source/Target (world positions); hidden together with the grid. */
  #markers: THREE.Mesh[] = [];
  setMarkers(points: readonly { position: readonly [number, number, number]; kind: 'source' | 'target' | 'other' }[]): void {
    for (const m of this.#markers) { this.#scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    this.#markers = points.map(pt => {
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), new THREE.MeshBasicMaterial({ color: pt.kind === 'source' ? 0x6fd48f : pt.kind === 'target' ? 0xffa060 : 0x9aa4b8, wireframe: true, depthWrite: false }));
      mesh.position.set(pt.position[0], pt.position[1], pt.position[2]);
      mesh.visible = this.#grid.visible;
      mesh.renderOrder = -1;
      this.#scene.add(mesh);
      return mesh;
    });
  }

  /**
   * 08 "selecting a block can highlight its contributing geometry": other layers are dimmed to 20 % (preview overlay
   * only; saved materials never change). null clears it.
   */
  #highlight: ReadonlySet<string> | null = null;
  setHighlight(ids: ReadonlySet<string> | null): void { this.#highlight = ids && ids.size ? new Set(ids) : null; }
  #applyHighlight(): void {
    const h = this.#highlight, dim = (id: string) => (h && !h.has(id) ? 0.2 : 1);
    for (const l of this.#layers) l.material.uniforms.uDim.value = dim(l.layer.nodeId);
    for (const t of this.#trails) if (t.material.uniforms.uDim) t.material.uniforms.uDim.value = dim(t.nodeId);
    for (const r of this.#ribbons) if (r.material.uniforms.uDim) r.material.uniforms.uDim.value = dim(r.nodeId);
    for (const m of this.#meshes) {
      const base = (m as unknown as { baseOpacity?: number }).baseOpacity ??= (m.material as THREE.Material & { opacity: number }).opacity;
      const mat = m.material as THREE.Material & { opacity: number };
      const f = dim(m.layer.nodeId);
      mat.opacity = base * f; mat.transparent = mat.opacity < 1 || (m.layer.blend === 'additive');
    }
  }

  /** 08 diagnostics: draw calls and triangles of the last frame, render-target size, plus scene resources. */
  renderStats(): { calls: number; triangles: number; width: number; height: number; pixelRatio: number } & ReturnType<PreviewViewport['resourceStats']> {
    const info = this.#renderer.info.render, c = this.#renderer.domElement;
    return { calls: info.calls, triangles: info.triangles, width: c.width, height: c.height, pixelRatio: this.#renderer.getPixelRatio(), ...this.resourceStats() };
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

  /** Fits the timeline-sampled path points into the view, keeping the current orbit direction. */
  #framePaths(): void {
    const sets = this.#frameSets;
    if (!sets) return;
    const cam = this.#camera, target = this.#controls.target;
    const dir = cam.position.clone().sub(target);
    // A floor on the framed half-extent keeps tiny effects (one static particle) from filling the whole view.
    const f = framePoints(sets, { viewDirection: [dir.x, dir.y, dir.z], fovDeg: cam.fov, aspect: cam.aspect, fill: PATH_FRAME_FILL, minHalfExtent: 0.75 });
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
    for (const t of this.#textures.values()) t.dispose();
    for (const g of this.#meshGeometries.values()) g.dispose();
    this.#envTexture?.dispose();
    this.#textures.clear();
    this.#grid.geometry.dispose();
    (this.#grid.material as THREE.Material).dispose();
    this.#ground.geometry.dispose();
    this.#ground.material.dispose();
    this.#bloom?.dispose();
    this.#composer?.dispose();
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
    for (const t of this.#trails) { this.#scene.remove(t.mesh); t.ribbon.dispose(); t.material.dispose(); }
    this.#trails = [];
    for (const l of this.#lights) { this.#scene.remove(l.light); l.light.dispose(); }
    this.#lights = [];
    for (const m of this.#meshes) { this.#scene.remove(m.mesh); m.mesh.dispose(); m.material.dispose(); }
    this.#meshes = [];
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
        material.uniforms.uEndFade = { value: layer.endFade ?? DEFAULT_RIBBON_END_FADE };
        material.uniforms.uFadeHead = { value: 1 };
        const sheet = layer.sprite?.sheet;
        material.uniforms.uUseTex = { value: sheet ? 1 : 0 };
        material.uniforms.uTex = { value: sheet ? this.#spriteTexture(sheet.file) : null };
        material.uniforms.uGrid = { value: new THREE.Vector2(sheet?.columns ?? 1, sheet?.rows ?? 1) };
        material.uniforms.uVariant = { value: layer.sprite?.variant ?? -1 };
        material.uniforms.uTile = { value: layer.uvMode === 'tile' ? layer.uvTileLength : 0 };
        material.uniforms.uScroll = { value: new THREE.Vector2(layer.uvAnim?.scroll[0] ?? 0, layer.uvAnim?.scroll[1] ?? 0) };
        material.uniforms.uDistort = { value: layer.uvAnim?.distort ?? 0 };
        material.uniforms.uTime = this.#effectTime;
        material.uniforms.uNoise = { value: layer.uvAnim?.distort ? this.#noiseTexture() : null };
        material.uniforms.uLiquid = { value: layer.liquid ?? 0 };
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
        drawn += this.#ribbons[i].ribbon.update(layer.active ? layer.paths : [], { cameraPosition, width: layer.width, endFade: layer.endFade, ...ribbonWidthShape(layer.widthOverPath) }).drawnPaths;
      }
    } catch (e) {
      const nodeId = plan.layers[i]?.nodeId;
      return this.#fail([{ code: e instanceof RangeError ? 'BUDGET_EXCEEDED' : 'INVALID_VALUE', severity: 'error', message: `Ribbon geometry failed: ${e instanceof Error ? e.message : String(e)}`, ...(nodeId ? { nodeId } : {}) }]);
    }
    this.#drawnPaths = drawn;
    this.#ribbonCamera.copy(c);
  }

  /** Rebuilds point simulations from tick 0 and/or recompiles the path tick; lands paused. */
  /** 12 seek checkpoints: pristine simulation clones every CHECKPOINT_TICKS, per system, for the current plan only. */
  #checkpoints = new Map<string, ParticleSimulation[]>();
  #checkpointPlan: ParticlePreviewPlan | null = null;
  #checkpoint(id: string, sim: ParticleSimulation): void {
    if (sim.tick % CHECKPOINT_TICKS !== 0) return;
    const list = this.#checkpoints.get(id) ?? [];
    if (list.some(c => c.tick === sim.tick)) return;
    list.push(sim.clone());
    list.sort((a, b) => a.tick - b.tick);
    this.#checkpoints.set(id, list);
    // 07 cache ceiling (64 MiB, estimated from live particles): evict the oldest nonzero checkpoints first; tick 0 stays.
    const bytes = () => [...this.#checkpoints.values()].flat().reduce((s, c) => s + CHECKPOINT_BASE_BYTES + c.liveCount * CHECKPOINT_PARTICLE_BYTES, 0);
    while (bytes() > CHECKPOINT_CEILING_BYTES) {
      let victim: { list: ParticleSimulation[]; i: number } | null = null;
      for (const l of this.#checkpoints.values()) l.forEach((c, i) => { if (c.tick > 0 && (!victim || c.tick < victim.list[victim.i].tick)) victim = { list: l, i }; });
      if (!victim) break;
      const v: { list: ParticleSimulation[]; i: number } = victim;
      v.list.splice(v.i, 1);
    }
  }

  #replayTo(tick: number): void {
    const plan = this.#plan, clock = this.#clock;
    if (!clock || (!plan && !this.#pathCompile)) return;
    this.#failed = false;
    clock.pause(); // Replays always land paused; restart() resumes explicitly.
    clock.seek(tick);
    if (plan) {
      if (this.#checkpointPlan !== plan) { this.#checkpoints.clear(); this.#checkpointPlan = plan; }
      this.#sims.clear();
      for (const t of this.#trails) t.history.clear();
      const reach = Math.max(0, ...this.#trails.map(t => t.layer.historyTicks));
      for (const s of plan.systems) {
        // Resume from the latest checkpoint that still lets trails collect their full history before `end`.
        const end = Math.min(tick, s.descriptor.durationTicks), from = Math.max(0, end - reach);
        const cp = [...(this.#checkpoints.get(s.id) ?? [])].reverse().find(c => c.tick <= from);
        let sim: ParticleSimulation;
        if (cp) sim = cp.clone();
        else {
          const created = ParticleSimulation.create(s.descriptor);
          if (!created.ok) return this.#fail(created.errors.map(e => ({ ...e, nodeId: e.nodeId ?? s.id })));
          sim = created.value;
          this.#checkpoint(s.id, sim);
        }
        this.#sims.set(s.id, sim);
        const id = s.id;
        // Mixed clocks may outlast a system; stop at its own duration as #advanceSims does.
        if (end - sim.tick <= reach) this.#feedTrails(id, sim);
        while (sim.tick < end) {
          const r = sim.step();
          if (!r.ok) return this.#fail(r.errors.map(e => ({ ...e, nodeId: e.nodeId ?? id })));
          this.#checkpoint(id, sim);
          if (end - sim.tick <= reach) this.#feedTrails(id, sim);
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
        const r = sim.step();
        if (!r.ok) return this.#fail(r.errors.map(e => ({ ...e, nodeId: e.nodeId ?? id })));
        this.#checkpoint(id, sim);
        this.#feedTrails(id, sim);
      }
    }
    this.#takeSnapshots();
  }

  /** Records one simulated tick into every trail drawn from that system. */
  #feedTrails(systemId: string, sim: ParticleSimulation): void {
    let snap: ParticleState[] | undefined;
    for (const t of this.#trails) if (t.layer.systemId === systemId) t.history.push(sim.tick, snap ??= sim.snapshot().particles);
    // 15 hard limit: trail samples across the effect; stop with an error instead of dropping history.
    const samples = this.#trails.reduce((n, t) => n + t.history.sampleCount, 0);
    if (samples > MAX_TRAIL_SAMPLES) this.#fail([{ code: 'BUDGET_EXCEEDED', severity: 'error', message: `Trails store ${samples} samples at tick ${sim.tick}; the limit is ${MAX_TRAIL_SAMPLES}. Shorten trail history, lower Max points or emit fewer particles.` }]);
  }

  /** Instanced mesh transforms: size × scale × size-over-life, tumble (random axis, spin) or velocity (+Y forward). */
  #updateMeshes(alpha: number): void {
    const step = alpha * PARTICLE_DT, q = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), mtx = new THREE.Matrix4(), axis = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    for (const m of this.#meshes) {
      const ps = this.#snapshots.get(m.layer.systemId) ?? [], n = Math.min(ps.length, PREVIEW_POOL_SIZE);
      // 15 hard limits: 512 mesh instances and 250k visible triangles; an error, never a silent cap.
      const tris = n * ((m.mesh.geometry.index ? m.mesh.geometry.index.count : m.mesh.geometry.getAttribute('position').count) / 3);
      if (n > MAX_MESH_INSTANCES || tris > MAX_MESH_TRIANGLES) {
        return this.#fail([{ code: 'BUDGET_EXCEEDED', severity: 'error', nodeId: m.layer.nodeId, message: `MeshRenderer "${m.layer.nodeId}" draws ${n} pieces (${Math.round(tris)} triangles); the limits are ${MAX_MESH_INSTANCES} pieces and ${MAX_MESH_TRIANGLES} triangles. Emit fewer or use a simpler mesh.` }]);
      }
      for (let i = 0; i < n; i++) {
        const pt = ps[i], u = lifeFraction(pt.ageTicks, pt.lifetimeTicks, alpha), h = fnv1a32Utf8(pt.parentRandomKey);
        p.set(pt.position[0] + pt.velocity[0] * step, pt.position[1] + pt.velocity[1] * step, pt.position[2] + pt.velocity[2] * step);
        if (m.layer.orientation === 'fixed') {
          const dv = m.layer.direction ?? [0, 1, 0];
          q.setFromUnitVectors(up, axis.set(dv[0], dv[1], dv[2]));
        } else if (m.layer.orientation === 'upright') {
          // +Y up with a deterministic random yaw and a lean of up to `tilt` toward a random horizontal direction.
          const yaw = (h & 1023) / 1023 * Math.PI * 2, lean = ((h >>> 10) & 1023) / 1023 * (m.layer.tilt ?? 0.2), dir = ((h >>> 20) & 1023) / 1023 * Math.PI * 2;
          q.setFromAxisAngle(axis.set(Math.cos(dir), 0, Math.sin(dir)), lean).multiply(qYaw.setFromAxisAngle(up, yaw));
        } else if (m.layer.orientation === 'velocity' && Math.hypot(pt.velocity[0], pt.velocity[1], pt.velocity[2]) > 1e-6) q.setFromUnitVectors(up, axis.set(pt.velocity[0], pt.velocity[1], pt.velocity[2]).normalize());
        else {
          const a = (h & 1023) / 1023 * Math.PI * 2, b = ((h >>> 10) & 1023) / 1023 * 2 - 1, r = Math.sqrt(1 - b * b);
          const angle = (pt.rotation ?? (h >>> 20) / 4096 * Math.PI * 2) + (pt.angularVelocity ?? 0) * (pt.ageTicks + alpha) * PARTICLE_DT * spinAverage(m.layer.spinOverLife, u);
          q.setFromAxisAngle(axis.set(r * Math.cos(a), b, r * Math.sin(a)), angle);
        }
        const k = pt.size * m.layer.scale * sampleLifeCurve(m.size, u);
        s.set(k, k * (m.layer.scaleY ?? 1), k);
        m.mesh.setMatrixAt(i, mtx.compose(p, q, s));
        sampleLifeGradient(m.color, u, rgbaScratch);
        // 09 colour variation: a stable per-piece shade (up to +-40 %) and a slight warm/cool hue shift.
        const cv = m.layer.surface?.variation ?? 0;
        const shade = cv > 0 ? 1 + cv * 0.4 * ((((h >>> 3) & 255) / 255) * 2 - 1) : 1, hue = cv > 0 ? cv * 0.12 * ((((h >>> 11) & 255) / 255) * 2 - 1) : 0;
        m.mesh.setColorAt(i, col.setRGB(rgbaScratch[0] * shade * (1 + hue), rgbaScratch[1] * shade, rgbaScratch[2] * shade * (1 - hue)));
      }
      m.mesh.count = n;
      m.mesh.instanceMatrix.needsUpdate = true;
      if (m.mesh.instanceColor) m.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Light intensity = peak × window curve × (1 − flicker·noise), zero outside the window. */
  #updateLights(alpha: number): void {
    const tick = (this.#clock ? this.#clock.tick : 0) + alpha;
    for (const { layer: l, light, curve } of this.#lights) {
      const inside = tick >= l.startTick && tick < l.endTick;
      const u = (tick - l.startTick) / Math.max(1, l.endTick - l.startTick);
      const f = l.flicker > 0 ? 1 - l.flicker * (0.5 + 0.5 * valueNoise4(l.seed, (tick * PARTICLE_DT) * l.flickerRate, 0.5, 0.5, 0)) : 1;
      light.intensity = inside ? l.intensity * sampleLifeCurve(curve, u) * f : 0;
      if (l.track) { const p = l.track.positions[Math.max(0, Math.min(l.track.positions.length - 1, Math.floor(tick) - l.track.startTick))]; light.position.set(p[0], p[1], p[2]); }
    }
  }

  /** Rebuilds trail ribbons for the current tick, interpolated heads and camera. */
  #updateTrails(alpha: number): void {
    if (!this.#trails.length || !this.#clock) return;
    const c = this.#camera.position, cameraPosition: Vec3 = [c.x, c.y, c.z], step = alpha * PARTICLE_DT;
    for (const t of this.#trails) {
      const sim = this.#sims.get(t.layer.systemId), tick = sim ? sim.tick : 0;
      const heads = new Map<string, Vec3>();
      for (const p of this.#snapshots.get(t.layer.systemId) ?? []) heads.set(p.id, [p.position[0] + p.velocity[0] * step, p.position[1] + p.velocity[1] * step, p.position[2] + p.velocity[2] * step]);
      t.ribbon.update(t.history.paths(tick, heads), { cameraPosition, width: t.layer.width, endFade: t.layer.endFade, fadeHead: false });
    }
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
      const g = l.mesh.geometry;
      const colAttr = g.getAttribute('lifeColor') as THREE.InstancedBufferAttribute, spinAttr = g.getAttribute('spinAngle') as THREE.InstancedBufferAttribute, velAttr = g.getAttribute('worldVelocity') as THREE.InstancedBufferAttribute;
      const col = colAttr.array as Float32Array, spin = spinAttr.array as Float32Array, vel = velAttr.array as Float32Array;
      const cellAttr = g.getAttribute('cell') as THREE.InstancedBufferAttribute, cells = cellAttr.array as Float32Array, sprite = l.layer.sprite;
      const mixAttr = g.getAttribute('cellMix') as THREE.InstancedBufferAttribute, mix = mixAttr.array as Float32Array;
      const seedAttr = g.getAttribute('lifeSeed') as THREE.InstancedBufferAttribute, seeds = seedAttr.array as Float32Array;
      // Normal blending needs back-to-front order; additive does not.
      let order: ParticleState[] = particles ? (particles as ParticleState[]).slice(0, n) : [];
      if (l.layer.blend === 'normal' && n > 1) {
        const c = this.#camera.position, d2 = (q: ParticleState) => (q.position[0] - c.x) ** 2 + (q.position[1] - c.y) ** 2 + (q.position[2] - c.z) ** 2;
        order = order.map(q => [d2(q), q] as const).sort((a, b) => b[0] - a[0]).map(e => e[1]);
      }
      for (let i = 0; i < n; i++) {
        const p = order[i];
        if (sprite) {
          const b = spriteCellBlend(sprite.sheet, sprite.mode, sprite.fps, lifeFraction(p.ageTicks, p.lifetimeTicks, alpha), (p.ageTicks + alpha) * PARTICLE_DT, fnv1a32Utf8(p.parentRandomKey) / 4294967296, sprite.randomStart, sprite.variant, sprite.loop !== false);
          cells[i] = b.cell; mix[i * 2] = b.next; mix[i * 2 + 1] = sprite.crossfade ? b.t : 0;
        }
        const u = lifeFraction(p.ageTicks, p.lifetimeTicks, alpha);
        seeds[i * 2] = u; seeds[i * 2 + 1] = (fnv1a32Utf8(p.id) % 4096) / 4096;
        const o = i * 16, s = p.size * sampleLifeCurve(l.sizeSampler, u);
        sampleLifeGradient(l.colorSampler, u, rgbaScratch);
        col[i * 3] = rgbaScratch[0]; col[i * 3 + 1] = rgbaScratch[1]; col[i * 3 + 2] = rgbaScratch[2];
        op[i] = sampleLifeCurve(l.opacitySampler, u) * rgbaScratch[3];
        spin[i] = p.rotation === undefined ? 0 : p.rotation + (p.angularVelocity ?? 0) * (p.ageTicks + alpha) * PARTICLE_DT * spinAverage(l.layer.spinOverLife, lifeFraction(p.ageTicks, p.lifetimeTicks, alpha));
        vel[i * 3] = p.velocity[0]; vel[i * 3 + 1] = p.velocity[1]; vel[i * 3 + 2] = p.velocity[2];
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
      colAttr.needsUpdate = true; spinAttr.needsUpdate = true; velAttr.needsUpdate = true; cellAttr.needsUpdate = true; mixAttr.needsUpdate = true; seedAttr.needsUpdate = true;
    }
    this.#updateTrails(alpha);
    this.#updateLights(alpha);
    this.#updateMeshes(alpha);
  }

  #lastEmitAt = 0;
  #emitFrame(force: boolean): void {
    const cb = this.#callbacks.onFrame;
    const clock = this.#clock;
    const tick = clock ? clock.tick : 0;
    const playing = clock ? clock.playing : false;
    const suspended = this.#suspended;
    if (this.#disposed || !cb) return;
    if (!force && tick === this.#lastTick && playing === this.#lastPlaying && suspended === this.#lastSuspended) return;
    // 15 "transport display to 10 Hz": while playing, tick-only changes reach the editor at most every 100 ms (each one
    // re-renders the whole editor); play/pause/suspend changes, seeks (force) and the final tick are sent at once.
    const now = performance.now(), atEnd = clock ? tick >= clock.durationTicks : false;
    if (!force && playing && playing === this.#lastPlaying && suspended === this.#lastSuspended && !atEnd && now - this.#lastEmitAt < 100) return;
    this.#lastEmitAt = now;
    this.#lastTick = tick;
    this.#lastPlaying = playing;
    this.#lastSuspended = suspended;
    let live = this.#drawnPaths;
    for (const ps of this.#snapshots.values()) live += ps.length;
    const first = this.#plan?.systems[0];
    const ps = first ? this.#snapshots.get(first.id) : undefined;
    const mode = this.#pathCompile ? (this.#plan ? 'mixed' : 'paths') : this.#plan ? 'points' : 'none';
    cb({
      tick, playing, suspended, live, mode, ...(playing && now < this.#behindUntil ? { catchingUp: true } : {}),
      durationTicks: clock ? clock.durationTicks : 0,
      sampleParticleId: first && ps && ps.length ? namespacedParticleId(first.id, ps[0].id) : '',
    });
  }

  /**
   * 15/T37 benchmark primitive: draws the current tick once, synchronously, and waits for the GPU (gl.finish), so
   * the cost of a frame can be measured even where the browser throttles requestAnimationFrame.
   */
  /** 06 Solo: only these sink nodes are drawn (null clears the mask). Never changes the effect or its timing. */
  setSoloMask(ids: ReadonlySet<string> | null): void {
    this.#solo = ids && ids.size ? new Set(ids) : ids ? new Set() : null;
  }

  #applySolo(): void {
    const s = this.#solo, on = (id: string) => !s || s.has(id);
    for (const l of this.#layers) l.mesh.visible = on(l.layer.nodeId);
    for (const t of this.#trails) t.mesh.visible = on(t.nodeId);
    for (const l of this.#lights) l.light.visible = on(l.layer.nodeId);
    for (const m of this.#meshes) m.mesh.visible = on(m.layer.nodeId);
    for (const r of this.#ribbons) r.mesh.visible = on(r.nodeId);
  }

  measureFrame(): { cpuMs: number; totalMs: number } {
    const gl = this.#renderer.getContext(), t0 = performance.now();
    if (this.#plan && this.#clock) this.#upload(0);
    this.#applySolo();
    this.#applyHighlight();
    this.#renderer.info.reset(); // Counters cover the whole frame (every composer pass), not just the last one.
    if (this.#composer) this.#composer.render(); else this.#renderer.render(this.#scene, this.#camera);
    const t1 = performance.now();
    gl.finish();
    return { cpuMs: t1 - t0, totalMs: performance.now() - t0 };
  }

  #behindUntil = 0;
  #loop = (now: number): void => {
    if (this.#disposed) return;
    this.#raf = requestAnimationFrame(this.#loop);
    if (this.#contextLost) return; // Nothing can be drawn until the browser restores the GPU context.
    const raw = this.#lastTime < 0 ? 0 : Math.max(0, (now - this.#lastTime) / 1000), dt = Math.min(MAX_FRAME_SECONDS, raw);
    // 07: a slow frame while playing (≥ 100 ms, i.e. under 10 fps) flags "Catching up"; no simulation tick is ever dropped.
    if (raw >= 0.1 && this.#clock?.playing && document.visibilityState === 'visible') this.#behindUntil = now + 1000;
    this.#lastTime = now;
    const clock = this.#clock;
    if (clock && clock.playing && !this.#failed) {
      const r = clock.advance(dt);
      if (r.ticksAdvanced > 0 && this.#plan) this.#advanceSims(r.ticksAdvanced);
      // Paths are a pure function of the tick: compile only the landing tick, no interpolation.
      if (r.ticksAdvanced > 0 && !this.#failed) this.#pathTick(clock.tick);
      if (this.#plan && !this.#failed) this.#upload(clock.alpha);
      if (r.reachedEnd && this.#looping && !this.#failed) { this.restart(); this.#callbacks.onLoop?.(); }
    }
    this.#emitFrame(false);
    if (this.#disposed) return; // onFrame may have disposed the viewport; never render after dispose.
    this.#controls.update();
    // Re-billboard ribbons when orbiting (damping keeps moving the camera after input stops).
    if (this.#pathPlan && !this.#camera.position.equals(this.#ribbonCamera)) this.#updateRibbons();
    if (this.#disposed) return;
    // Presentation (flash overlay, camera impulse) applies to this rendered frame only; orbit state is untouched.
    const pres = this.#reducedMotion ? null : this.#presentation, t = (this.#clock ? this.#clock.tick + this.#clock.alpha : 0);
    this.#effectTime.value = t * PARTICLE_DT;
    let shaken = false;
    const cam = this.#camera, savedPos = cam.position.clone(), savedQuat = cam.quaternion.clone();
    if (pres) {
      let flash = 0, color = '#ffffff';
      for (const f of pres.flashes) { const u = (t - f.tick) / f.durationTicks; if (u >= 0 && u < 1) { const a = f.alpha * (1 - u); if (a > flash) { flash = a; color = f.color.srgb; } } }
      if (this.#flashEl) { this.#flashEl.style.opacity = String(flash); this.#flashEl.style.background = color; }
      for (const i of pres.impulses) {
        const u = (t - i.tick) / i.durationTicks;
        if (u < 0 || u >= 1) continue;
        const k = (1 - u) * (1 - u), ts = t * PARTICLE_DT * 40;
        cam.position.x += valueNoise4(i.seed, ts, 0.1, 0.2, 0) * i.translation * k;
        cam.position.y += valueNoise4(i.seed + 1, ts, 0.3, 0.4, 0) * i.translation * k;
        cam.position.z += valueNoise4(i.seed + 2, ts, 0.5, 0.6, 0) * i.translation * k;
        cam.rotateZ(valueNoise4(i.seed + 3, ts, 0.7, 0.8, 0) * i.rotation * k);
        shaken = true;
      }
    } else if (this.#flashEl) this.#flashEl.style.opacity = '0';
    this.#applySolo();
    this.#applyHighlight();
    this.#renderer.info.reset(); // Counters cover the whole frame (every composer pass), not just the last one.
    if (this.#composer) this.#composer.render();
    else this.#renderer.render(this.#scene, this.#camera);
    if (shaken) { cam.position.copy(savedPos); cam.quaternion.copy(savedQuat); }
  };

  /** 12 "dark/light background" inspection: arena backdrop and floor colours only; effects are unchanged. */
  setBackground(mode: 'dark' | 'light'): void {
    const light = mode === 'light';
    (this.#scene.background as THREE.Color).set(light ? 0xb9bec8 : 0x0b0d12);
    this.#ground.material.color.set(light ? 0x8a9099 : 0x10131a);
    if (!this.#disposed) this.#emitFrame(true);
  }

  #presentation: ParticlePreviewPlan['presentation'] | null = null;
  #flashEl: HTMLDivElement | null = null;
  /** 08/12: presentation effects obey prefers-reduced-motion. */
  #reducedMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** 12: explicit reduced-effects switch (overrides the system preference for this viewport). */
  setReducedEffects(on: boolean): void { this.#reducedMotion = on; if (!this.#disposed) this.#emitFrame(true); }
  #looping = false;
  /** 12 transport Loop: at the end, restart from tick 0 with the same seed. */
  setLoop(on: boolean): void { this.#looping = on; }
  /** 12 view tools: floor grid on/off (preview only). */
  setGrid(on: boolean): void { this.#grid.visible = on; for (const m of this.#markers) m.visible = on; }
  /** 12 transport speed (.25x/.5x/1x); preview-only, kept across recompiles. */
  #speed = 1;
  setSpeed(speed: number): void { this.#speed = speed; this.#clock?.setSpeed(speed); }

  /** Glow (bloom) on/off for inspection (08 "Provide glow-off inspection"); tone mapping stays identical. */
  setGlow(on: boolean): void {
    this.#glowWanted = on;
    if (this.#bloom) this.#bloom.enabled = on && this.#profile !== 'economy';
    if (!this.#disposed) this.#emitFrame(true);
  }

  get glow(): boolean { return this.#bloom?.enabled ?? false; }
  /**
   * WP24/T38 resource check: what this viewport holds in its scene (objects, unique geometries, materials and
   * textures reachable from it), so repeated loads can be shown to plateau instead of growing.
   */
  resourceStats(): { objects: number; geometries: number; materials: number; textures: number; contextLost: boolean } {
    let objects = 0;
    const geos = new Set<unknown>(), mats = new Set<THREE.Material>(), texs = new Set<unknown>();
    this.#scene.traverse(o => {
      objects++;
      const m = o as THREE.Mesh;
      if (m.geometry) geos.add(m.geometry);
      for (const mat of m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : []) {
        mats.add(mat);
        for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) texs.add(v);
        const u = (mat as THREE.ShaderMaterial).uniforms;
        if (u) for (const x of Object.values(u)) if (x?.value instanceof THREE.Texture) texs.add(x.value);
      }
    });
    return { objects, geometries: geos.size, materials: mats.size, textures: texs.size, contextLost: this.#contextLost };
  }
  /** The effect's own glow settings (EffectOutput glowStrength / glowRadius / glowThreshold). */
  setGlowSettings(s: { strength: number; radius: number; threshold: number; limit: number }): void {
    if (!this.#bloom) return;
    this.#bloom.strength = s.strength; this.#bloom.radius = s.radius; this.#bloom.threshold = s.threshold;
    this.#bloom.materialHighPassFilter.uniforms.uGlowLimit.value = s.limit;
    this.#emitFrame(true);
  }

  /**
   * 15 preview profiles: reference (device pixel ratio up to 2, full glow), balanced (default: pixel ratio up to 1.5,
   * at most 1920×1080 internal pixels), economy (at most 1280×720, glow off). Rendering quality only - the
   * document, seed and simulation are never changed.
   */
  #profile: 'reference' | 'balanced' | 'economy' = 'balanced';
  setQualityProfile(profile: 'reference' | 'balanced' | 'economy'): void {
    this.#profile = profile;
    if (this.#bloom) this.#bloom.enabled = profile === 'economy' ? false : this.#glowWanted;
    this.#resize();
    if (!this.#disposed) this.#emitFrame(true);
  }
  get qualityProfile(): 'reference' | 'balanced' | 'economy' { return this.#profile; }
  #glowWanted = true;

  #resize(): void {
    if (this.#disposed) return;
    const w = Math.max(1, this.#container.clientWidth), h = Math.max(1, this.#container.clientHeight);
    const dpr = window.devicePixelRatio || 1, p = this.#profile;
    const cap = p === 'reference' ? Math.min(2, dpr) : p === 'balanced' ? Math.min(1.5, dpr, Math.sqrt((1920 * 1080) / (w * h))) : Math.min(1, Math.sqrt((1280 * 720) / (w * h)));
    this.#renderer.setPixelRatio(Math.max(0.25, cap));
    this.#renderer.setSize(w, h, false);
    this.#composer?.setPixelRatio(this.#renderer.getPixelRatio());
    this.#composer?.setSize(w, h);
    this.#camera.aspect = w / h;
    this.#camera.updateProjectionMatrix();
    this.#framePaths();
  }
}
