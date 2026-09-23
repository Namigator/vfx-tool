# Acceptance gates and evidence

## Evidence rules

Every report uses the user's tags. [SAW] means a captured actual result was opened and inspected; [RAN] means execution/output was read; [PROXY] means indirect evidence for the feature; [UNVERIFIED] means unchecked. The summary uses the weakest evidence needed for its claim. A build cannot pass a visual gate; waveform statistics cannot pass a listening gate.

Record user feedback separately from agent observation. Current user feedback is a failed v1 visual gate for several effects. No future document may turn that into a claim that v2 has already passed.

## Gate A — authoring model

A-01: Graph has real editable internals, typed connections, group interfaces and independent enable/solo.
A-02: Moving/renaming/grouping/layout changes preserve state at fixture ticks.
A-03: Public controls disclose bindings; conflicting drivers and cycles are rejected.
A-04: From Blank, a user can build a bolt + sparks + sound, then replace sparks with smoke without editing source.
A-05: Save a reusable group, insert twice, edit one instance, and confirm the other remains unchanged.

## Gate B — lightning quality floor

Capture original and graph-authored lightning at matched viewport framing, resolution, seed and comparable times. Preserve the original clip, graph recipe, asset hashes, new clip and reviewer notes.

Review charge, first strike, sustained flicker, impact and decay. Required features: multiple core/halo layers; attached branches and secondary forks; energetic but readable temporal flicker; rapid path reveal; source and impact glow; ballistic streak sparks; fading ripple; timed audio accents. Optional flash/impulse must not hide weak bolt geometry.

Use same-camera A/B to assess parity, then two additional angles for new 3D stability. Dark and light arena backgrounds; glow on and off. User accepts comparable or better detail, shape, energy, timing and overall impact. Pixel matching is inappropriate across Canvas and Three.js. No high-detail image baked onto a camera-facing plane may stand in for the editable effect.

Do not expand the family library past foundational work until this gate passes. If blocked only on user artistic review, independent infrastructure work may continue; do not mark lightning accepted.

## Gate C — difficult material families

Fire: individually inspect flame tongues, hot core, embers, smoke and fade. No field of uniform glowing circles or opaque card rectangles.
Water: identifiable curved liquid body, restrained highlights, breakup/splash, droplets and ripples; no electrical-looking glowing tubes.
Shadow: dark body and inward-moving wisps visible on both backgrounds; no purple neon substitute for darkness.

Each has default + two structural variants and independent component switches. Review source assets enlarged and animated before integrating; a bad texture cannot be accepted because bloom obscures it.

## Gate D — all ten families

For each default and two variants, capture charge/active/impact if applicable/decay, at two oblique angles, on dark/light backgrounds. Review at intended scale plus close-up. Must have a distinct silhouette, motion pattern and sound identity, without relying on palette changes alone.

Reject floating endpoints, detached branches, visible atlas borders, persistent particles, opaque smoke squares, severe transparent sorting artifacts, camera-dependent width jumps, unexplained clipping, excessively saturated bloom and timing that separates sound from impact.

User visual approval applies to all ten defaults. Variants must demonstrate changed structure/motion (e.g. short jet versus wide burst), not only hue/count.

## Gate E — sound

Listen to each family, separate layers and full mix at a comfortable level. Evaluate clicks/clipping, transient timing, harsh repetition, unnecessary bass and tails. Compare lightning charge/snap/crackle/rumble with the reference. Measure scheduled timing and disclose device latency. Hardware synchronization target is within one visual frame where measurement supports it; otherwise mark it pending.

## Gate F — workflow and persistence

Complete the six primary workflows in the editor document. Test keyboard-only critical actions, numeric drafts, curves, history, import/relink, bundle export into fresh storage, legacy open/convert, autosave recovery and tab conflict. No lost project or asset, hidden binding, silent count truncation or stale preview labeled current.

## Gate G — reliability and performance

Meet qualified targets in the performance document, including sustained render and resource plateau. Test hard-limit diagnostics, shader/worker failure, context loss, missing assets and audio suspension. Application editing/export remains available after preview failure.

## Evidence packet layout

For each gate store under evidence/v2/<gate-id>/:
- README.md with status, environment, exact reproduction and unresolved issues.
- document.vfx.json or portable archive and asset hash manifest.
- captures/ stills/clips actually inspected, with tick/time/camera/profile metadata.
- numeric results and test command output.
- review notes identifying user versus agent observations.

Do not store screenshots of a graph as proof of VFX quality. Do not declare acceptance using metadata or pixel probes without opening the images. If browser capture is unavailable, say so and leave visual gates open.

