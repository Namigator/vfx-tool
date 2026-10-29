# VFX Studio: feature checklist

One line per user-visible feature. Ticked by the owner's word, or a `[SAW]`/`[RAN]` result. Started 2026-10-21 (older
features are tracked in STATE.md / docs/v2-plan/evidence/TRACEABILITY.md, not yet copied here).

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
- [ ] BACKLOG Unity: Play mode (not batch Advance) and URP never checked · untested · 2026-10-29
- [x] Unity: trails left by many particles (sparks) export via the per-particle Trails module · [SAW] grid particle-trail row · 2026-10-29
- [x] Unity capture stage near-black (dim flat ambient, no sky reflections) · [SAW] work/feature-grid/grid.png · 2026-10-29
- [x] Feature grid: one test effect per node feature (48), editor vs Unity side by side, scored + eye verdicts (tools/feature-grid/, README there) · [SAW] work/feature-grid/grid.png, [RAN] npm test -- v2-feature-grid · 2026-10-29
- [x] Box emitters export as boxes in every engine IR (fell back to a point) · [SAW] grid shape-box row · 2026-10-29
- [x] Unity export reports dropped mesh layers (were silent) · [RAN] v2-unity-export test + grid UNSUPPORTED rows · 2026-10-29
- [x] Flat (world-axis) billboards + flat SpriteRenderer lie flat in Unity and Godot (IR facingAxis) · [SAW] grid world-axis, sprite-flat · 2026-10-29
- [x] Untextured sprites ship soft-disc.png (editor procedural disc) in every IR engine · [SAW] grid untextured Unity+Godot · 2026-10-29
- [x] Unity static sheet cells (startFrame is a fraction) - variant cell matches · [SAW] grid variant + 4-cell probe · 2026-10-29
- [x] Unity point light pool brightness/size (x0.15, range x1.3) · [SAW] grid light · 2026-10-29
- [x] Path-shaped emitters export as emitters spaced along the path · [SAW] grid shape-path Unity+Godot · 2026-10-29
- [x] Mesh particles + prop meshes export to Unity and Godot (built-in meshes as OBJ) · [SAW] grid mesh-particles, prop-mesh · 2026-10-29
- [x] Godot: attraction, ground collision, positioned bursts (sub-emitters), drag reach, noise strength · [SAW] grid rows · 2026-10-29
- [x] Static ribbons hold to the effect end (closing IR frame) · [RAN] v2-unity-export test; Unreal re-render pending · 2026-10-29
- [ ] BACKLOG Unity (grid): Attract spreads particles further right than the editor at t30 (strength probe ruled out) · [SAW] grid attract · 2026-10-29
- [ ] BACKLOG Unity (grid): light a little yellower than the editor; flat rings a little dimmer · [SAW] grid · 2026-10-29
- [ ] BACKLOG Godot (grid): vortex not exported; flat sprite draws 2-3 overlapping rings; tumbling meshes spin about one axis · [SAW] grid · 2026-10-29
- [ ] BACKLOG Unreal (grid): flat sprites stand up; meshes, screen flash and trail-only systems fail/drop; vortex rises; untextured small; textured beam (uv-scroll) missing · [SAW] grid unreal column · 2026-10-29
- [ ] Unreal (grid): box/disc primitive + point cone fixes in VfxNiagaraImporter.cpp · [UNVERIFIED] not built yet · 2026-10-29
- [ ] BACKLOG grid: screen flash not exported anywhere (reported) · 2026-10-29
