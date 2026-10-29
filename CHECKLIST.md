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
- [ ] BACKLOG Unity: Arc beam thinner with small upright kinks vs tool · not investigated · 2026-10-29
- [ ] BACKLOG Unity: Play mode (not batch Advance) and URP never checked · untested · 2026-10-29
- [x] Unity: trails left by many particles (sparks) export via the per-particle Trails module · [SAW] grid particle-trail row · 2026-10-29
- [x] Unity capture stage near-black (dim flat ambient, no sky reflections) · [SAW] work/feature-grid/grid.png · 2026-10-29
- [x] Feature grid: one test effect per node feature (48), editor vs Unity side by side, scored + eye verdicts (tools/feature-grid/, README there) · [SAW] work/feature-grid/grid.png, [RAN] npm test -- v2-feature-grid · 2026-10-29
- [x] Box emitters export as boxes in every engine IR (fell back to a point) · [SAW] grid shape-box row · 2026-10-29
- [x] Unity export reports dropped mesh layers (were silent) · [RAN] v2-unity-export test + grid UNSUPPORTED rows · 2026-10-29
- [ ] BACKLOG Unity (grid): world-axis billboards + flat SpriteRenderer face the camera instead of lying flat · [SAW] grid world-axis, sprite-flat · 2026-10-29
- [ ] BACKLOG Unity (grid): untextured SpriteUnlit particles much smaller/dimmer · [SAW] grid untextured · 2026-10-29
- [ ] BACKLOG Unity (grid): variant cell differs (Unity ring vs editor soft dot) · [SAW] grid variant · 2026-10-29
- [ ] BACKLOG Unity (grid): point light floor pool much dimmer/smaller · [SAW] grid light · 2026-10-29
- [ ] BACKLOG Unity (grid): Attract - Unity streams to the point, editor stays near Source; find which is wrong · [SAW] grid attract · 2026-10-29
- [ ] BACKLOG all engines (grid): path-shaped emitters export as a point at the path start · [SAW] grid shape-path · 2026-10-29
- [ ] BACKLOG grid: mesh particles, prop meshes, screen flash not exported to Unity (reported); sub-emitter case needs a better tick; Godot/Unreal/Roblox columns not built · 2026-10-29
