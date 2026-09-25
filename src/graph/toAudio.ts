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
//
// Phase 3 (WP04-AUDIO-MIX-CONTRACT §7): alternatively exactly one enabled root AudioMix@1 feeds AudioOutput.audio,
// with 0..64 root AudioSource.audio inputs (each with its own Schedule.start cue). Inputs are summed in expanded
// (edge.order, edge.id) order with gain/pan from edge.mix (default {1, 0}), masterGain from the AudioMix, then the
// single mixStereo limiter. All voice specs and the 64-input / 4.8M-sample / 4.8M-frame caps are validated before
// any renderVoice allocation. Nested mixes, Group-connected audio and disabled sources are rejected; a disabled
// AudioMix contributes nothing (0 frames).
import { AUDIO_MIX_INPUT_PORT, AUDIO_MIX_NODE_TYPE, DEFAULT_EDGE_MIX } from '../model/types.ts';
import type { Diagnostic, EdgeDefinition, ErrorCode, ParameterValue, ValidationResult } from '../model/types.ts';
import { registryKey } from '../model/controls.ts';
import { scheduleEventRandomKey } from '../runtime/random.ts';
import {
  assertVoiceBudget, MAX_OFFSET_TICKS, MAX_TOTAL_VOICE_SAMPLES, renderVoice, SAMPLES_PER_TICK,
  type ChirpSweep, type NoiseColor, type OscillatorWaveform, type SynthSource, type VoiceSpec,
} from '../audio/synthesis.ts';
import { assertMixBudget, MAX_MIX_FRAMES, MAX_MIX_INPUTS, mixStereo, type MixResult } from '../audio/mix.ts';
import { analyzeGraph } from './analyze.ts';
import { expandGroups, type ExpandedConnection, type ExpandedGraph, type ExpandedNode, type ExpandedSource } from './expand.ts';
import { createRegistry } from './registry.ts';

type PreparedVoice = {
  sourceNodeId: string; scheduleNodeId: string; cueTick: number; startTick: number; startSample: number;
  eventRandomKey: string; voice: VoiceSpec;
};
/** One AudioMix input in summation order; gain/pan resolved from the authored edge's mix. */
export type AudioMixVoicePlan = PreparedVoice & { edgeId: string; gain: number; pan: number };

export type AudioMixCompilePlan = {
  kind: 'mix';
  durationTicks: number;
  mixNodeId: string;
  masterGain: number;
  voices: AudioMixVoicePlan[];
  mix: MixResult;
};

export type AudioCompilePlan = DirectAudioCompilePlan | AudioMixCompilePlan;

export type DirectAudioCompilePlan = {
  kind: 'direct';
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
const AUDIO_TYPES = ['AudioSource', 'AudioOutput', AUDIO_MIX_NODE_TYPE];

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
  // Abort before any chain walk, renderVoice or mixStereo allocation.
  if (errors.length) return { ok: false, errors };
  /** Validates one AudioSource and its Schedule.start cue; returns the voice spec without rendering. */
  const prepare = (src: ExpandedNode): PreparedVoice => {
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
    const eventRandomKey = scheduleEventRandomKey(sched.node.randomStreamId, cueTick, 0);
    return { sourceNodeId: sid, scheduleNodeId: sched.node.id, cueTick, startTick, startSample: startTick * SAMPLES_PER_TICK, eventRandomKey, voice };
  };
  const render = (p: PreparedVoice) =>
    guard(p.sourceNodeId, () => renderVoice(p.voice, { documentSeed: doc.seed, eventRandomKey: p.eventRandomKey, entityOrdinal: 0 }));
  const authoredEdge = (id: string): EdgeDefinition | undefined => {
    for (const g of doc.graphs) for (const e of g.edges) if (e.id === id) return e;
    return undefined;
  };

  const outputId = x.rootOutputNodeId;
  let plan: AudioCompilePlan | undefined;
  try {
    const out = single(outputId, 'audio', 'AudioOutput', 'audio');
    noDrivenParams(out, ['audio']);
    const feeds = into(out.node.id, 'audio');
    const head = feeds.length === 1 && feeds[0].source.kind === 'node' ? nodes.get(feeds[0].source.nodeId) : undefined;
    const chain = new Set([out.node.id]);
    if (head?.node.type === AUDIO_MIX_NODE_TYPE) {
      // Phase 3: exactly one root AudioMix@1 between AudioSource.audio inputs and AudioOutput.audio.
      const s = feeds[0].source as { kind: 'node'; nodeId: string; port: string };
      const mixId = head.node.id;
      if (s.port !== 'audio') fail('UNKNOWN_NODE', `AudioOutput "${out.node.id}" is fed by AudioMix.${s.port}; only AudioMix.audio is supported.`, mixId);
      if (head.groupPath.length) fail('INVALID_VALUE', `AudioMix "${mixId}" is inside a group; grouped audio chains are not supported by the audio compiler yet.`, mixId);
      if (feeds[0].sourceEdgeIds.length > 1) fail('INVALID_VALUE', `AudioOutput "${out.node.id}" reaches AudioMix "${mixId}" through a Group boundary; Group-connected audio is not supported yet.`, mixId);
      chain.add(mixId);
      const inputs = into(mixId, 'inputs');
      if (!head.effectiveEnabled) {
        // disabledBehavior 'empty': a disabled mix contributes nothing (0 frames), its inputs are not rendered.
        for (const c of inputs) if (c.source.kind === 'node') chain.add(c.source.nodeId);
        plan = { kind: 'mix', durationTicks: doc.durationTicks, mixNodeId: mixId, masterGain: num(head, 'masterGain'), voices: [], mix: mixStereo([], 1) };
      } else {
        noDrivenParams(head, [AUDIO_MIX_INPUT_PORT]);
        const masterGain = num(head, 'masterGain');
        if (inputs.length > MAX_MIX_INPUTS) fail('BUDGET_EXCEEDED', `AudioMix "${mixId}" has ${inputs.length} inputs; the limit is ${MAX_MIX_INPUTS}. Remove inputs.`, mixId);
        // Collect and validate every voice before any renderVoice allocation.
        const voices: PreparedVoice[] = [];
        const settings: { edgeId: string; gain: number; pan: number }[] = [];
        for (const c of inputs) {
          if (c.sourceEdgeIds.length > 1) fail('INVALID_VALUE', `AudioMix "${mixId}" input via edge "${c.sourceEdgeIds[0]}" crosses a Group boundary; Group-connected audio is not supported yet.`, mixId);
          const n = sourceNode(c.source, mixId, AUDIO_MIX_INPUT_PORT);
          const port = c.source.kind === 'node' ? c.source.port : '';
          if (n.node.type === AUDIO_MIX_NODE_TYPE) fail('INVALID_VALUE', `AudioMix "${n.node.id}" feeds AudioMix "${mixId}"; nested mixes are not supported by the audio compiler yet.`, n.node.id);
          if (n.node.type !== 'AudioSource' || port !== 'audio') fail('UNKNOWN_NODE', `AudioMix "${mixId}" input is fed by ${n.node.type}.${port} ("${n.node.id}"); only AudioSource.audio is supported.`, n.node.id);
          if (!n.effectiveEnabled) fail('INVALID_VALUE', `AudioSource "${n.node.id}" is disabled; disabled nodes in the audio chain are not supported yet. Enable it or disconnect it.`, n.node.id);
          if (n.groupPath.length) fail('INVALID_VALUE', `AudioSource "${n.node.id}" is inside a group; grouped audio chains are not supported by the audio compiler yet.`, n.node.id);
          const edgeId = c.sourceEdgeIds[0];
          const m = authoredEdge(edgeId)?.mix ?? DEFAULT_EDGE_MIX;
          voices.push(prepare(n));
          settings.push({ edgeId, gain: m.gain, pan: m.pan });
          chain.add(n.node.id);
        }
        let total = 0;
        for (const v of voices) total += v.voice.durationTicks * SAMPLES_PER_TICK;
        if (total > MAX_TOTAL_VOICE_SAMPLES) fail('BUDGET_EXCEEDED', `AudioMix "${mixId}" inputs total ${total} voice samples; the limit is ${MAX_TOTAL_VOICE_SAMPLES}. Shorten or remove sources.`, mixId);
        guard(mixId, () => assertVoiceBudget(voices.map(v => v.voice)));
        // Zero-length probe validates gain/pan/masterGain and frame caps before rendering.
        const frames = Math.max(0, ...voices.map(v => v.startSample + v.voice.durationTicks * SAMPLES_PER_TICK));
        if (frames > MAX_MIX_FRAMES) fail('BUDGET_EXCEEDED', `AudioMix "${mixId}" would span ${frames} frames; the limit is ${MAX_MIX_FRAMES}.`, mixId);
        guard(mixId, () => assertMixBudget(settings.map(st => ({ startSample: 0, samples: new Float32Array(0), gain: st.gain, pan: st.pan })), masterGain));

        const rendered = voices.map(render);
        const mix = guard(mixId, () => mixStereo(rendered.map((r, i) => ({ startSample: r.startSample, samples: r.samples, gain: settings[i].gain, pan: settings[i].pan })), masterGain));
        plan = { kind: 'mix', durationTicks: doc.durationTicks, mixNodeId: mixId, masterGain,
          voices: voices.map((v, i) => ({ ...v, startSample: rendered[i].startSample, ...settings[i] })), mix };
      }
    } else {
      const src = single(out.node.id, 'audio', 'AudioSource', 'audio');
      const p = prepare(src);
      guard(p.sourceNodeId, () => assertVoiceBudget([p.voice]));
      const rendered = render(p);
      const mix = guard(p.sourceNodeId, () => mixStereo([{ startSample: rendered.startSample, samples: rendered.samples, gain: 1, pan: 0 }], 1));
      chain.add(p.sourceNodeId);
      plan = { kind: 'direct', durationTicks: doc.durationTicks, sourceNodeId: p.sourceNodeId, cueTick: p.cueTick, startTick: p.startTick,
        startSample: rendered.startSample, eventRandomKey: p.eventRandomKey, voice: p.voice, mix };
    }
    // Enabled audio nodes with no path to the root output are editable drafts: warn, never execute.
    for (const n of x.nodes) {
      if (!AUDIO_TYPES.includes(n.node.type) || !n.effectiveEnabled || chain.has(n.node.id)) continue;
      const d: Diagnostic = { code: 'MISSING_REFERENCE', severity: 'warning', nodeId: n.node.id,
        message: `${n.node.type} "${n.node.id}" has no path to EffectOutput.audio; it is a draft and is not rendered.` };
      const p = nodePath.get(n.node.id);
      if (p !== undefined) d.fieldPath = p;
      warnings.push(d);
    }
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
  }

  if (errors.length || !plan) return { ok: false, errors };
  return { ok: true, value: plan, warnings };
}
