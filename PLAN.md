> Historical plan. The node-authoring redesign and quality benchmark supersede conflicting choices here. Read [VFX Studio v2 implementation handoff](docs/v2-plan/00-START-HERE.md).

# Elemental VFX Studio — proof-of-concept plan

Status: proposed design, not an implemented editor. Prepared 23 September 2026.

## 1. What we are building

A desktop browser tool for creating stylized spell VFX with matching SFX by adjusting understandable, measurable parameters. Users choose an element, edit its appearance and behavior, preview the result in an empty 3D arena, and save a reusable effect recipe. Generation requires no AI service, prompts, or network connection after application assets load.

The user confirmed these ten elements: **lightning, fire, ice, water, wind, earth, light, shadow, poison, and energy**.

The proof of concept includes one polished starting effect per element and a useful editing range. These are ten distinct behaviors, not ten recolors. Each starting effect must demonstrate at least three materially different parameter configurations; these are validation cases, not a commitment to thirty separately authored effects.

**Unity, Roblox, and Unreal exporters are outside this phase.** We will preserve editable intent and document future rendering substitutions. Similar appearance is the eventual objective; identical pixels, engine performance, and automatic round-trip editing are not promised.

### Existing evidence

- [SAW] The current standalone browser lightning demo renders branching lightning, charge, glow, sparks, and a floor in actual browser captures.
- [RAN] Its synthesized WAV contains finite samples without clipping. Cast, Loop, and Sound controls were exercised.
- [UNVERIFIED] Its audio quality has not been auditioned. No editor, shared effect format, other element, or engine exporter has been demonstrated.
- All milestones and numerical limits below are **proposed acceptance targets**, not measured capabilities.

## 2. User workflow and editor

1. Choose an element and start from its default recipe or a previously saved recipe.
2. Place or numerically set the source and target anchors in an empty arena.
3. Adjust parameters and replay the effect; a fixed seed keeps comparisons meaningful.
4. Inspect charge, active, impact, and decay using pause, restart, frame-step, and scrub controls.
5. Adjust the sound, replay at normal speed, and compare the complete cast.
6. Duplicate, name, save, and reopen the recipe; download a portable recipe bundle and rendered WAV.

The editor has an element/preset list on the left, a large 3D viewport in the center, parameter controls on the right, and playback/timeline controls below. A compact optional diagnostics area shows timing, particles, geometry, and warnings. The empty arena includes a grid, reference scale, and neutral background; it does not include characters or gameplay.

The default inspector exposes roughly 8–12 useful controls per element. Advanced groups expose geometry, emission, motion, appearance, timing, and sound. Each numeric control has a label, units, safe range, editable value, and reset. Shape-specific settings are only shown where meaningful. Undo/redo covers authored edits; camera movement does not pollute that history.

Live-safe edits such as color apply immediately. Changes to topology, seed, particle population, or simulation history trigger a visibly indicated restart. Scrubbing and slow motion are visual inspection tools and are muted in this version; audio preview runs at normal speed. Muting or stopping terminates the current voice.

## 3. Ten starting effects

1. **Lightning — branching arc.** A hand-height source charges, a jagged bolt connects to the target, and sparks decay. Distinct controls: reach, branch count, jaggedness, core width, regeneration frequency, charge and discharge duration. Sound: rising charge, electrical snap, crackle, low tail.
2. **Fire — directed flame burst.** A cone of flame and embers expands and fades. Controls: cone angle, reach, emission rate, upward acceleration, turbulence, ember fraction, temperature palette. Sound: ignition, rushing burn, ember crackle.
3. **Ice — shard eruption.** Faceted shards grow or launch from the target, followed by frost particles. Controls: shard count, dimensions, spread, growth time, launch speed, frost density. Sound: crystalline attack, fracture ticks, short icy tail.
4. **Water — arcing splash.** A curved ribbon breaks into droplets and a ground ripple. Controls: arc height, width, droplet size/count, breakup time, splash spread, gravity. Sound: splash transient, filtered rushing noise, droplets. This is stylized water, not a fluid solver.
5. **Wind — spiral gust.** Ribbons and sparse streaks spiral along a direction. Controls: radius, twist rate, forward speed, ribbon length, spread, gust duration. Sound: filtered gust with controllable rise and fall.
6. **Earth — rock eruption.** Simple rock meshes lift and scatter with a dust burst. Controls: rock count/size, launch force, spread, gravity, dust density, settling time. Sound: low impact and separate stone ticks. No terrain destruction.
7. **Light — radiant pulse.** A focused flash expands into rays and a clean ring. Controls: ray count, ray length, pulse radius, expansion speed, softness, hold time. Sound: tonal chime with a bright transient.
8. **Shadow — inward vortex.** Dark wisps and ribbons curl toward a center and collapse. Controls: attraction speed, twist, radius, opacity, edge softness, collapse duration. Sound: low filtered swell and inward rush. It must remain readable on more than one background.
9. **Poison — bubbling cloud.** A drifting green-tinted plume releases bubbles and droplets. Controls: plume height, spread, bubble rate/size, drift, turbulence, dissipation. Sound: bubbling pops and hiss. Its behavior must distinguish it from recolored fire.
10. **Energy — charged projectile and impact.** A growing core travels with a trail, then releases a shock ring. Controls: core radius, charge time, travel speed, trail length, pulse frequency, impact radius. Sound: tonal charge, travel layer, impact pulse. No damage or combat logic.

Element-specific SFX are authored recipes using oscillators, seeded noise, filters, envelopes, and a small curated sample set only if synthesis fails the listening gate. Any introduced sample must have documented reuse rights and an included license. AI is not required for asset generation or playback.

## 4. Technical design

Use **TypeScript**, a small **React** editor, **Three.js** for a true 3D browser viewport, and **Web Audio** for SFX. Pin dependencies when implementation begins and obtain the required approval before installing third-party packages. No account, backend, database service, or cloud storage is needed for the proof of concept.

Three.js provides the rendering building blocks, not the generator's effect semantics. Web Audio's offline rendering can turn sound graphs into reusable audio buffers; we will encode those into WAV files. References: [Three.js documentation](https://threejs.org/docs/) and [OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext).

The main flow is:

```text
Editor controls
      |
      v
Validated, versioned effect recipe <----> local save / portable bundle
      |
      v
Deterministic generator + shared effect clock
      |                         |
      v                         v
3D primitives                Audio cues
      |                         |
      v                         v
Three.js renderer            Web Audio / WAV

Future, outside this phase:
Effect recipe --> Unity / Roblox / Unreal adapters and runtimes
```

Keep five boundaries explicit:

- **Recipe model:** portable data and validation. Does not import browser, React, Three.js, or audio APIs.
- **Generator/simulation:** consumes recipe, seed, anchors, and time; produces paths, particles, simple mesh instances, and events in world space.
- **Browser renderer:** turns those outputs into meshes, billboards, ribbons, materials, and optional post-processing.
- **Audio renderer:** consumes named timeline cues and a sound recipe, sharing the effect time origin with visuals.
- **Editor/storage:** changes authored data, manages history and files, and keeps viewport preferences separate.

Use a small set of named layer types: branching path, ribbon/trail, particle emitter, simple mesh emitter, pulse/ring, and audio cue. Families compose these types. Start with a fixed ordered layer list; do not build a general-purpose node graph, plugin system, or arbitrary scripting language.

The existing lightning demo is a reference and source of reusable algorithms. Move its path generation and audio recipe into the new boundaries. Replace its Canvas perspective, screen-pixel widths, and hand-drawn glow with the 3D renderer's equivalents. Do not treat the existing HTML as the future portable format.

## 5. Portable effect contract

Each recipe records:

- Schema version, generator version, stable effect/layer/parameter IDs, family, and display name.
- Source and target anchors, local transforms, and explicit coordinate conventions: right-handed, Y-up, meters, seconds, radians, meters/second, and meters/second². Future adapters convert units and axes.
- Typed parameters: numeric, integer, color, boolean, enum, vector, curve, or gradient; defaults, ranges, units, dependencies, and edit policy: live or restart.
- Layer definitions, emission shapes, forces, lifetime behavior, and material intent such as emissive or alpha-blended. Colors declare their space; UI sRGB colors are converted consistently for rendering.
- Charge/active/impact/decay events and timestamps. Optional phases may be absent; energy travel time can depend on anchor distance and speed through a named rule.
- Curves with ordered keyframes and defined interpolation; gradients with stops and defined color interpolation. No saved JavaScript functions or arbitrary executable expressions.
- Seed and specified PRNG algorithm. Randomness uses independent streams based on stable layer and particle IDs, so changing one layer does not randomize unrelated layers.
- Asset references, checksums, relative paths, provenance, licensing, sound recipes, and rendered audio where applicable.
- Required capabilities, optional browser enhancements, and an explicit proposed fallback for each optional enhancement.

Use a fixed 1/60-second simulation step with rendering interpolation. Seeking resets and replays to the requested tick in the initial version; cap the supported timeline at 10 seconds, then add cached checkpoints only if measured seek latency requires them. Define event ordering and particle birth/death boundaries. A seed alone is insufficient for determinism.

Determinism means matching simulation state in the pinned reference environment. Cross-browser floating-point behavior and GPU rendering are not promised to be pixel-identical. Include small reference cases of paths, particle positions, and event times so a later engine implementation has something objective to compare.

Keep authored recipes, generated caches, and editor preferences separate. A portable bundle contains a manifest, recipe, needed assets, rendered WAV, and license information. Plain JSON save/load is available for built-in assets. Reject unknown incompatible schema versions with an actionable message; add migrations when the schema actually evolves.

## 6. Portability precautions now; exporters later

World-space geometry, timing, emission, gradients, particle lifetimes, and audio cues are the primary effect description. Bloom, screen distortion, and camera shake are optional renderer enhancements. The essential silhouette and motion must remain readable with enhancements disabled.

For each layer, record its input/output semantics and the approximate rendering behavior a future adapter must reproduce. This is a portability review, not a claim that an engine supports the effect unchanged. No engine compatibility badge will be shown before an actual engine test.

Stable public parameter IDs preserve the possibility of future engine-native controls. A parameter marked runtime-adjustable can later be connected to engine UI and gameplay scripts; restart-only parameters keep that restriction explicit. Material and script internals are not automatically public controls.

Future exports should separate generated definitions from user parameter overrides. Re-export must offer an explicit policy for preserving compatible overrides and reporting conflicts. We document this boundary now; overwrite handling and native editor integration are not implemented in this phase.

## 7. Delivery stages and stop conditions

### Stage 0 — establish scope and measurement setup

Confirm the ten elements (completed), choose one visual reference direction per family, record the reference computer/GPU/browser, and define the recipe conventions. Default art direction: stylized game spells with strong silhouettes and controlled glow. Set up dependency approvals during implementation, not during planning.

**Exit:** written schema draft, core parameter definitions, named test environment, and an agreed visual direction. No date commitment until the first vertical slice reveals actual effort.

### Stage 1 — lightning editor from end to end

Implement the empty 3D arena, typed inspector, source/target anchors, deterministic lightning, playback controls, matching SFX, undo/redo, JSON save/load, and initial diagnostics.

**Exit:** a user can make thin/forked/heavy variants, save them, reopen them, and reproduce the same simulation. Inspect the cast from multiple angles and listen to the audio. If editing, persistence, or timing is unreliable, stop expansion and repair it.

### Stage 2 — prove the shared design with different effects

Add fire and ice, exercising transparent particles and solid mesh instances. Validate the recipe boundary, world-space scale, resource cleanup, and timing. Revisit the shared layer vocabulary before adding seven more families.

**Exit:** three distinct families use the same editor and format without element-specific logic leaking into the editor or saved browser objects. If they require incompatible models, revise the format here.

### Stage 3 — complete the ten families

Add water and earth next, because their motion/material demands are higher risk. Then wind and poison, followed by light, shadow, and energy. Complete each family's default, parameter ranges, sound, visual inspection, and lifecycle cleanup before proceeding.

**Exit:** ten polished starting effects, three inspected configurations each, and listening checks for all ten SFX. Do not count recolors as distinct behavior.

### Stage 4 — harden the proof of concept

Complete portable bundles, input validation, schema/version handling, diagnostics, accessibility, quality settings, documentation, and repeatability/performance checks. Audit required versus optional rendering features.

**Exit:** the acceptance gates below pass with recorded evidence and remaining limitations. Deliver the editor source, runnable browser build, ten defaults, effect-format documentation, asset licenses, and a short evidence report. Engine export remains a separate project phase.

## 8. Acceptance gates and measurable targets

These are initial targets to validate on named hardware during Stage 1 and revise explicitly if the first measurements justify a change. They are not universal promises for every device.

**Usable editing:** a person can load lightning, change reach/color/branching, replay, save, and reopen without editing code. Every exposed control has an observable documented effect. Undo/redo restores authored values. Invalid values cannot produce NaN geometry, invalid audio, or a frozen page.

**Timing and repeatability:** compare simulation state at specified ticks for the same recipe and seed under 30/60/144 Hz render schedules in the reference environment. State hashes must match where data is discrete; float comparisons use documented tolerance. Replay, restart, frame-step, and scrub must agree at those ticks. Every cue fires once per cast; pause/resume does not duplicate events.

**Interaction latency:** target p95 below 100 ms for live parameter updates and below 250 ms for a topology rebuild/restart on default recipes. Scrub-to-state target: below 200 ms for the supported timeline; benchmark before deciding whether checkpoints are necessary.

**Rendering performance:** target a 60 Hz experience at 1920×1080 internal render resolution with one default effect active; initial acceptance goal is median frame time at or below 16.7 ms and p95 at or below 20 ms. Record actual canvas resolution, hardware, browser, quality setting, and whether GPU timing is available. Frame interval is not mislabeled as GPU time. Warm up 30 seconds, measure 120 seconds, repeat three times. A 30 Hz quality option is a fallback, not evidence that the 60 Hz target passed.

**Workload limits:** establish per-family particle, geometry, transparency/overdraw, and draw-call budgets from the first three families. Enforce the approved limits and show estimated counts before expensive edits. Do not assign one arbitrary particle limit to all families or promise ten simultaneous effects; multi-effect gameplay is outside this proof of concept.

**Visual quality:** inspect all ten defaults and three configurations per family at charge, active, impact where applicable, and decay, from at least two camera angles. Check neutral light and dark backgrounds. No detached endpoints, camera-dependent world scale, disappearing required layers, unexpected clipping, or persistent particles after completion. Record screenshots or short clips; numeric tests cannot establish that an effect looks good. User visual feedback determines artistic acceptance.

**Audio:** audition each family and inspect the rendered signal. No NaN samples, unintended clicks, or clipping; target rendered peak at or below −1 dBFS. Keep visual and audio cues on a common clock, with a target scheduled offset within one 60 Hz frame. Measure device/browser playback latency separately; scheduling alone does not prove audible synchronization. Sound starts only after user activation. The audio result must be disclosed as unverified until it has actually been heard.

**Persistence and resource lifetime:** save/reload preserves all authored fields and included assets. Invalid files produce field-specific errors. After 100 casts and 20 preset switches, active objects, audio nodes, renderer resources, and application-tracked allocations return to the appropriate idle baseline; investigate monotonic growth separately from browser garbage-collection noise. Hidden tabs suspend work and resume predictably.

**Portability review:** every required layer has defined semantics; every renderer-specific enhancement has a declared fallback. No browser objects, canvas pixel coordinates, embedded engine scripts, or undocumented shaders appear in the portable core. Passing this gate is [PROXY] evidence for portability; engine export is still [UNVERIFIED].

## 9. Scope boundaries and principal risks

- **Ten families can become ten products.** Bound each to one starting effect and shared primitives. Freeform node graphs, mixed-element recipes, and arbitrary new behaviors are deferred.
- **Realistic fluids/volumes are a different project.** Use ribbons, droplets, billboards, and simple meshes for the agreed stylized appearance.
- **Glow can hide weak structure.** Evaluate required silhouette and motion with post-processing disabled.
- **Seeded replay can still drift.** Fix time steps, event ordering, versions, and random streams before expanding the library.
- **Sound quality is not a waveform statistic.** Schedule actual listening checks and allow explicit sample-based fallbacks if synthesis is insufficient.
- **Later engines may require approximation or rework.** Preserve semantic data and test cases now; never present the architecture audit as working export.
- **Browser/device performance varies.** Qualify measurements with hardware and quality settings; expose budgets and avoid unlimited controls.

Deferred: engine exporters, engine editor plugins, shader translation, engine-to-browser round trips, arbitrary scripts, character rigs, combat/networking, scene collision beyond the arena floor, terrain destruction, fluids, physically accurate volumetrics, multiplayer, accounts, cloud sync, marketplace features, and mobile authoring.

## 10. Recommended first implementation slice

Build only Stage 1 initially: **one true-3D lightning effect, a reliable parameter editor, deterministic playback, synchronized audio, and save/reopen**. Review the actual visuals, sound, usability, and benchmark results before broadening to fire and ice. The ten-family proof of concept succeeds when a user can meaningfully create variants without AI or code, and the saved data remains independent of the browser renderer.
