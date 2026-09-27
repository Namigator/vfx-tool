// Event-relative Schedules: a Schedule whose optional `trigger` input is connected starts at that event's tick
// plus its own startTicks. Resolved statically (first occurrence) so windows, cues and bursts all agree:
// Schedule.start/end, PathFollower.arrival (window start + travel) and EventDelay chains are supported.

export type TimingContext = {
  type(nodeId: string): string | undefined;
  /** Authored (control-resolved) numeric parameter, WITHOUT trigger resolution for Schedule.startTicks. */
  raw(nodeId: string, parameter: string): number;
  source(nodeId: string, port: string): { nodeId: string; port: string } | undefined;
};

export class TimingError extends Error {
  readonly nodeId: string;
  constructor(message: string, nodeId: string) { super(message); this.nodeId = nodeId; }
}

/** Effective start tick of a Schedule: authored start, plus the trigger event's tick when one is connected. */
export function scheduleStart(ctx: TimingContext, scheduleId: string, depth = 0): number {
  const base = ctx.raw(scheduleId, 'startTicks');
  const t = ctx.source(scheduleId, 'trigger');
  return t ? base + eventTick(ctx, t.nodeId, t.port, depth + 1) : base;
}

/** Tick of the first occurrence of `nodeId.port` (an event output). */
export function eventTick(ctx: TimingContext, nodeId: string, port: string, depth = 0): number {
  if (depth > 16) throw new TimingError(`Event timing through "${nodeId}" is nested too deeply (or cyclic).`, nodeId);
  const type = ctx.type(nodeId);
  if (type === 'Schedule') {
    const start = scheduleStart(ctx, nodeId, depth + 1);
    return port === 'end' ? start + ctx.raw(nodeId, 'durationTicks') : start;
  }
  if (type === 'PathFollower' && port === 'arrival') {
    const w = ctx.source(nodeId, 'window');
    if (!w || ctx.type(w.nodeId) !== 'Schedule') throw new TimingError(`PathFollower "${nodeId}" needs a Schedule window to time its arrival.`, nodeId);
    return scheduleStart(ctx, w.nodeId, depth + 1) + ctx.raw(nodeId, 'durationTicks');
  }
  if (type === 'EventDelay') {
    const s = ctx.source(nodeId, 'events');
    if (!s) throw new TimingError(`EventDelay "${nodeId}" has no input event.`, nodeId);
    return eventTick(ctx, s.nodeId, s.port, depth + 1) + ctx.raw(nodeId, 'delayTicks');
  }
  throw new TimingError(`A Schedule trigger from ${type ?? 'an unknown node'} "${nodeId}" is not supported; use a Schedule, PathFollower arrival or EventDelay.`, nodeId);
}
