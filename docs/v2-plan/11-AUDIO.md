# Audio graph and synchronized playback

## Design

Sound is a set of independently editable layers driven by the same events/windows as visuals. Charge, snap, crackle, travel, impact and tail are separate components. A single family-name synthesizer is not the v2 authoring model.

Produce a canonical mixed buffer for each valid effect revision; use the same render function for live playback and downloaded WAV. Reference output is 48 kHz float PCM, stereo-capable, with deterministic synthesis/noise. Input samples use the asset pipeline's canonical PCM. The audio subsystem can run without a Web Audio device for numerical tests.

## Nodes

| Node | Input/output | Controls |
| --- | --- | --- |
| AudioSource | E/window → audio layer | source oscillator/noise/chirp/sample; offset ticks; duration 1–600 ticks; gain 0–2; pitch ratio .25–4 |
| Oscillator source | contained generator settings | sine/triangle/saw/pulse; frequency 20–16000 Hz; pulse duty .05–.95; frequency curve |
| Noise source | contained generator settings | seeded white/pink/brown; stream ID; band emphasis |
| Chirp source | contained generator settings | start/end Hz; linear/exponential sweep; phase continuous within voice |
| Sample source | WAV asset | trim start/end, reverse false, rate/pitch ratio, loop within window |
| AudioEnvelope | audio → audio | attack/hold/release curves; total within source window |
| AudioFilter | audio → audio | lowpass/highpass/bandpass; cutoff 20–20000 Hz; Q .1–20; declared RBJ biquad coefficients |
| AudioMix | ordered audio list → audio | per-input gain, pan -1–1; master gain 0–1 |
| AudioOutput | audio → root output | peak limiting and explicit render stats |

No convolution reverb or arbitrary audio plugins in v2. A feedback-free delay/tail is represented by duplicate delayed sources if needed. Provide ready-made named source/envelope groups so users do not need synthesis knowledge.

White noise uses the shared PRNG; brown noise is bounded leaky integration; pink noise uses the Voss-McCartney method. Exact algorithms and biquad coefficients are fixed in [algorithm details](24-ALGORITHMS.md), with golden sample vectors. Do not change algorithms or coefficients after fixtures are accepted without an audio node version bump.

Use equal-power pan. Stereo samples retain channels; mono sources pan into stereo. Pitch changes playback rate and therefore duration unless Loop/stretch-to-window is explicitly chosen; no pitch-preserving time stretch in v2. UI displays the resulting duration.

## Scheduling and cache

Resolve cue times from graph ticks to sample indices using round(tick/60*48000). Child collision/death cues use runtime's deterministic event schedule generated in an offline simulation pass before rendering audio. Cap voices/events before allocating buffers.

Cache key includes audio-relevant graph hash, cue schedule, assets, seed and sample rate. Editing a visual color does not invalidate audio; timing/seed/audio controls do. Rendering is cancellable and revision-tagged. While rendering, show Sound preparing; visual preview may run silently, but Sound on does not claim synchronized playback until the buffer is ready.

Live transport schedules the mixed buffer at AudioContext.currentTime + .05 seconds, establishes a matching cast origin, and maps visual presentation to output timestamp when supported. Fallback uses currentTime with documented latency uncertainty. At resumed offset, use the corresponding sample position. The getOutputTimestamp API helps map context time to performance time; it is not proof of end-to-end hardware sync.

## Lifecycle and safety

Sound is off until user activation. Start creates one current mixed-buffer voice, not one uncontrolled voice per particle. Restart stops/fades the previous voice with a 5–10 ms ramp and cancels generation callbacks. Pause, seek, hidden page, document switch and dispose stop voices. End callbacks check voice generation before clearing current state.

Mute affects preview gain, not authored master volume. Solo audio layers produces a temporary mix without altering the saved document. Slow motion/scrub remain silent; re-enable normal playback from current position.

Mix at float precision, apply a fixed soft limiter, and measure peak. Default rendered peak ≤-1 dBFS; reject nonfinite buffers and report severe limiting. Do not normalize each layer independently or normalize away the user's gain choices. Add boundary ramps to avoid clicks. Sound quality still requires listening.

## WAV export

PCM16 stereo 48 kHz RIFF/WAVE with correct byte rate, block align, lengths and signed clipping. Mono input may export stereo after mix. Bundle includes the rendered mix plus source assets/graph, so editability is retained. Export is unavailable for invalid graphs, missing audio assets or incomplete rendering; never download stale audio without explicit identification.

## Acceptance

Audition charge, discharge/impact and tail separately, then together. Compare reference lightning accents, transient clarity, low-end tail and audiovisual timing. Test sound off/on, mute, pause/resume, rapid restart, tab hiding, audio device suspension, rejected resume promise and source replacement. Numerical waveform tests and fake Web Audio tests are necessary but cannot substitute for hearing it.

