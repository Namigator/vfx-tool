// Unreal (Niagara) exporter IR: the intermediate representation between the compiled preview plans
// (graph/toParticles.ts, graph/toPaths.ts — the same plans the Roblox exporter reads) and a UE5 Niagara import.
//
// Units and axes (state explicit per task): the tool authors in METRES, seconds, right-handed, +Y up
// (src/export/roblox/types.ts documents the same source convention). Unreal Engine uses CENTIMETRES, seconds,
// LEFT-handed, +Z up (X forward, Y right). The conversion used everywhere in this exporter is the same swap
// Unreal's own FBX/glTF importers use for a right-handed Y-up source:
//   ue.X = src.X * 100
//   ue.Y = src.Z * 100
//   ue.Z = src.Y * 100      (our up -> Unreal's up)
// i.e. keep X, swap Y and Z, scale metres -> centimetres by 100. Swapping two axes turns a right-handed frame into
// a left-handed one, which is exactly the handedness flip Unreal expects, so a positively-wound authored shape keeps
// its winding in Unreal. The one place this matters beyond position/size is *signed rotation about a single axis*
// (e.g. a vortex/swirl force's spin direction, ribbon twist): because the flip is a reflection, not a pure rotation,
// a clockwise turn about our Y axis becomes a clockwise turn about Unreal's Z axis when seen from the SAME side, but
// tools differ on which side is "the same side" for a mirrored frame — this exporter keeps the swirl's numeric sign
// unchanged and calls it out in the report wherever a directional spin is exported, so a mirrored bolt/vortex can be
// flipped by hand in Niagara if the importer's convention disagrees. Everything else (position, velocity direction,
// size, colour, curves) is convention-free and needs no caveat.
//
// Unlike Roblox, Niagara has few hard limits (no 20-key sequence cap, no beam-segment budget), so curves keep their
// full key set and nothing is thinned for a runtime budget; approximations here are about ENGINE FEATURE MAPPING
// (which stock Niagara module covers a given VFX Studio behaviour), not a runtime ceiling.

export const CM_PER_METER = 100;
export type Vec3 = [number, number, number];
/** src (metres, Y-up, right-handed) -> Unreal (centimetres, Z-up, left-handed). See file header for the mapping. */
export const toUe = (p: readonly number[]): Vec3 => [p[0] * CM_PER_METER, p[2] * CM_PER_METER, p[1] * CM_PER_METER];
/** Direction/size vectors use the same axis swap but no translation (already relative). */
export const toUeDir = (p: readonly number[]): Vec3 => [p[0], p[2], p[1]];

/** A curve key: normalized life time 0..1 -> value (and, for colour, srgb 0..1 channels). */
export type UeFloatKey = { t: number; v: number };
export type UeColorKey = { t: number; r: number; g: number; b: number; a: number };
/** Sparse step track: the value holds from its tick until the next entry (60 ticks/s, same as the source). */
export type UeStepTrack = [tick: number, value: number][];

export type UeSpawnShape =
  | { kind: 'point' }
  | { kind: 'sphere'; radiusCm: number }
  | { kind: 'box'; extentsCm: Vec3 }
  | { kind: 'cone'; angleDeg: number; radiusCm: number }
  | { kind: 'disc'; radiusCm: number }
  | { kind: 'cylinder'; radiusCm: number; heightCm: number };

export type UeFlipbook = {
  columns: number;
  rows: number;
  /** Frames per second; 0 = a single random static cell per particle (SubImageIndex set once at spawn). */
  fps: number;
  loop: boolean;
  randomStartFrame: boolean;
};

export type UeBlendMode = 'additive' | 'translucent' | 'opaque';
export type UeAlignment = 'camera' | 'velocity' | 'worldUpCameraFacing';

/** One Niagara emitter: rate/bursts/shape/forces/renderer — engine-agnostic until the plugin maps it onto a template. */
export type UeEmitter = {
  name: string;
  /** Best-effort choice of stock engine emitter template to start from (the plugin may pick a different one if the chosen template lacks a needed module; see report). */
  suggestedTemplate: 'Fountain' | 'SimpleSpriteBurst' | 'Minimal' | 'Ribbon' | 'Light';
  /** Local-space spawn origin at tick 0, relative to the effect origin (Source anchor), Unreal cm. */
  position: Vec3;
  /** Spawn axis (unit vector), Unreal space. */
  direction: Vec3;
  shape: UeSpawnShape;
  /** Particles per second over time (sparse step track; 0 = off). */
  rateOverTime: UeStepTrack;
  bursts: { tick: number; count: number; positionCm?: Vec3 }[];
  lifetimeSecMin: number;
  lifetimeSecMax: number;
  speedCmSMin: number;
  speedCmSMax: number;
  /** cm/s^2, Unreal space (gravity + constant acceleration forces combined). */
  acceleration: Vec3;
  /** Drag module coefficient (1/s), speed halves every ln(2)/drag seconds — same convention as our runtime drag. */
  drag: number;
  /** Curl Noise Force (Niagara keeps this unlike Roblox): amplitude cm/s^2 and frequency. Undefined = no noise. */
  noise?: { amplitudeCmS2: number; frequency: number };
  /** Point Attraction Force. Undefined = none. */
  attract?: { positionCm: Vec3; strengthCmS2: number; /** pull eases inside this radius */ softRadiusCm?: number; /** particles reaching it die (0 = never) */ killRadiusCm?: number };
  /** Vortex/curl around an axis through `positionCm`. Undefined = none. See header re: sign convention under the axis flip. */
  vortex?: { positionCm: Vec3; axis: Vec3; strengthCmS2: number; /** pull toward the axis */ inwardCmS2?: number; /** e-folding distance of the swirl */ falloffCm?: number };
  /** Ground collision (Niagara "Collision" module against a Z-up plane at groundZCm). */
  groundCollision?: { groundZCm: number; restitution: number; mode: 'bounce' | 'kill' | 'stop' };
  sizeCmMin: number;
  sizeCmMax: number;
  sizeOverLife: UeFloatKey[];
  colorOverLife: UeColorKey[];
  /** 1 = opaque particle, fades toward 0 -> transparent (i.e. alpha, NOT Roblox's inverted Transparency). */
  opacityOverLife: UeFloatKey[];
  spinDegMin: number;
  spinDegMax: number;
  angularVelocityDegSMin: number;
  angularVelocityDegSMax: number;
  alignment: UeAlignment;
  /** Velocity-aligned stretch ratio (>1 = stretched along travel direction); 1 = no stretch. */
  stretchRatio: number;
  blend: UeBlendMode;
  /** Library sprite sheet file (for texture import), absent = default engine particle sprite. */
  textureFile?: string;
  flipbook?: UeFlipbook;
  /** Emitter loops forever vs plays once (matches the system-level loop option; kept per-emitter for clarity). */
  loop: boolean;
  /** Moving spawn origin (projectiles / event-born): position per tick, Unreal cm, sparse (changed ticks only). */
  sourceTrack?: [tick: number, positionCm: Vec3][];
  attachToSource?: boolean;
};

/** Ribbon/beam layer (lightning, streams): Niagara Ribbon renderer fed by a per-tick point-cloud data interface. */
export type UeRibbon = {
  name: string;
  color: UeColorKey; // constant colour (time-varying handled via frames' own alpha/width, like Roblox beams)
  blend: UeBlendMode;
  textureFile?: string;
  widthCm: number;
  /** Fraction (0..0.5) of each path's length over which both ends taper and fade. */
  endFade?: number;
  /** Per-tick geometry: `points` = the first path as [x,y,z,widthCm] in Unreal cm (empty = hidden this tick);
   *  `paths` = every path of the layer (trunk + branches...) with its opacity at that tick (layer opacity x the
   *  path's own opacity, e.g. a flickering, decaying bolt). Frames are stored only when something changed. */
  frames: { tick: number; points: Vec3Width[]; paths?: { points: Vec3Width[]; alpha: number }[] }[];
};
export type Vec3Width = [number, number, number, number];

export type UeLight = {
  name: string;
  color: [number, number, number];
  /** Niagara Light renderer intensity per tick (sparse step track; candela-ish, engine scale — see report note). */
  intensity: UeStepTrack;
  radiusCm: number;
  positionCm: Vec3;
  sourceTrack?: [tick: number, positionCm: Vec3][];
};

export type UeReportItem = { level: 'approximated' | 'dropped' | 'info'; item: string; message: string };

export type UnrealEffect = {
  name: string;
  durationTicks: number;
  ticksPerSecond: 60;
  emitters: UeEmitter[];
  ribbons: UeRibbon[];
  lights: UeLight[];
  /** Effect origin in world space isn't needed here (the package is authored at the origin; the importer places the actor). */
  textures: string[];
  report: UeReportItem[];
};
