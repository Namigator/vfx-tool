# Gap audit — 2026-09-26

Scope: compare the v2 plan (00–26, effects/*) with the user's tool-first direction and with the code on
`squad/vfx-v2`. Evidence is code/tests read in this session ([RAN] 436 tests pass); no full per-WP acceptance
re-run was done.

## Verdict

The plan's **scope** is sound: it already requires reusable components, a Simple view with 4–8 published
knobs per block (01, 12), a procedural baked asset library (10), and a "build from Blank without code" gate
(A-04, T39). The main failure was **execution order**: lightning parity work (WP10/11) started while the
runtime (WP03) and renderer (WP04) only implemented a small subset of the catalog. The plan did not make
that ordering enforceable. A few real plan holes also surfaced while building the fire/water references.

## Plan gaps and fixes (applied)

| ID | Gap | Fix |
| --- | --- | --- |
| P1 | 00-START-HERE says implementation has not begun and "work solo"; both are stale | Status line now points at STATE.md; squad delegation authorized by the user |
| P2 | Nothing stops family tuning before the generic catalog exists | 19: **capability floor** checklist must pass before WP10+ artistic work |
| P3 | Gate A proves a human can compose; it does not prove the tool is sufficient for a *new* effect | 17: A-05 **model build test**; 18: T40 |
| P4 | Emitters can only aim along a fixed local +X; flame jets and water streams need to aim source→target | 05: Emitter optional `aim` anchor input |
| P5 | Velocity-aligned flipbook sprites need a pivot along the stretch axis and a random variant row | 05: BillboardRenderer `pivot` and flipbook `variantRow` |
| P6 | Fire/water have prose specs but no runnable quality bar | effects/02, 03 link the standalone references as non-normative quality bars |
| P7 | 00 lists no document for this audit | 00 document map row for 27 |

Not a plan gap (earlier claim corrected): the layer-stack / big-knob idea is the plan's Simple view +
component templates + published controls (01 "Simple surface", 12 "Workspace"); STATE.md now says so.
Realistic water (refraction, environment reflection) stays an optional enhancement per 01; it is in the
STATE backlog.

## Implementation gaps (catalog vs code), priority order

Status legend: ✅ done, ◐ partial, ✗ missing. "Floor" = part of the P2 capability floor.

| # | Area (WP) | Gap | Status | Floor |
| --- | --- | --- | --- | --- |
| I1 | Emitter (WP03) | shapes cone/sphere/disc/box/path; speed range; aim anchor (P4) | ✅ 2026-09-26 except path shape; [SAW] `?workspace=v2&demo=forces` tick 45 | yes |
| I2 | Forces (WP03) | Gravity, Drag nodes | ✅ 2026-09-26 | yes |
| I3 | Forces (WP03) | NoiseForce (curl/vector), Attract, Vortex | ◐ NoiseForce (vector/curl, 07 value-noise spec) ✅ 2026-09-26, [SAW] mcp/examples/smoke.steps.json; Attract (soft radius, kill radius) and Vortex (axis, tangential, inward, falloff) ✅ 2026-09-27 ([SAW] mcp/examples/charge-up.steps.json, tornado.steps.json) | NoiseForce |
| I4 | Appearance (WP03/04) | colour over life; rotation + angular velocity; velocity alignment + stretch; pivot | ✅ 2026-09-26: colourOverLife gradient, spin (rotation/angular velocity), velocity alignment + stretch + pivot; [SAW] MCP spark burst (mcp/examples/sparks.steps.json). Spin is [PROXY] (round sprite hides rotation until textures). | yes |
| I5 | Materials/assets (WP04/05) | textured + flipbook material; baked library conforming to 10 (4×4, 256 px cells) | ◐ SpriteTextured material + flipbook (overLife/fps/first, random start, variant sets), back-to-front sort for normal blend, library rebaked to 10-ASSETS (4×4/256 flipbooks, 2×2 masks) ✅ 2026-09-26, [SAW] mcp/examples/flame-jet.steps.json; user texture import, soft particles, dissolve/UV ops ✗ | yes |
| I6 | Events (WP03) | GroundCollision, ParticleEvents, event-conditioned child emission | ✅ 2026-09-26: GroundCollision kill/slide/bounce; ParticleEvents birth/death (probability, maxEvents) and GroundCollision.collision drive child Emitter bursts at event positions (compile-time deterministic parent simulation, ≤1024 events, no silent truncation). [SAW] mcp/examples/rain-splash.steps.json. Event velocity inheritance not applied (child uses its own shape) | yes |
| I7 | Render (WP04) | ParticleTrail, SpriteRenderer, RingRenderer, PointLight, MeshRenderer | ◐ ParticleTrail ✅ 2026-09-26 (history/maxPoints/width/endFade, fades after death; [SAW] mcp/examples/spark-trails.steps.json); SpriteRenderer ✅ (one-particle system over its window; size/opacity/colour over window, spin; [SAW] mcp/examples/impact-flash.steps.json); Material variant (fixed cell of mask sets) ✅; worldAxis alignment for billboards and SpriteRenderer ✅ ([SAW] ground shockwave ring in mcp/examples/impact-flash.steps.json); PointLight ✅ (window curve, deterministic flicker, lit preview ground; [SAW] mcp/examples/flame-jet.steps.json); RingRenderer (covered by RingPath + RibbonRenderer); MeshRenderer ✅ (procedural shard/rock×3/orb/cone, tumble or velocity orientation, lit or unlit, size/colour over life; [SAW] mcp/examples/rock-burst.steps.json); MotionTrail ✅ (ribbon behind an Anchor/PathFollower; [SAW] fireball streak); imported GLB meshes ✗ | Trail, Sprite, Light |
| I8 | Values (WP02/03) | Emitter rateOverWindow curve ✅ 2026-09-27 (time-varying emission: ramps/tails, integrated per tick). Value nodes deferred: need per-instance unit typing (signature.ts leaves Constant/PublicParameter unspecialized); scaled knob bindings already cover one-value-drives-many. |
| I8a | Values (WP02/03) | RandomRange ✅ 2026-09-27: per-instance output unit (signature specialization), one seeded sample per cast, drives any matching scalar particle parameter (integers rounded) | ✅ [RAN] tests | Curve, RandomRange |
| I8b | Values (WP02/03) | Constant, Curve, Gradient, ScalarMath, Oscillator, RandomRange, PublicParameter, OffsetAnchor, EventDelay, MergeEvents | ◐ 2026-09-27 [PROXY]: Constant + ScalarMath (add/subtract/multiply/divide/min/max, per-instance unit; b unitless for multiply/divide) chain recursively into any scalar particle parameter, evaluated once per cast (tests). Force Strength (Gravity, Drag, NoiseForce, Attract, Vortex; 0..1) takes a literal, a value node or an EffectTimeCurve → per-tick operator gain ([SAW] gravity-ramp recipe: straight jet t28, arcing fountain t140). Oscillator (sine/triangle/square/saw, Hz, min/max, phase) drives the same targets as EffectTimeCurve — force Strength, Material.opacity, RevealPath.fraction, RingPath.radiusScale ([SAW] oscillator-pulse: helix core dim t30, bright t45). Gradient and per-particle curves still open; EventDelay (bypass = no delay) + MergeEvents route Emitter and presentation triggers (particles, presentation and audio cues). OffsetAnchor (chainable, bypass when disabled) resolves for emitters, aim, forces, trails, lights and path endpoints ([SAW] helix beam ending at source+[2.5,1.5,0]). PublicParameter open | Curve, RandomRange |
| I9 | Paths (WP03) | PathFollower (+arrival event), HelixPath, PathTransform, ParticlePaths | ◐ PathFollower ✅ 2026-09-27 (eased travel along the first path, held at end; anchor drives Emitter/SpriteRenderer/PointLight; arrival event triggers bursts; [SAW] mcp/examples/fireball.steps.json); HelixPath (radius, turns, phase, spin over time, taper) and PathTransform (offset, quaternion, scale about each path start) ✅ 2026-09-27 ([SAW] mcp/examples/helix-beam.steps.json); ParticlePaths ✗ | PathFollower |
| I14 | Audio (WP06) | AudioEnvelope (attack/hold/release s, linear|exponential release) and AudioFilter (RBJ lowpass/highpass/bandpass, cutoff start→end log sweep, Q; TDF-II, 64-sample coefficient updates per 24) chained Source → modifiers → Mix/Output; 13 of 15 components now carry layered SFX (tools/add-component-sfx.mjs; smoke and spark-burst silent — spark bursts use a repeat Schedule the audio compiler does not accept yet); decision replaces the earlier deferral pinned in v2-registry.test.ts | ✅ 2026-09-27 [RAN] synthesis + compile tests; listening not done | — |
| I10 | Editor (WP07) | Simple view, component templates, published knobs, add-component auto-wire | ◐ Add component (7 pre-wired templates generated from verified MCP recipes: tools/build-components.mjs → src/graph/components.generated.ts) as one undoable edit ✅ 2026-09-27 ([SAW] Fireball inserted into a blank draft); MCP vfx_list_components / vfx_add_component. Simple view first slice ✅: components publish 3–6 bound knobs (document controls, scaled bindings) shown in the editor Controls panel as sliders/fields, one undoable edit per change ([SAW] Fireball knobs; Impact sparks 120→400 raised live particles by exactly 280). Group-wrapped components / expand-to-internals, non-number knobs ✗ | — |
| I7c | Render (WP04) | Textured ribbons: SpriteTextured on RibbonRenderer (u along arc, stretch or tile; v across; per-path random or fixed cell); join fans skipped for textured strips | ✅ 2026-09-27 [SAW] mcp/examples/arc-beam.steps.json (+ Arc beam component) | — |
| I7b | Render (WP04) | Bloom/glow per 08: HDR half-float composer, UnrealBloom .8/.45/1.0, ACES + sRGB once (OutputPass), glow-off toggle (editor button, capture glow=0, MCP glow:false) | ✅ 2026-09-27 [SAW] fireball glow on/off, flame jet, L01. Note: L01 bolt emission was tuned pre-bloom and now blooms into a wide haze — needs user judgement / retune | — |
| I11 | Persistence (WP08) | save/open/autosave, bundles | ◐ 2026-09-27: autosaved local draft (localStorage, restored on reload), New blank, Open/Save .vfx.json in the editor header ([SAW] reload restores draft). IndexedDB, multiple projects, asset bytes, bundles/ZIP ✗ | — |
| I12 | Runtime (WP03) | worker simulation, seek checkpoints | ◐ 2026-09-27: seek checkpoints — ParticleSimulation.clone() (exact deep copy, [RAN] equivalence test) kept every 30 ticks per system for the current plan; a seek resumes from the latest checkpoint that still gives trails their full history ([SAW] spark-trails t40 via the capture page's second seek; frame-for-frame equality vs full replay is [PROXY]). Worker simulation ✗ | — |
| I15 | Presentation (WP04/05) | ScreenFlash, CameraImpulse (trigger → EffectOutput.presentation) | ✅ 2026-09-27: flash overlay (colour, alpha ≤ .15, linear fade) and camera shake (value noise, ≤ .05 m / .01 rad, quadratic decay; orbit untouched), triggered by Schedule start/end/repeats or PathFollower arrival; suppressed under prefers-reduced-motion; [SAW] impact-flash t10 warm wash + shake | — |
| I16 | Events (WP03) | Event velocity inheritance | ✅ 2026-09-27 [PROXY]: Emitter.inheritVelocity (0–1) adds that fraction of the parent event velocity to each child birth velocity (burst addVelocity; runtime test); used by mcp/examples/event-chain (dust at spark landings [SAW]; the inherited drift itself is not distinguishable in stills) | — |
| I13 | Agent tooling (new) | MCP server so an agent can build/edit/compile/simulate/render/listen to effects without the UI (user request 2026-09-26) | ◐ WP-MCP1 core done 2026-09-26: 17 tools (`mcp/server.ts`, `.mcp.json`); visual loop via `vfx_preview_url` + editor `?doc=`; WP-MCP2 ✅ `vfx_render_frames` (headless Chrome + SwiftShader WebGL on capture.html) returns PNGs in the tool result | — |

Work order: I13 core (headless) early, since it speeds every later check → I1 → I4 → I3 → I5 → I6 → I7 → I8/I9 → I10 → I11 → I12, then resume WP10 lightning and the
A-05 model build test. Update the Status column as items land.
