// Event-relative Schedules: a Schedule whose optional `trigger` input is connected starts at that event's tick
// plus its own startTicks. Resolved statically (first occurrence) so windows, cues and bursts all agree:
// Schedule.start/end, PathFollower.arrival (window start + travel) and EventDelay chains are supported.

export type TimingContext = {
  type(nodeId: string): string | undefined;
  /** Authored (control-resolved) numeric parameter, WITHOUT trigger resolution for Schedule.startTicks. */
  raw(nodeId: string, parameter: string): number;
  source(nodeId: string, port: string): { nodeId: string; port: string } | undefined;
  /** World-space arc length of the first path of `nodeId.port` at `tick` (PathFollower speed mode). */
  pathLength?(nodeId: string, port: string, tick: number): number;
  /** World-space arc length of EVERY path of `nodeId.port` at `tick`, in path order (PathFollower speed mode). */
  pathLengths?(nodeId: string, port: string, tick: number): number[];
};

/** Longest travel a PathFollower may resolve to (matches its Travel ticks maximum). */
export const MAX_TRAVEL_TICKS = 600;

/**
 * PathFollower travel ticks. Duration mode (speed 0): the authored Travel ticks. Speed mode (speed > 0 m/s):
 * the first path's length at the window start ÷ speed, rounded to whole ticks (1..600), so moving the Target
 * keeps the speed and the arrival (and everything it triggers) moves with it.
 */
export function followerTravel(ctx: TimingContext, followerId: string, startTick: number): number {
  return Math.min(...followerTravels(ctx, followerId, startTick));
}

/**
 * Travel ticks of each path the follower walks (it follows every path of its set). Duration mode: one value, the
 * same for all paths. Speed mode: one value per path (its own length ÷ speed), so arrivals can differ.
 * `followerTravel` is the earliest of these.
 */
export function followerTravels(ctx: TimingContext, followerId: string, startTick: number): number[] {
  const speed = ctx.raw(followerId, 'speed');
  if (!(speed > 0)) return [ctx.raw(followerId, 'durationTicks')];
  const p = ctx.source(followerId, 'paths');
  if (!p || !(ctx.pathLengths || ctx.pathLength)) throw new TimingError(`PathFollower "${followerId}" needs a connected path to travel at a speed.`, followerId);
  const lens = ctx.pathLengths ? ctx.pathLengths(p.nodeId, p.port, startTick) : [ctx.pathLength!(p.nodeId, p.port, startTick)];
  return (lens.length ? lens : [0]).map(len => Math.max(1, Math.min(MAX_TRAVEL_TICKS, Math.round((len / speed) * 60))));
}

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
    const start = scheduleStart(ctx, w.nodeId, depth + 1);
    return start + followerTravel(ctx, nodeId, start); // Several paths: the earliest arrival.
  }
  if (type === 'EventDelay') {
    const s = ctx.source(nodeId, 'events');
    if (!s) throw new TimingError(`EventDelay "${nodeId}" has no input event.`, nodeId);
    return eventTick(ctx, s.nodeId, s.port, depth + 1) + ctx.raw(nodeId, 'delayTicks');
  }
  throw new TimingError(`A Schedule trigger from ${type ?? 'an unknown node'} "${nodeId}" is not supported; use a Schedule, PathFollower arrival or EventDelay.`, nodeId);
}
