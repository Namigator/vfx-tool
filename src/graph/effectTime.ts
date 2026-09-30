// Effect-time drivers (05): nodes whose normalized scalar output is a function of effect seconds.
// EffectTimeCurve samples an authored curve; Oscillator is a periodic wave between min and max.
import type { CurveValue, ParameterValue } from '../model/types.ts';
import { evaluateCurve } from '../runtime/curves.ts';

export const EFFECT_TIME_NODES = new Set(['EffectTimeCurve', 'Oscillator']);
export type OscillatorWave = 'sine' | 'triangle' | 'square' | 'saw';

/** Wave shape in [0,1] at cycle position u in [0,1); every shape starts at 0 (min) when u = 0. */
export function waveAt(wave: OscillatorWave, u: number): number {
  if (wave === 'sine') return 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
  if (wave === 'triangle') return u < 0.5 ? 2 * u : 2 - 2 * u;
  if (wave === 'square') return u < 0.5 ? 0 : 1;
  return u;
}

/**
 * Value of an effect-time driver at `seconds`. Throws RangeError/TypeError for an invalid curve
 * (callers turn it into an addressed diagnostic).
 */
export function effectTimeValue(type: string, param: (id: string) => ParameterValue, seconds: number): number {
  if (type === 'Oscillator') {
    const f = param('frequency') as number, ph = param('phase') as number;
    const lo = param('min') as number, hi = param('max') as number;
    const c = seconds * f + ph, u = c - Math.floor(c);
    return lo + (hi - lo) * waveAt(param('waveform') as OscillatorWave, u);
  }
  const curve = param('curve') as CurveValue;
  if (curve?.domain !== 'effectSeconds') throw new TypeError('curve must use domain "effectSeconds".');
  return evaluateCurve(curve, seconds, { min: 0, max: 1 });
}
