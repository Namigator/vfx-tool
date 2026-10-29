// Unity export IR: what integrations/unity/VfxStudio (C#) reads from <name>/effect.unity.json.
//
// Shaped for Unity's JsonUtility (the importer needs no JSON package): plain objects, no tuples or unions, fixed-size
// vectors as float arrays, per-key data as parallel arrays, booleans as flags. Missing fields read as 0/""/false.
//
// Units and axes: metres, seconds. VFX Studio is right-handed +Y up; Unity is LEFT-handed +Y up (+Z forward). The
// export mirrors Z: unity = (x, y, -z), the same flip glTF importers use. Positions, directions and accelerations are
// converted; a signed swirl (vortex) keeps its numeric sign, so a mirrored spin may need flipping by hand (reported).
// Ticks are 60 per second, like the editor. The prefab origin is the Source anchor (same as the Godot export), so
// placing the prefab at a caster's hand plays the effect from there.

export type UnityReportItem = { level: 'approximated' | 'dropped' | 'info'; item: string; message: string };

export type UnityEmitter = {
  name: string;
  /** Spawn origin at tick 0 relative to the prefab origin. */
  position: number[];
  /** Unit emission axis. */
  direction: number[];
  shape: 'point' | 'sphere' | 'box' | 'cone' | 'disc';
  radius: number;
  /** Cone half-angle (degrees). */
  angleDeg: number;
  /** Box full size. */
  boxSize: number[];
  /** Particles per second from each tick until the next entry (sparse step track). */
  rateTicks: number[];
  rateValues: number[];
  burstTicks: number[];
  burstCounts: number[];
  /** 1 when the burst has its own position (event-born bursts), then 3 floats in burstPositions; else 0 and 3 zeros. */
  burstHasPosition: number[];
  burstPositions: number[];
  lifetimeMin: number;
  lifetimeMax: number;
  speedMin: number;
  speedMax: number;
  /** World-space acceleration (gravity + constant forces), m/s². */
  acceleration: number[];
  /** Speed halves every ln(2)/drag seconds (dv/dt = -drag·v). */
  drag: number;
  hasNoise: boolean;
  /** Curl-noise acceleration amplitude (m/s²) and spatial frequency (1/m). */
  noiseAmplitude: number;
  noiseFrequency: number;
  hasAttract: boolean;
  attractPosition: number[];
  /** m/s² toward the point. */
  attractStrength: number;
  /** Particles reaching this distance die (0 = never). */
  attractKillRadius: number;
  hasVortex: boolean;
  vortexPosition: number[];
  vortexAxis: number[];
  /** Tangential and inward acceleration, m/s². */
  vortexStrength: number;
  vortexInward: number;
  hasCollision: boolean;
  groundY: number;
  restitution: number;
  collisionMode: 'bounce' | 'kill' | 'stop' | '';
  sizeMin: number;
  sizeMax: number;
  /** Size over life as a multiplier of the birth size (normalized life 0..1). Empty = constant. */
  sizeKeysT: number[];
  sizeKeysV: number[];
  /** Colour over life, sRGB 0..1 (3 floats per key). Empty = white. */
  colorKeysT: number[];
  colorKeysRgb: number[];
  /** Opacity over life 0..1. Empty = opaque. */
  alphaKeysT: number[];
  alphaKeysV: number[];
  spinMinDeg: number;
  spinMaxDeg: number;
  angularVelocityMinDeg: number;
  angularVelocityMaxDeg: number;
  /** flat = lying on the ground (Horizontal Billboard): the editor's worldAxis quads facing world up. */
  alignment: 'camera' | 'velocity' | 'worldUp' | 'flat';
  /** Length/width of velocity-aligned sprites (1 = square). */
  stretchRatio: number;
  blend: 'additive' | 'translucent' | 'opaque';
  /** Colour x (1 + emission): HDR brightness (white-hot cores). */
  emission: number;
  /** Sprite sheet file under Textures/ ("" = soft round default). */
  texture: string;
  flipColumns: number;
  flipRows: number;
  /** Frames per second; 0 = one static cell per particle. */
  flipFps: number;
  flipLoop: boolean;
  flipRandomStart: boolean;
  /** Static sheets (flipFps 0): the authored cell, or -1 = a random cell per particle. */
  flipStartFrame: number;
  /** Particles move with the emitter (local simulation space). */
  attachToSource: boolean;
  /** Moving spawn origin (projectiles): position per tick, changed ticks only (3 floats per tick). */
  trackTicks: number[];
  trackPositions: number[];
  /** Per-particle trails (Unity Trails module), for trails left by many particles (sparks). Absent = none. Curves run from
   *  the HEAD (0, the particle) to the oldest tail (1), Unity's order. Width in metres; trailOnly = no quad at the head. */
  trail?: {
    lifetime: number; width: number; widthKeysT: number[]; widthKeysV: number[];
    colorKeysT: number[]; colorKeysRgb: number[]; alphaKeysT: number[]; alphaKeysV: number[];
    blend: 'additive' | 'translucent' | 'opaque'; emission: number; texture: string; trailOnly: boolean; seedName: string;
  };
  /** Mesh particles: Meshes/<file> per particle (sizeMin/Max already include the layer scale). orientation as the editor:
   *  tumble (random 3D rotation + spin), velocity (+Y along travel), upright (+Y up, random yaw, lean up to tilt rad),
   *  fixed (+Y along direction). Absent = billboards. */
  mesh?: { file: string; scaleY: number; orientation: 'tumble' | 'velocity' | 'upright' | 'fixed'; direction: number[]; tilt: number; lit: boolean };
};

export type UnityLight = {
  name: string;
  /** sRGB 0..1. */
  color: number[];
  /** Unity Light.intensity per tick (sparse step track). */
  intensityTicks: number[];
  intensityValues: number[];
  range: number;
  position: number[];
  trackTicks: number[];
  trackPositions: number[];
};

export type UnityRibbonPath = { alpha: number; /** x, y, z, width per point. */ points: number[]; /** Sheet cell drawn on this path. */ cell: number };
export type UnityRibbonFrame = { tick: number; paths: UnityRibbonPath[] };
/** Beam/ribbon layer (lightning, streams): baked geometry per tick (frames only where it changed), drawn by LineRenderers. */
export type UnityRibbon = {
  name: string;
  /** sRGB 0..1; per-path alpha already includes the layer opacity. */
  color: number[];
  additive: boolean;
  /** Colour x (1 + emission). */
  emission: number;
  texture: string;
  /** Fraction (0..0.5) of each path's length over which both ends taper and fade. */
  endFade: number;
  /** Textured: the sheet's [columns, rows]; each path draws ONE cell (paths[].cell, the layer's `cell` by default), like
   *  the editor - not the whole atlas. tile = the cell repeats every `tile` metres along the path (0 = stretched once);
   *  scroll = UV per second. Untextured: softness = the outer fraction of the half-width that fades out (1 = soft glow,
   *  0 = hard edge). Mirrors Godot's vfx_ribbons.gd. */
  grid: number[];
  cell: number;
  tile: number;
  scroll: number[];
  softness: number;
  /** Trails baked as ribbons: only the start (old tail) fades, the last point (the head) stays full. Absent = both ends. */
  keepHead?: boolean;
  frames: UnityRibbonFrame[];
};

export type UnityEffect = {
  format: 'vfx-studio-unity';
  version: 1;
  name: string;
  durationTicks: number;
  ticksPerSecond: 60;
  /** Height of the Source anchor (the prefab origin) above the floor in the editor, metres. */
  sourceHeight: number;
  emitters: UnityEmitter[];
  lights: UnityLight[];
  ribbons: UnityRibbon[];
  textures: string[];
  /** Mesh files under Meshes/ (OBJ, written next to effect.unity.json by every exporter: see unityEffectFrom's files). */
  meshes: string[];
};
