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
- [ ] Unity export of the 10 Arcane effects (fresh export, tool camera, batch built-in pipeline; Play mode/URP still unchecked): close by eye Charge/Pulse/Helix; Arc close but thinner with odd small upright kinks; all 5 effects with particle trails lose them (Bolt/Needle/Orb streaks, Summon spokes+orbit, Nova star strokes - Unity has no trail support, now reported as dropped); Blessing big halo missing; Orb head a small ringed dot; all: no bloom so glows smaller, capture floor lit grey instead of near-black · [SAW] work/compare/unity1-vs-tool.png · 2026-10-29
