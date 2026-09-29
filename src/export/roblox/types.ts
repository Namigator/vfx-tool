// Roblox exporter (user order 2026-09-29: engine export, first target Roblox). Intermediate representation between
// the compiled preview plans (graph/toParticles.ts, graph/toPaths.ts) and the Roblox output: native instances
// (ParticleEmitter, Beam, PointLight) plus a small Luau player that replays the effect timeline at 60 ticks/s.
//
// Units: studs (1 m = STUDS_PER_METER studs), seconds, degrees. Positions are relative to the effect origin (the
// document's Source anchor), Roblox axes = our axes (right-handed, +Y up). Colours are sRGB 0..1.
// Everything Roblox cannot do natively is listed in `report` — nothing is dropped silently (16-PORTABILITY).

export const STUDS_PER_METER = 1 / 0.28;
/** Roblox NumberSequence / ColorSequence keypoint limit. */
export const MAX_SEQUENCE_KEYS = 20;

export type Vec3 = [number, number, number];
/** NumberSequence keypoint: time 0..1, value, envelope (random ± per particle). */
export type RbxNumberKey = { t: number; v: number; e: number };
/** ColorSequence keypoint: time 0..1, sRGB 0..1. */
export type RbxColorKey = { t: number; c: [number, number, number] };
/** Sparse step track: the value holds from its tick until the next entry. */
export type RbxStepTrack = [tick: number, value: number][];

export type RbxFlipbook = {
  layout: 'Grid2x2' | 'Grid4x4' | 'Grid8x8';
  mode: 'Loop' | 'OneShot' | 'PingPong' | 'Random';
  /** Frames per second (min, max); 0 with startRandom = one random static cell per particle. */
  framerate: [number, number];
  startRandom: boolean;
};

/** One ParticleEmitter on its own invisible anchored Part (the Part's +Y is the emission direction). */
export type RbxEmitter = {
  /** Unique instance name, e.g. "flame_tongues_a". */
  name: string;
  /** Origin-relative Part position (studs) at tick 0, and its +Y (unit) = EmissionDirection Top. */
  position: Vec3;
  direction: Vec3;
  /** Emitter Part size (studs) = the emission shape extents. */
  partSize: Vec3;
  shape: 'Box' | 'Sphere' | 'Cylinder' | 'Disc';
  shapeStyle: 'Volume' | 'Surface';
  shapeInOut: 'Outward' | 'Inward' | 'InAndOut';
  /** SpreadAngle (degrees, x and z). */
  spreadAngle: [number, number];
  /** studs/s */
  speed: [number, number];
  /** seconds */
  lifetime: [number, number];
  /** studs/s² */
  acceleration: Vec3;
  /** Roblox Drag: speed halves every 1/drag seconds. */
  drag: number;
  /** Diameter in studs over normalized life. */
  size: RbxNumberKey[];
  transparency: RbxNumberKey[];
  color: RbxColorKey[];
  /** Vertical stretch over life (-3..3); absent = none. */
  squash?: RbxNumberKey[];
  lightEmission: number;
  lightInfluence: number;
  brightness: number;
  /** Library sprite sheet file (for asset upload), absent = the default round particle. */
  textureKey?: string;
  flipbook?: RbxFlipbook;
  orientation: 'FacingCamera' | 'FacingCameraWorldUp' | 'VelocityParallel' | 'VelocityPerpendicular';
  /** degrees and degrees/s */
  rotation: [number, number];
  rotSpeed: [number, number];
  zOffset: number;
  lockedToPart: boolean;
  /** Particles per second over time (0 = off). Starts at 0 unless the first entry says otherwise. */
  rate: RbxStepTrack;
  /** :Emit(count) at a tick; with `position` the Part is moved there (origin-relative studs) first. */
  bursts: { tick: number; count: number; position?: Vec3 }[];
  /** Moving source (projectiles): Part position per tick (sparse, changed ticks only). */
  path?: [tick: number, position: Vec3][];
  /** Keyframed emitter properties the player sets per tick (Speed / Lifetime as [min,max] scale, Acceleration...). */
  tracks?: { property: 'SpeedScale' | 'SizeScale' | 'LifetimeScale' | 'Drag' | 'AccelerationY'; keys: [number, number][] }[];
  /** Colour/transparency keyframes (e.g. an animated Colour knob): same keypoint times as color/transparency. */
  colorFrames?: { tick: number; color: RbxColorKey[]; transparency: RbxNumberKey[] }[];
};

/** Ribbon/path layer (lightning, streams, beams): chains of Beam segments whose attachment points move per tick. */
export type RbxBeamLayer = {
  name: string;
  /** Width in studs at the segment start/end is width × widthOverPath(u) × path.widthScale (taper baked). */
  color: [number, number, number];
  /** 0 = opaque. */
  transparency: number;
  lightEmission: number;
  brightness: number;
  textureKey?: string;
  textureMode: 'Stretch' | 'Wrap' | 'Static';
  textureLength: number;
  /** Beam.TextureSpeed (scroll). */
  textureSpeed: number;
  zOffset: number;
  /**
   * Frames where the geometry changed: each path is a list of [x,y,z,width] points (studs); [] = hidden.
   * A frame with `widthScale` instead of `paths` keeps the previous full frame's points and alphas, with every width
   * multiplied by widthScale (a pulsing bolt).
   */
  frames: { tick: number; paths?: { points: [number, number, number, number][]; alpha: number }[]; widthScale?: number }[];
  /** Largest segment count used by any frame (the player pre-creates this many beams). */
  maxSegments: number;
  /**
   * Same geometry as another beam layer (lightning core/inner/outer/halo passes share one bolt): `frames` is empty and
   * the player uses that layer's frames with every width multiplied by `widthRatio`.
   */
  sameGeometryAs?: string;
  widthRatio?: number;
  /** Frames were thinned: between two consecutive full frames of the same shape the player blends points, widths and alpha linearly. */
  interpolate?: boolean;
};

export type RbxLight = {
  name: string;
  color: [number, number, number];
  /** studs */
  range: number;
  position: Vec3;
  /** PointLight.Brightness per tick (sparse; 0 = off). */
  brightness: RbxStepTrack;
  path?: [tick: number, position: Vec3][];
};

export type RbxReportItem = { level: 'approximated' | 'dropped' | 'info'; item: string; message: string };

export type RobloxEffect = {
  name: string;
  /** 60 ticks per second. */
  durationTicks: number;
  studsPerMeter: number;
  emitters: RbxEmitter[];
  beams: RbxBeamLayer[];
  lights: RbxLight[];
  /** Sprite sheet files referenced by textureKey (upload these, then pass their rbxassetid map to the writer). */
  textures: string[];
  report: RbxReportItem[];
};
