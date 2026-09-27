// Effect-time signal evaluation (05/24): a small expression graph evaluated at effect seconds. Producers are
// EffectTimeCurve, Oscillator and Time; ScalarMath combines them (and constants); constant value nodes
// (Constant, RandomRange, PublicParameter) are delegated to the compiler's own once-per-cast evaluator.
// Shared by the particle and path compilers so every time-driven parameter accepts the same node chains.
import type { ParameterValue } from '../model/types.ts';
import { effectTimeValue } from './effectTime.ts';
import { TICKS_PER_SECOND } from '../model/types.ts';

/** Nodes whose output varies over effect time. ScalarMath does when any operand does. */
export const TIME_SOURCES = new Set(['EffectTimeCurve', 'Oscillator', 'Time']);

export type SignalNode = { id: string; type: string; enabled: boolean };
export type SignalContext = {
  node(id: string): SignalNode | undefined;
  param(id: string, parameter: string): ParameterValue;
  /** Node output feeding `nodeId.port`, if any. */
  source(nodeId: string, port: string): { nodeId: string; port: string } | undefined;
  /** Schedule window feeding a Time node's `window` input, in ticks. */
  window(nodeId: string): { startTicks: number; durationTicks: number } | undefined;
  /** Once-per-cast value of a constant value node (Constant, RandomRange, PublicParameter). */
  constant(nodeId: string): number;
};

/** True when the output of `nodeId` changes over effect time. */
export function isTimeVarying(ctx: Pick<SignalContext, 'node' | 'source'>, nodeId: string, depth = 0): boolean {
  const n = ctx.node(nodeId);
  if (!n || depth > 32) return false;
  if (TIME_SOURCES.has(n.type)) return true;
  if (n.type !== 'ScalarMath') return false;
  return ['a', 'b'].some(p => { const s = ctx.source(nodeId, p); return s !== undefined && isTimeVarying(ctx, s.nodeId, depth + 1); });
}

export class SignalError extends Error {
  readonly nodeId: string;
  readonly parameter?: string;
  constructor(message: string, nodeId: string, parameter?: string) { super(message); this.nodeId = nodeId; if (parameter !== undefined) this.parameter = parameter; }
}

/** Value of `nodeId`'s output `port` at effect `seconds`. Throws SignalError with an addressable node. */
export function evalSignal(ctx: SignalContext, nodeId: string, port: string, seconds: number, depth = 0): number {
  const n = ctx.node(nodeId);
  if (!n) throw new SignalError(`Signal source "${nodeId}" does not exist.`, nodeId);
  if (depth > 32) throw new SignalError(`Signal chain through "${nodeId}" is too deep (or cyclic).`, nodeId);
  const p = (id: string) => ctx.param(nodeId, id);
  switch (n.type) {
    case 'EffectTimeCurve':
    case 'Oscillator':
      try { return effectTimeValue(n.type, p, seconds); } catch (e) { throw new SignalError(`${n.type} "${nodeId}": ${e instanceof Error ? e.message : String(e)}`, nodeId, 'curve'); }
    case 'Time': {
      const w = ctx.window(nodeId);
      if (port === 'effectSeconds' || !w) return port === 'progress' && !w ? 0 : seconds;
      const local = seconds - w.startTicks / TICKS_PER_SECOND;
      if (port === 'localSeconds') return Math.max(0, local);
      return Math.min(1, Math.max(0, local / Math.max(1 / TICKS_PER_SECOND, w.durationTicks / TICKS_PER_SECOND)));
    }
    case 'ScalarMath': {
      const operand = (id: string) => { const s = ctx.source(nodeId, id); return s ? evalSignal(ctx, s.nodeId, s.port, seconds, depth + 1) : p(id) as number; };
      return scalarMath(p('operation') as string, operand('a'), operand('b'), nodeId);
    }
    default:
      return ctx.constant(nodeId);
  }
}

/** 05/24 ScalarMath operations. Division by |b| < 1e-6 returns 0; exp clamps its input to [-20, 20]; power with a negative base and fractional exponent returns 0. */
export function scalarMath(op: string, a: number, b: number, nodeId = ''): number {
  switch (op) {
    case 'subtract': return a - b;
    case 'multiply': return a * b;
    case 'divide': if (Math.abs(b) < 1e-6) { if (nodeId) throw new SignalError(`ScalarMath "${nodeId}" divides by zero.`, nodeId, 'b'); return 0; } return a / b;
    case 'min': return Math.min(a, b);
    case 'max': return Math.max(a, b);
    case 'exp': return Math.exp(Math.min(20, Math.max(-20, a)));
    case 'power': return a < 0 && !Number.isInteger(b) ? 0 : Math.pow(a, b);
    default: return a + b;
  }
}
