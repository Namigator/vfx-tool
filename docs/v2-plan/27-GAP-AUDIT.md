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
| I3 | Forces (WP03) | NoiseForce (curl/vector), Attract, Vortex | ◐ NoiseForce (vector/curl, 07 value-noise spec) ✅ 2026-09-26, [SAW] mcp/examples/smoke.steps.json; Attract, Vortex ✗ | NoiseForce |
| I4 | Appearance (WP03/04) | colour over life; rotation + angular velocity; velocity alignment + stretch; pivot | ✅ 2026-09-26: colourOverLife gradient, spin (rotation/angular velocity), velocity alignment + stretch + pivot; [SAW] MCP spark burst (mcp/examples/sparks.steps.json). Spin is [PROXY] (round sprite hides rotation until textures). worldAxis alignment still rejected | yes |
| I5 | Materials/assets (WP04/05) | textured + flipbook material; baked library conforming to 10 (4×4, 256 px cells) | ◐ SpriteTextured material + flipbook (overLife/fps/first, random start, variant sets), back-to-front sort for normal blend, library rebaked to 10-ASSETS (4×4/256 flipbooks, 2×2 masks) ✅ 2026-09-26, [SAW] mcp/examples/flame-jet.steps.json; user texture import, soft particles, dissolve/UV ops ✗ | yes |
| I6 | Events (WP03) | GroundCollision, ParticleEvents, event-conditioned child emission | ◐ GroundCollision kill/slide/bounce ✅ 2026-09-26 ([SAW] mcp/examples/fountain.steps.json); collision/birth/death events + child emission (ParticleEvents) ✗ | yes |
| I7 | Render (WP04) | ParticleTrail, SpriteRenderer, RingRenderer, PointLight, MeshRenderer | ✗ (RingPath+ribbon only) | Trail, Sprite, Light |
| I8 | Values (WP02/03) | Constant, Curve, Gradient, ScalarMath, Oscillator, RandomRange, PublicParameter, OffsetAnchor, EventDelay, MergeEvents | ✗ (EffectTimeCurve only) | Curve, RandomRange |
| I9 | Paths (WP03) | PathFollower (+arrival event), HelixPath, PathTransform, ParticlePaths | ✗ | PathFollower |
| I10 | Editor (WP07) | Simple view, component templates, published knobs, add-component auto-wire | ✗ graph + inspector only | — |
| I11 | Persistence (WP08) | save/open/autosave, bundles | ✗ | — |
| I12 | Runtime (WP03) | worker simulation, seek checkpoints | ✗ main-thread replay | — |
| I13 | Agent tooling (new) | MCP server so an agent can build/edit/compile/simulate/render/listen to effects without the UI (user request 2026-09-26) | ◐ WP-MCP1 core done 2026-09-26: 17 tools (`mcp/server.ts`, `.mcp.json`); visual loop via `vfx_preview_url` + editor `?doc=`; headless PNG render (WP-MCP2) pending | — |

Work order: I13 core (headless) early, since it speeds every later check → I1 → I4 → I3 → I5 → I6 → I7 → I8/I9 → I10 → I11 → I12, then resume WP10 lightning and the
A-05 model build test. Update the Status column as items land.
