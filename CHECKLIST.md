# VFX Studio: feature checklist

One line per user-visible feature. Ticked by the owner's word, or a `[SAW]`/`[RAN]` result. Started 2026-10-21 (older
features are tracked in STATE.md / docs/v2-plan/evidence/TRACEABILITY.md, not yet copied here).


## Gate H: engine exports (Roblox, Unity, Godot, Unreal), added 2026-10-30

Full text: docs/v2-plan/17-ACCEPTANCE.md (gitignored copy). Passing = every line below ticked.
- [x] H-01 Every editor feature has a feature-grid case (52 cases, tools/feature-grid/cases.mjs) · [RAN] grid · 2026-10-30
- [x] H-01b MotionTrail width over trail + Spiral (baked from the editor into ribbon/Beam frames, src/export/trailBake.ts) and Emitter axis follows motion: all four engines · [SAW] work/compare/new-cases-engines.png, follow.png, rbx-new.png, urp-new.png · 2026-10-30
- [x] H-02 Every case exports and renders in all four engines (no NOT RUN / EXPORT FAIL) · [RAN] score.mjs · 2026-10-30
- [ ] H-03 Every case OK by eye or UNSUPPORTED with the reason reported · open: URP sprites · 2026-10-30
- [x] H-04 Ten Arcane effects side by side in each engine, no regressions · [SAW] work/compare/*-vs-tool.png · 2026-10-30
- [x] H-05 Packages import with only the shipped integration; Unity Play mode checked · [SAW] uplay sheets · 2026-10-30
- [x] H-06 Roblox textures and meshes uploaded and shipped in src/export/roblox/assets.ts · [SAW] grid · 2026-10-30
- [x] H-07 Owner approves the grid (52 cases x 5 engine columns) · owner: "Approve grid" · 2026-10-30

## Gates A-G: the plan's acceptance (docs/v2-plan/17-ACCEPTANCE.md, T01-T40 in evidence/TRACEABILITY.md), added 2026-10-30
Order agreed with the owner: finish A-G (sound included), then Gate P. Open lines only; ticked T-items live in TRACEABILITY.
- [ ] BACKLOG E / T25 Sound round 2 (owner 2026-10-31: some better, round 3 later): owner notes applied to all presets (soft magic charges, clean whooshes, thunder/low booms, electric only as short sparks, multi-gust wind, smoke silent); 43 CC0 Freesound sounds added (208 total, tools/freesound.mjs) · [RAN] every mix renders, no long bright mix, 793 tests pass · owner re-listens on https://claude.ai/artifact/JpbZZML5m8NtssA9x1tquv (round 1: 2 keep, 17 fix, 5 replace) · 2026-10-31
- [x] T18 WAV decoding (PCM 8-32 / float, any rate, header + length limits) · [RAN] tests/v2-audio-samples.test.ts · 2026-10-30
- [x] T28 Curve/gradient editing: automated DOM test with trusted mouse + keyboard (keys typed/added/dragged/deleted, interpolation, invalid points refused, gradient stops, knob-driven field + Unbind) · [RAN] node tools/ui-test.mjs t28 15/15; fixed: a refused value stayed in the field · 2026-10-31
- [x] T29 Graph shortcuts / outline / focus navigation: automated UI test (select, Ctrl+D, Delete, Ctrl+Z, Escape, F, middle-drag pan, Outline select + Solo, Issues link selects + focuses, Reduced effects, Enter/Escape into groups) · [RAN] node tools/ui-test.mjs 35/35 total; fixed: Escape selected the focused node, clicking empty graph lost keyboard focus · 2026-10-31
- [x] T17 Dissolve pixel assertion: same frame before dissolveStart, mostly gone late, orange edge band mid-burn · [RAN] node tools/dissolve-pixels.mjs + [SAW] work/mcp/frames/burn-t50.png · 2026-10-31
- [ ] T37 Benchmarks run 2026-10-31: 200-node graph (tools/perf-graph200.mjs, production build) FAILS 50 ms p95: select ~150, drag ~155, pan ~55 ms (was 950/960/210 in dev before fixes); focused-window fps 5/8 heavy effects at 16.7/16.8 ms, water-broad + arcane-lance p95 34-50 ms also headless · evidence docs/v2-plan/evidence/perf-graph200-2026-10-31.md, perf-fps-focused-2026-10-31.md
- [ ] T11 Local simulation space · rejected by design (named error); owner to confirm it stays out
- [ ] T35 Fire/water/shadow variants · needs owner approval (defaults approved)
- [ ] T39 A new mixed effect built by the owner without code · needs owner
- [ ] T40 A-05 model build test run 6 · needs owner's visual verdict
- [ ] T14 Background simulation worker · parked by measurement (every component < 1 ms/tick); owner to confirm

- [ ] BACKLOG T37: 200-node clicks: select INP p50 64 / p95 ~90-130 ms vs a 40-48 ms no-op floor (was 112 ms p50); benchmark select p95 ~105-125, pan ~50 (that measure's floor is ~50). Done 2026-11-01: compact cards below 50% zoom (title + handles only), on top of the 2026-10-31 memoization/deferral. Still over the 50 ms p95 target; rest is paint/composite next to the live 3D canvas · [RAN] tools/perf-graph200.mjs · 2026-11-01
- [ ] BACKLOG T37: water-broad and arcane-lance playback p95 34-50 ms (short hitches; headless too) · [RAN] perf-fps-headless-3-2026-10-31.md · 2026-10-31

## Gate P: publishing, added 2026-10-30 (after A-G)
- [ ] P-01 License chosen for the tool and its exports (and third-party asset licenses listed: assets/sprites provenance)
- [ ] P-02 Terms / privacy note for the hosted site (what is stored: browser storage only?)
- [ ] P-03 Public README: what it is, how to run, engine export guides (Roblox, Unity built-in/URP, Godot, Unreal plugin)
- [ ] P-04 First-time-user check of the deployed site: open, build from Blank, export to each engine, import it
- [ ] P-05 Landing / store page with a demo clip and screenshots per engine (promo pipeline: F:/Dev2/Promotions)
- [ ] P-06 Pricing / distribution decision (free site, paid packs, Roblox store, itch.io, Unity Asset Store, Fab) · owner
- [ ] P-07 Support contact + issue tracker link
- [ ] P-08 Roblox store items: moderation appeals answered; seller-requirements setting (owner dashboard) · owner
- [ ] P-09 Version tag + changelog for the first public release


- [x] Force Lance preset (thrown spear, tight purple helix closed at the tip) · owner: "looks much better" + [SAW] stills · 2026-10-21
- [ ] Arcane Lance preset (beam version) · [SAW] stills, owner not asked · 2026-10-21
- [ ] Fireball: simulated preset · owner: better but not right yet · 2026-10-21
- [x] Simulated sprites in the library (sim-fireball, sim-flame, sim-smoke-wispy, sim-explosion…) · [RAN] tests + listed in the Sprite dropdown · 2026-10-21
- [x] Emitter Axis "follow motion" · [RAN] tests/v2-follow-motion · 2026-10-21
- [x] MotionTrail Width over trail · [RAN] tests/v2-motion-trail-width · 2026-10-21
- [x] MotionTrail Spiral · [RAN] tests/v2-trail-spiral + [SAW] Force Lance close-up · 2026-10-21
- [ ] Engine exports of follow motion / trail width / spiral (Roblox, Godot, Unreal, Unity) · not built (gap) · 2026-10-21
- [x] Layer clips for breakdown videos (tools/render-layer-clips.ts) · [SAW] 7 clips · 2026-10-21
- [x] Godot export of the 10 Arcane effects matches the tool (Helix/Arc pink, Summon riders + trails) · [SAW] work/compare/cmp3-*.png · 2026-10-28
- [ ] Unreal export of the 10 Arcane effects: all 10 render with head/impact glows (Bolt, Needle, Orb), Blessing halo, Nova node glows; close by eye: Bolt/Needle/Orb/Blessing/Pulse/Helix/Arc/Summon (owner not asked); still off: glow halos smaller/dimmer than tool, floor light pools too strong, Charge sparks sparse, Arc side sparks missing, Nova haze faint · [SAW] work/compare/fix4-vs-tool.png · 2026-10-29
- [x] Unreal capture is reliable (Movie Render Queue, VFX_UE_CAPTURE=mrq) · [RAN] 2 passes, max 0.25% pixels differ · 2026-10-29
- [ ] Roblox export of the 10 Arcane effects (fresh export, matched camera): close by eye Bolt/Needle/Orb/Charge/Pulse/Helix/Arc/Summon/Nova (owner not asked; Arc zigzags + flickers like the tool, the sheet frame hit a straight phase - work/fidelity/rbx-ArcaneArc/strip.png); Arc loses the texture speckle (straightened #line, by design); Blessing big halo missing; all: PointLight floor patches too strong/textured, hot cores lack the pink bloom halo, Helix haze missing; fidelity tick sync can be 1-3 frames off · [SAW] work/compare/rbx1-vs-tool.png · 2026-10-29
- [ ] Unity export of the 10 Arcane effects (fresh export, tool camera, batch built-in pipeline): close by eye Bolt/Needle/Orb (streak trails + halo rings now), Charge/Pulse/Helix, Blessing (halo ring back, fainter), Summon/Nova (spokes/star strokes now; owner not asked); Arc thinner with odd small upright kinks; all: no bloom so glows/halos smaller and dimmer, capture floor lit grey instead of near-black · [SAW] work/compare/unity1-vs-tool.png · 2026-10-29
- [ ] BACKLOG Unity: bloom/glow halo size + brightness vs tool (built-in pipeline has no bloom; Summon/Nova node glows weakest) · not built · 2026-10-29
- [x] Unity Arc kinks: LineRenderer corner vertices drew hourglass loops at zigzags (now 0) · [SAW] work/compare/arc-corners.png, unity2-vs-tool.png · 2026-10-29
- [ ] BACKLOG Unity: Arc thinner and less glowy than the tool (no bloom) · [SAW] work/compare/unity2-vs-tool.png · 2026-10-29
- [x] Unity URP: grid column unity-urp (F:/Dev2/UnityVFXLabURP); additive colours, gain encoding and mesh shaders fixed · [SAW] grid unity-urp · 2026-10-30
- [ ] BACKLOG Unity URP: emission-boosted sprites dimmer/greyer than the editor (sprite, projectile, emission-hot). 3 tries, stopped: emission is not the cause; projects are Gamma space, and raw gain (no LinearToGamma) brightens sprites but washes rings/beams to white (needs per-channel HDR or a tone curve, not a gain) · [SAW] grid unity-urp · 2026-10-30
- [x] Unity Play mode (Update + Time.deltaTime, Particle Systems on their own clock) matches the batch capture: Arcane Charge, Bolt, Helix · [SAW] work/compare/uplay/sheet.png, sheet2.png (VFX_UNITY_PLAY=1 node tools/unity-check.mjs) · 2026-10-30
- [x] Unity: trails left by many particles (sparks) export via the per-particle Trails module · [SAW] grid particle-trail row · 2026-10-29
- [x] Unity capture stage near-black (dim flat ambient, no sky reflections) · [SAW] work/feature-grid/grid.png · 2026-10-29
- [x] Feature grid: one test effect per node feature (48), editor vs Unity side by side, scored + eye verdicts (tools/feature-grid/, README there) · [SAW] work/feature-grid/grid.png, [RAN] npm test -- v2-feature-grid · 2026-10-29
- [x] Box emitters export as boxes in every engine IR (fell back to a point) · [SAW] grid shape-box row · 2026-10-29
- [x] Unity export reports dropped mesh layers (were silent) · [RAN] v2-unity-export test + grid UNSUPPORTED rows · 2026-10-29
- [x] Flat (world-axis) billboards + flat SpriteRenderer lie flat in Unity and Godot (IR facingAxis) · [SAW] grid world-axis, sprite-flat · 2026-10-29
- [x] Roblox: slow-drifting flat billboards (ground rings) lie flat · [SAW] grid world-axis · 2026-10-30
- [x] Roblox: variant sheets hold one cell per particle (sprite ring no longer animates into a glow ball) · [SAW] grid sprite, variant + Arcane re-check (Blessing/Bolt halo rings now show, no regressions: work/compare/rbx3-cells-compare.png) · 2026-10-30
- [x] Roblox: soft-glow.png#1-3 cells, star-ray, sim-fireball (+grey) uploaded with owner approval (ids in work/roblox/asset-ids.json) · [SAW] grid spin, flipbook, variant · 2026-10-30
- [x] Untextured sprites ship soft-disc.png (editor procedural disc) in every IR engine · [SAW] grid untextured Unity+Godot · 2026-10-29
- [x] Unity static sheet cells (startFrame is a fraction) - variant cell matches · [SAW] grid variant + 4-cell probe · 2026-10-29
- [x] Unity point light pool brightness/size (x0.15, range x1.3) · [SAW] grid light · 2026-10-29
- [x] Path-shaped emitters export as emitters spaced along the path · [SAW] grid shape-path Unity+Godot · 2026-10-29
- [x] Mesh particles + prop meshes export to Unity and Godot (built-in meshes as OBJ) · [SAW] grid mesh-particles, prop-mesh · 2026-10-29
- [x] Godot: attraction, ground collision, positioned bursts (sub-emitters), drag reach, noise strength · [SAW] grid rows · 2026-10-29
- [x] Static ribbons hold to the effect end (closing IR frame) · [RAN] v2-unity-export test; Unreal re-render pending · 2026-10-29
- [x] Unity attract: Force Field gravity x0.03 (Unity pulls far harder per unit; calibrated on the grid case, 1.5 m) · [SAW] grid attract + work/compare/unity-attract-ba.png · 2026-10-30
- [ ] BACKLOG Unity: Arcane Charge sparks a little tighter than the editor after the attract calibration (Unity force law is not a constant pull) · [SAW] unity-attract-ba.png · 2026-10-30
- [ ] BACKLOG Unity (grid): light a little yellower than the editor; flat rings a little dimmer · [SAW] grid · 2026-10-29
- [x] Godot flat sprite cell (UV cut), positioned bursts, attract, collision, noise, drag, screen flash · [SAW] grid · 2026-10-30
- [ ] Godot: random-cell flat quads now draw one cell (cell 0) instead of the whole sheet, reported as approximated · [PROXY] scene output checked, not rendered · 2026-10-30
- [x] Unreal: shape primitives, point cone, static ribbons, sRGB ribbon colour, flat sprites, light scale, positioned bursts, mesh particles · [SAW] grid unreal · 2026-10-30
- [x] Unreal mesh particles: random size, random orientation (axis-angle), ambient fill in the lit material · [SAW] work/compare/ue-mesh-zoom.png · 2026-10-30
- [ ] BACKLOG Unreal (grid): mesh rocks paler (cream vs tan) than the editor · [SAW] ue-mesh-zoom · 2026-10-30
- [x] Screen flashes in Unity, Godot and Roblox · [SAW] grid screen-flash · 2026-10-30
- [x] Roblox: path split, light range/brightness, beam alphaTrack (driven opacity), positioned bursts from a part copy · [SAW] grid roblox · 2026-10-30
- [x] Roblox lightning holds each bolt until the next (interpolation averaged random bolts flat) · [SAW] work/fidelity/rbx-arc-ticks2/sheet.png · 2026-10-30
- [ ] BACKLOG Roblox: Arc bolt has fewer kinks than the editor (beam segment budget) · [SAW] rbx-arc-ticks2 · 2026-10-30
- [x] Roblox real meshes: the 11 built-in meshes uploaded, MeshIds resolved (Asset Delivery), exported as MeshParts; ids shipped in src/export/roblox/assets.ts so the deployed editor uses them too · [SAW] work/compare/rbx-meshes2.png, rbx-rocks-mat.png · 2026-10-30
- [x] Unreal screen flash: huge camera-facing sprite, depth-test-off flash material, opacity linearised (IR flashEmitters) · [SAW] grid screen-flash (mean 37 vs editor 33) · 2026-10-30
- [x] Unreal many-particle trails (sparks) baked from the editor simulation into ribbon frames (IR trailRibbons) · [SAW] grid particle-trail · 2026-10-30
- [x] Godot vortex: editor swirl sampled into a GPUParticlesAttractorVectorField3D (16³ texture) · [SAW] g-vortex-gain.png (x20 probe swirls) + grid OK · 2026-10-30
- [x] Godot tumbling mesh pieces: random rotation per particle in the draw-pass vertex shader · [SAW] work/compare/g-mesh-zoom.png · 2026-10-30
