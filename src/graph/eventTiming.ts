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
  /** A Schedule's mode ('once' | 'window' | 'repeat'); needed to list every occurrence of its events. */
  mode?(scheduleId: string): string;
};

/** Most event occurrences resolved for one consumer (matches the burst-event budget). */
export const MAX_EVENT_OCCURRENCES = 1024;

/** Longest travel a PathFollower may resolve to (matches its Travel ticks maximum). */
export const MAX_TRAVEL_TICKS = 600;

/**
 * PathFollower travel ticks. Duration mode (speed 0): the authored Travel ticks. Speed mode (speed > 0 m/s):
 * the first path's length at the window start ÷ speed, rounded to whole ticks (1..600), so moving the Target
 * keeps the speed and the arrival (and everything it triggers) moves with it.
 */
export function followerTravel(ctx: TimingContext, followerId: string, startTick: number): number {
  return Math.min(...followerArrivals(ctx, followerId, startTick));
}

/**
 * Departure delay of each path (PathFollower Stagger): path k leaves k × stagger ticks after the window start
 * (reverse order: the last path first). One 0 when there is no stagger.
 */
export function followerDelays(ctx: TimingContext, followerId: string, startTick: number): number[] {
  const stagger = ctx.raw(followerId, 'stagger');
  if (!(stagger > 0)) return [0];
  const p = ctx.source(followerId, 'paths');
  const n = p && ctx.pathLengths ? ctx.pathLengths(p.nodeId, p.port, startTick).length : 1;
  const reverse = String(ctx.raw(followerId, 'staggerOrder')) === 'reverse';
  return Array.from({ length: Math.max(1, n) }, (_, k) => (reverse ? Math.max(1, n) - 1 - k : k) * stagger);
}

/** Ticks from the window start to each path's arrival (its departure delay + its travel), in path order. */
export function followerArrivals(ctx: TimingContext, followerId: string, startTick: number): number[] {
  const travels = followerTravels(ctx, followerId, startTick), delays = followerDelays(ctx, followerId, startTick);
  const n = Math.max(travels.length, delays.length);
  return Array.from({ length: n }, (_, k) => delays[Math.min(k, delays.length - 1)] + travels[Math.min(k, travels.length - 1)]);
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

/**
 * Every start of a Schedule: its authored start alone, or (triggered) its start after EACH occurrence of the trigger
 * event - a Schedule started by a repeating cue, several path arrivals or a delayed chain re-fires every time.
 */
export function scheduleStarts(ctx: TimingContext, scheduleId: string, depth = 0): number[] {
  const base = ctx.raw(scheduleId, 'startTicks');
  const t = ctx.source(scheduleId, 'trigger');
  return t ? eventTicks(ctx, t.nodeId, t.port, depth + 1).map(x => base + x) : [base];
}

/** Every occurrence tick of `nodeId.port`, ascending, unique, at most MAX_EVENT_OCCURRENCES. */
export function eventTicks(ctx: TimingContext, nodeId: string, port: string, depth = 0): number[] {
  if (depth > 16) throw new TimingError(`Event timing through "${nodeId}" is nested too deeply (or cyclic).`, nodeId);
  const type = ctx.type(nodeId);
  let out: number[];
  if (type === 'Schedule') {
    const repeat = ctx.mode?.(nodeId) === 'repeat';
    const count = repeat ? Math.max(1, ctx.raw(nodeId, 'repeatCount')) : 1, interval = repeat ? ctx.raw(nodeId, 'repeatIntervalTicks') : 0;
    const end = port === 'end' ? ctx.raw(nodeId, 'durationTicks') : 0;
    out = scheduleStarts(ctx, nodeId, depth + 1).flatMap(s => Array.from({ length: count }, (_, k) => s + k * interval + end));
  } else if (type === 'PathFollower' && port === 'arrival') {
    const w = ctx.source(nodeId, 'window');
    if (!w || ctx.type(w.nodeId) !== 'Schedule') throw new TimingError(`PathFollower "${nodeId}" needs a Schedule window to time its arrival.`, nodeId);
    out = scheduleStarts(ctx, w.nodeId, depth + 1).flatMap(s => followerArrivals(ctx, nodeId, s).map(tr => s + tr));
  } else if (type === 'EventDelay') {
    const s = ctx.source(nodeId, 'events');
    if (!s) throw new TimingError(`EventDelay "${nodeId}" has no input event.`, nodeId);
    const d = ctx.raw(nodeId, 'delayTicks');
    out = eventTicks(ctx, s.nodeId, s.port, depth + 1).map(t => t + d);
  } else {
    throw new TimingError(`A Schedule trigger from ${type ?? 'an unknown node'} "${nodeId}" is not supported; use a Schedule, PathFollower arrival or EventDelay.`, nodeId);
  }
  return [...new Set(out)].sort((a, b) => a - b).slice(0, MAX_EVENT_OCCURRENCES);
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
