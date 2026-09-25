# WP04 audio synthesis core

`src/audio/synthesis.ts` renders one mono 48 kHz `Float32Array` voice per `VoiceSpec` with no Web Audio device, DOM, assets or graph nodes. Tests: `tests/v2-audio-synthesis.test.ts`.

## Implemented (plan11, plan24 "Audio source definitions")
- Oscillator sine/triangle/saw/pulse; saw and pulse use the plan24 PolyBLEP; phase starts at 0 and is continuous in the voice.
- Chirp (sine carrier), linear or exponential sweep in instantaneous frequency, phase accumulated per sample.
- White, pink (Voss-McCartney, 16 rows, `/17`) and brown (`clamp(.98b+.02w)`) noise; no per-render normalization.
- Validation: duration 1–600 integer ticks, offset 0–36000 integer ticks, gain 0–2, pitch ratio .25–4, frequency/start/end 20–16000 Hz, duty .05–.95, stream ID matches `ID_PATTERN`. After pitch, frequency clamps to .45·Fs.
- Length = round(ticks/60·48000) = ticks·800; `startSample` = offset·800.
- 5 ms (240-sample) linear fade at both voice ends, halved for voices shorter than 480 samples. Endpoints are exactly 0.
- Budgets: 480000 samples per voice; `assertVoiceBudget` allows at most 64 voices and 4.8M total samples, and validates before allocation. Nonfinite output throws.

## Frozen decisions (plan24 Amendment A2 is normative; the summary below is informative)
0. The pulse output is hard-clamped to [−1,1] after the PolyBLEP corrections (A2). Saw needs no clamp.
1. **Noise random identity.** Each lane seed = `randomTupleHash({documentSeed, randomStreamId, eventRandomKey, entityOrdinal, propertyKey, sampleOrdinal:0})`. White uses propertyKey `noiseWhite`; pink row r uses `noisePinkRow<r>`. Sample n of a lane = `2·mulberry32First((laneSeed + n·0x9e3779b9) mod 2^32) − 1`. I did not hash the full tuple for every sample because that costs a JSON+UTF-8 hash per sample. eventRandomKey and entityOrdinal come from the cue schedule and never contain object IDs.
2. The pink row update value at index n is sample n of that row's lane. Rows are initialized from sample 0.
3. Maximum offset is 36000 ticks, and the voice/total caps are the values above. The plan gives no numbers for these.
4. Triangle is `4|x−.5|−1`, so it starts at +1. The boundary ramp removes the resulting step.
5. Pitch ratio scales synth frequency only; duration stays unchanged. For samples, pitch changes duration, and that is not implemented here.

## Stereo mix and WAV (plan24 Amendment A3)
`src/audio/mix.ts` sums up to 64 mono voices in array order with gain and equal-power pan, applies master gain, then a transparent-knee soft limiter capped at −1 dBFS. It returns pre/post peaks, limited sample count/fraction and a severe-limiting flag. Output is capped at 4.8M stereo frames before allocation. `src/audio/wav.ts` encodes the resulting two Float32 channels as interleaved 48 kHz PCM16 RIFF/WAVE with symmetric ±32767 quantization. The fixed choices and the differences from the original plan24 paragraph are specified in Amendment A3; tests are in `tests/v2-audio-mix.test.ts`.

## Not yet implemented
Oscillator frequency curve, noise band emphasis, sample source, envelope, filter, multi-source graph lowering, live playback, transport synchronization and cache. Golden noise sample vectors are pinned in the test under plan24 Amendment A2. Numerical tests cannot show that the audio sounds right; someone still has to listen to it.

## Audio graph registry staging (2026-09-26)

`AudioSource@1` and `AudioOutput@1` are the first metadata-only audio nodes. The source stores kind-specific oscillator/noise/chirp settings as flat named parameters; inactive settings remain authored but have no effect for the selected `source` kind. Its node-level `randomStreamId` is the only noise stream identity. The first compiler slice accepts `Schedule.start` into `AudioSource.trigger`; connected `window` is rejected. Live playback does not exist.

`AudioEnvelope`, `AudioFilter` and `AudioMix` are deliberately unregistered. Envelope curve shape and bounds, animated filter cutoff representation, and per-input AudioMix gain/pan storage must be specified before assigning versioned node definitions. `EdgeDefinition` currently has no per-connection parameter storage. Sample sources, oscillator frequency curves and noise band emphasis are also deferred. The pure synthesis/mix/WAV functions remain usable independent of the graph.
## First graph-to-audio compiler slice

`src/graph/toAudio.ts` compiles one enabled root chain: `Schedule.start -> AudioSource.trigger -> AudioOutput -> EffectOutput.audio`. The event must fire before the visual document end. Its `Schedule.durationTicks` is irrelevant to a start event. The source offset and sound tail may extend past the visual end, subject to the 36,000-tick combined voice offset limit and 4.8M-frame mix cap; those budgets are checked before rendering. An oscillator, noise, or chirp source renders through `renderVoice` and then `mixStereo` with one centered unity-gain input. Noise uses the node's `randomStreamId`, the document seed, and the schedule event key. Enabled audio nodes outside the root chain remain editable drafts and emit warnings; they are never silently included in the mix. Unsupported root audio, windows, repeats, groups, drivers, and multiple audio inputs return addressed errors. Tests: `tests/v2-audio-graph.test.ts`. This is an offline pure buffer; it is not exposed in the editor or sent to Web Audio yet.