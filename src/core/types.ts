export const FAMILIES = ['lightning','fire','ice','water','wind','earth','light','shadow','poison','energy'] as const;
export type Family = typeof FAMILIES[number];
export type Vec3 = [number, number, number];
export interface Parameters {
  scale: number; intensity: number; count: number; spread: number; speed: number;
  turbulence: number; branches: number; width: number; charge: number; active: number;
  decay: number; color: string; secondaryColor: string; volume: number; pitch: number;
}
export interface Recipe {
  schemaVersion: 1; generatorVersion: '1.0.0'; id: string; name: string; family: Family;
  seed: number; source: Vec3; target: Vec3; parameters: Parameters;
}
export interface Stroke { points: Vec3[]; width: number; color: string; opacity: number }
export interface Particle { position: Vec3; size: number; color: string; opacity: number; kind: 'spark'|'mist'|'orb' }
export interface Solid { position: Vec3; rotation: Vec3; scale: Vec3; color: string; opacity: number; shape: 'shard'|'rock'|'orb' }
export interface Ring { center: Vec3; radius: number; width: number; color: string; opacity: number }
export interface Light { position: Vec3; color: string; intensity: number }
export interface EffectFrame {
  strokes: Stroke[]; particles: Particle[]; solids: Solid[]; rings: Ring[]; lights: Light[];
  phase: 'ready'|'charging'|'active'|'decay'|'finished'; time: number;
}
export interface ParamSpec { key: keyof Parameters; label: string; min: number; max: number; step: number; unit: string; restart: boolean }
export const duration = (r:Recipe):number => r.parameters.charge+r.parameters.active+r.parameters.decay;
