# VFX Studio: feature checklist

One line per user-visible feature. Ticked by the owner's word, or a `[SAW]`/`[RAN]` result. Started 2026-10-21 (older
features are tracked in STATE.md / docs/v2-plan/evidence/TRACEABILITY.md, not yet copied here).


## Gate H: engine exports (Roblox, Unity, Godot, Unreal), added 2026-10-30

Full text: docs/v2-plan/17-ACCEPTANCE.md (gitignored copy). Passing = every line below ticked.
- [ ] H-01 Every editor feature has a feature-grid case (49 cases, tools/feature-grid/cases.mjs; the H-01b features are missing) · [RAN] grid · 2026-10-30
- [ ] H-01b MotionTrail width-over-trail, Spiral and Emitter axisMode motion* have no grid case and no engine export · 2026-10-30
- [x] H-02 Every case exports and renders in all four engines (no NOT RUN / EXPORT FAIL) · [RAN] score.mjs · 2026-10-30
- [ ] H-03 Every case OK by eye or UNSUPPORTED with the reason reported · open: Unity attract, URP sprites · 2026-10-30
- [x] H-04 Ten Arcane effects side by side in each engine, no regressions · [SAW] work/compare/*-vs-tool.png · 2026-10-30
- [x] H-05 Packages import with only the shipped integration; Unity Play mode checked · [SAW] uplay sheets · 2026-10-30
- [x] H-06 Roblox textures and meshes uploaded and shipped in src/export/roblox/assets.ts · [SAW] grid · 2026-10-30
- [ ] H-07 Owner approves the grid and the Arcane sheets per engine · needs owner

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
- [ ] BACKLOG Unity (grid): Attract flings particles both ways at t30. Known: attract off matches the editor; strength x0.25-x1 looks the same; gravityFocus 1 is worse (default 0 = centre). Next idea: read Unity's ForceField gravity falloff (endRange 100 m) · [SAW] grid attract + probes · 2026-10-30
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
