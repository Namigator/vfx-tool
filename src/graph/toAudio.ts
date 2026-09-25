// Graph-to-audio compiler, first slice (WP04 audio core, claude-model). Pure compiler:
// createRegistry → analyzeGraph → expandGroups → one renderVoice() → mixStereo(). No DOM, React, Three,
// Web Audio device or live playback. The input is never mutated (analysis works on a clone).
//
// Scope is deliberately narrow: exactly one enabled root-level Schedule.start → AudioSource.trigger →
// AudioSource.audio → AudioOutput.audio → root EffectOutput.audio chain. Anything else that reaches
// EffectOutput.audio returns an addressed error instead of being dropped or approximated. The visual and
// presentation inputs do not affect the audio result and are ignored here (owned by the other compilers).
//
// Decisions:
// - Cue tick = Schedule.startTicks; voice start = (cue tick + AudioSource.offsetTicks) * 800 samples, exact.
//   A cue at/after the document end is an error rather than a silently dropped event; the offset and tail
//   may extend past the document end, bounded by MAX_OFFSET_TICKS and MAX_MIX_FRAMES (BUDGET_EXCEEDED).
// - Enabled AudioSource/AudioOutput nodes off the root chain are drafts: warned, never rendered.
// - Noise identity (plan24 A2): documentSeed = document seed, randomStreamId = AudioSource.randomStreamId,
//   eventRandomKey = scheduleEventRandomKey(Schedule.randomStreamId, cueTick, 0), entityOrdinal = 0.
//   Node IDs never enter a random key.
// - The single voice is mixed centered: gain 1, pan 0, masterGain 1 (the fixed limiter always runs).
// - Disabled chain nodes, Schedule repeat mode, a connected AudioSource.window, grouped (non-root) chain
//   nodes, driven parameters and exposed-control drivers are rejected until specified.
import type { Diagnostic, ErrorCode, ParameterValue, ValidationResult } from '../model/types.ts';
import { registryKey } from '../model/controls.ts';
import { scheduleEventRandomKey } from '../runtime/random.ts';
import {
  assertVoiceBudget, MAX_OFFSET_TICKS, renderVoice, SAMPLES_PER_TICK,
  type ChirpSweep, type NoiseColor, type OscillatorWaveform, type SynthSource, type VoiceSpec,
} from '../audio/synthesis.ts';
import { MAX_MIX_FRAMES, mixStereo, type MixResult } from '../audio/mix.ts';
import { analyzeGraph } from './analyze.ts';
import { expandGroups, type ExpandedConnection, type ExpandedGraph, type ExpandedNode, type ExpandedSource } from './expand.ts';
import { createRegistry } from './registry.ts';

export type AudioCompilePlan = {
  durationTicks: number;
  /** AudioSource node ID. */
  sourceNodeId: string;
  /** Schedule cue tick (before the source offset). */
  cueTick: number;
  /** Voice start tick = cueTick + offsetTicks; startSample = startTick * 800. */
  startTick: number;
  startSample: number;
  eventRandomKey: string;
  voice: VoiceSpec;
  mix: MixResult;
};

const SOURCE_PORTS = ['trigger', 'window'];

class Fail extends Error {}

export function compileAudio(input: unknown): ValidationResult<AudioCompilePlan> {
  const registry = createRegistry();
  const analysis = analyzeGraph(input, { registry });
  if (!analysis.ok) return analysis;
  const expansion = expandGroups(analysis.value);
  if (!expansion.ok) return expansion;
  const warnings = [...analysis.warnings, ...expansion.warnings];
  const doc = analysis.value.document;
  const x: ExpandedGraph = expansion.value;

  const errors: Diagnostic[] = [];
  const nodePath = new Map<string, string>();
  doc.graphs.forEach((g, gi) => g.nodes.forEach((n, ni) => nodePath.set(n.id, `graphs[${gi}].nodes[${ni}]`)));
  const report = (code: ErrorCode, message: string, nodeId?: string, param?: string) => {
    const d: Diagnostic = { code, message, severity: 'error' };
    if (nodeId !== undefined) {
      d.nodeId = nodeId;
      const p = nodePath.get(nodeId);
      if (p !== undefined) d.fieldPath = param === undefined ? p : `${p}.params.${param}`;
    }
    errors.push(d);
  };
  const fail = (code: ErrorCode, message: string, nodeId?: string, param?: string): never => {
    report(code, message, nodeId, param);
    throw new Fail(message);
  };

  const nodes = new Map<string, ExpandedNode>(x.nodes.map(n => [n.node.id, n]));
  const params = new Map<string, ParameterValue>(x.parameters.map(p => [`${p.nodeId}\u0000${p.parameter}`, p.value]));
  const into = (nodeId: string, port: string): ExpandedConnection[] =>
    x.connections.filter(c => c.target.nodeId === nodeId && c.target.port === port && c.source.kind !== 'empty');
  const param = (n: ExpandedNode, id: string): ParameterValue => {
    const v = params.get(`${n.node.id}\u0000${id}`);
    if (v !== undefined) return v;
    const spec = registry.get(registryKey(n.node.type, n.node.definitionVersion))?.parameters.find(p => p.id === id);
    if (!spec) return fail('MISSING_REFERENCE', `Parameter "${id}" of "${n.node.id}" is not registered.`, n.node.id, id);
    return spec.default;
  };
  const num = (n: ExpandedNode, id: string) => param(n, id) as number;
  const noDrivenParams = (n: ExpandedNode, structural: string[]) => {
    const before = errors.length;
    for (const c of x.connections) {
      if (c.target.nodeId !== n.node.id || structural.includes(c.target.port) || c.source.kind === 'empty') continue;
      report('DOMAIN_MISMATCH', `Input "${c.target.port}" of "${n.node.id}" is driven by a connection; connected/animated parameters are not supported by the audio compiler yet. Disconnect it and set a literal.`, n.node.id, c.target.port);
    }
    if (errors.length !== before) throw new Fail('driven parameter');
  };
  const sourceNode = (s: ExpandedSource, consumer: string, port: string): ExpandedNode => {
    if (s.kind !== 'node') return fail('INVALID_VALUE', `Input "${port}" of "${consumer}" receives a literal group default; only node connections are supported here.`, consumer);
    const n = nodes.get(s.nodeId);
    if (!n) return fail('MISSING_REFERENCE', `Source node "${s.nodeId}" of "${consumer}.${port}" is not in the expanded graph.`, consumer);
    return n;
  };
  /** Exactly one enabled, root-level source node of the expected type on consumer.port (output port `out`). */
  const single = (consumer: string, port: string, type: string, out: string): ExpandedNode => {
    const cs = into(consumer, port);
    if (cs.length === 0) return fail('MISSING_REFERENCE', `Input "${port}" of "${consumer}" needs exactly one ${type}.${out} connection; none is connected.`, consumer);
    if (cs.length > 1) return fail('MULTIPLE_DRIVERS', `Input "${port}" of "${consumer}" resolves to ${cs.length} sources; the audio compiler supports exactly one ${type}.`, consumer);
    const s = cs[0].source;
    const n = sourceNode(s, consumer, port);
    if (n.node.type !== type || s.kind !== 'node' || s.port !== out) {
      return fail('UNKNOWN_NODE', `Input "${port}" of "${consumer}" is fed by ${n.node.type}.${s.kind === 'node' ? s.port : ''} ("${n.node.id}"); only ${type}.${out} is supported by the audio compiler.`, n.node.id);
    }
    if (!n.effectiveEnabled) return fail('INVALID_VALUE', `${type} "${n.node.id}" is disabled; disabled nodes in the audio chain are not supported yet. Enable it or disconnect it.`, n.node.id);
    if (n.groupPath.length) return fail('INVALID_VALUE', `${type} "${n.node.id}" is inside a group; grouped audio chains are not supported by the audio compiler yet.`, n.node.id);
    return n;
  };
  /** Runs a pure audio core and turns its argument errors into an addressed diagnostic. */
  const guard = <T>(nodeId: string, run: () => T): T => {
    try {
      return run();
    } catch (e) {
      if (e instanceof RangeError || e instanceof TypeError) return fail('INVALID_VALUE', `${e.message}`, nodeId);
      throw e;
    }
  };

  for (const d of x.controlDrivers) {
    report('INVALID_VALUE', `Exposed control "${d.controlId}" of Group "${d.groupNodeId}" is driven by a connection; control expressions are not supported by the audio compiler yet.`, d.groupNodeId);
  }
  const outputId = x.rootOutputNodeId;
  let plan: AudioCompilePlan | undefined;
  try {
    const out = single(outputId, 'audio', 'AudioOutput', 'audio');
    noDrivenParams(out, ['audio']);
    const src = single(out.node.id, 'audio', 'AudioSource', 'audio');
    const sid = src.node.id;
    noDrivenParams(src, SOURCE_PORTS);
    if (into(sid, 'window').length) fail('INVALID_VALUE', `AudioSource "${sid}" window input is connected; audio windows are not supported yet. Disconnect it.`, sid);
    const sched = single(sid, 'trigger', 'Schedule', 'start');
    noDrivenParams(sched, []);
    if (param(sched, 'mode') === 'repeat') fail('INVALID_VALUE', 'A repeating Schedule trigger is not supported by the audio compiler yet; use mode "once" or "window".', sched.node.id, 'mode');

    const cueTick = num(sched, 'startTicks');
    if (cueTick >= doc.durationTicks) fail('INVALID_VALUE', `Schedule cue at tick ${cueTick} is at/after the document end (${doc.durationTicks}); it would never fire.`, sched.node.id, 'startTicks');
    // Policy: the cue must fire before the document end, but the source offset and tail may extend past the
    // visual duration, bounded only by the offset and mix caps. Schedule.durationTicks does not affect `start`.
    // Both caps are checked here, before assertVoiceBudget/renderVoice, so they report BUDGET_EXCEEDED.
    const startTick = cueTick + num(src, 'offsetTicks');
    if (startTick > MAX_OFFSET_TICKS) fail('BUDGET_EXCEEDED', `Voice start tick ${startTick} (cue ${cueTick} + offsetTicks) exceeds the offset limit ${MAX_OFFSET_TICKS}. Reduce the cue tick or offsetTicks.`, sid, 'offsetTicks');
    const endFrames = (startTick + num(src, 'durationTicks')) * SAMPLES_PER_TICK;
    if (endFrames > MAX_MIX_FRAMES) {
      const field = startTick * SAMPLES_PER_TICK >= MAX_MIX_FRAMES ? 'offsetTicks' : 'durationTicks';
      fail('BUDGET_EXCEEDED', `Audio render would span ${endFrames} frames; the limit is ${MAX_MIX_FRAMES}. Reduce the cue tick, offsetTicks or durationTicks.`, sid, field);
    }

    const kind = param(src, 'source');
    let source: SynthSource;
    if (kind === 'oscillator') {
      source = { kind, waveform: param(src, 'waveform') as OscillatorWaveform, frequencyHz: num(src, 'frequencyHz'), pulseDuty: num(src, 'pulseDuty') };
    } else if (kind === 'noise') {
      source = { kind, color: param(src, 'noiseColor') as NoiseColor, randomStreamId: src.node.randomStreamId };
    } else if (kind === 'chirp') {
      source = { kind, startHz: num(src, 'chirpStartHz'), endHz: num(src, 'chirpEndHz'), sweep: param(src, 'chirpSweep') as ChirpSweep };
    } else {
      source = fail('INVALID_VALUE', `AudioSource source "${String(kind)}" is not supported.`, sid, 'source');
    }
    const voice: VoiceSpec = { source, offsetTicks: startTick, durationTicks: num(src, 'durationTicks'), gain: num(src, 'gain'), pitchRatio: num(src, 'pitchRatio') };
    guard(sid, () => assertVoiceBudget([voice]));

    const eventRandomKey = scheduleEventRandomKey(sched.node.randomStreamId, cueTick, 0);
    const rendered = guard(sid, () => renderVoice(voice, { documentSeed: doc.seed, eventRandomKey, entityOrdinal: 0 }));
    const mix = guard(sid, () => mixStereo([{ startSample: rendered.startSample, samples: rendered.samples, gain: 1, pan: 0 }], 1));
    // Enabled audio nodes with no path to the root output are editable drafts: warn, never execute.
    const chain = new Set([out.node.id, sid]);
    for (const n of x.nodes) {
      if ((n.node.type !== 'AudioSource' && n.node.type !== 'AudioOutput') || !n.effectiveEnabled || chain.has(n.node.id)) continue;
      const d: Diagnostic = { code: 'MISSING_REFERENCE', severity: 'warning', nodeId: n.node.id,
        message: `${n.node.type} "${n.node.id}" has no path to EffectOutput.audio; it is a draft and is not rendered.` };
      const p = nodePath.get(n.node.id);
      if (p !== undefined) d.fieldPath = p;
      warnings.push(d);
    }
    plan = { durationTicks: doc.durationTicks, sourceNodeId: sid, cueTick, startTick, startSample: rendered.startSample, eventRandomKey, voice, mix };
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
  }

  if (errors.length || !plan) return { ok: false, errors };
  return { ok: true, value: plan, warnings };
}
