# STATE — VFX Tool

**Goal:** A simple composable web VFX/SFX node tool with ten editable elemental defaults, original-lightning quality floor, and engine-neutral future exporters.

## Direction (user decision 2026-09-26) — tool first, presets second
- Stop polishing individual effects feature-by-feature. Build **generic, reusable building blocks** first; presets are assembled from them afterwards, never hand-special-cased.
- Ease of use is the product: reusable **layer types** (e.g. Flame jet, Smoke, Sparks, Glow, Bolt, Ring) that expose their own big knobs (reach, spread, turbulence, lift, size, heat colour, density), sitting on top of the node graph (graph stays as "advanced"). Per-preset published controls alone are not enough.
- Ship a **bundled sprite/flipbook library** shared by all effects (flame tongues, smoke puffs, sparks/streaks, soft glows, arcs, splashes…), generated procedurally (no licensing) and bakeable to image files; allow user import.
- **Acceptance test for "tool finished":** hand the tool to a model (fresh session, no code access, graph/layer UI only) and have it build a good-looking effect — first target: match `docs/v2-plan/references/standalone-flamethrower/flamethrower.html`. Every gap it hits becomes a new generic node/layer feature, then repeat.
- Quality bars: `docs/v2-plan/references/original-lightning/lightning-arc.html` (lightning) and `docs/v2-plan/references/standalone-flamethrower/flamethrower.html` (fire; open via `http://127.0.0.1:5174/docs/v2-plan/references/standalone-flamethrower/flamethrower.html`, `?t=<sec>` freezes a frame). Flamethrower is a standalone canvas2D demo — 4 layers (core, tongues, embers, smoke) + light + synthesized audio, 8 procedural flame shapes × 12 frames; tuned above 02-FIRE spec (tongues 420/s, cone 6°). [SAW] still frames in the in-app browser only; audio not listened to.

## Now
- Claude Opus 5.5 LOW in visible squad terminals does heavy implementation; Codex coordinates, runs gates, inspects browser. No built-in agents. Wait for squad reports; 10-minute fallback check only.
- Current branch `squad/vfx-v2`; timed bolt reveal, mixed point/ribbon preview, animated charge and audio prototype are checkpointed at `2d74458`. Visual/audio acceptance remains open.
- [RAN] Full 417 tests pass with zero failures/skips; TypeScript and production build pass. Build warns about the large Three chunk and a third-party `use client` directive.
- [SAW] Desktop-sized in-app browser: charge grows and brightens from tick12 to23, persists at tick24, partial bolt at25, full bolt reaching target and impact at26, empty map at63. Full-width inspected captures are `evidence/lightning-charge-tick23-2026-09-26.png` and `evidence/lightning-strike-tick26-2026-09-26.png`. The preview is still below original ARC quality.
- [RAN] Generic RadialPath, sparse ribbon fade splitting, per-ribbon endFade, AudioMix, WAV encoding, audio transport, EffectTimeCurve RevealPath, mixed preview and billboard life curves have automated tests. Offline L01 WAV was written to `evidence/lightning-audio-prototype.wav` (0.50s, 48 kHz stereo PCM16). Browser controls render; real speaker output and a completed browser download remain unobserved.
- Anthropic spend limit reset at the 2026-09-26 00:11 heartbeat. Claude Opus 5.5 LOW workers resumed in visible squad terminals. Mix/WAV, audio registry, ribbon and audio compiler received independent static reviews; no new packages installed.

## Next (tool-first order)
1. **Textured materials + flipbook playback** — spec `docs/implementation/WP05-TEXTURED-MATERIALS-FLIPBOOK.md`. Sprite library seed exists: `node tools/bake-sprites.mjs` → `assets/sprites/` (flame-tongue t0–t3 sheets 8 shapes × 12 frames, smoke-puff ×4, `manifest.json`). [SAW] t1 sheet reads as flame tongues; not yet used by the editor. Still to bake: spark/streak, soft glow, arc, splash.
2. **Missing generic particle nodes:** Drag, Gravity/Buoyancy, NoiseForce (coherent turbulence), ColorOverLife (heat gradient), spawn-from-particles (sub-emitter for embers/smoke), ParticleTrail/streaks, PointLight; verify depth sorting with mixed normal/additive blends at ~500 particles.
3. **Layer-stack UI** with reusable layer types and big knobs mapped onto node params; timeline strip for phases (charge → emit → tail).
4. Persistence (save/load effects).
5. **Model build test:** a fresh model builds the flamethrower (then lightning) using only the tool; log every missing capability, add it as a generic node/layer, repeat until it matches the reference.
6. Then the ten presets built from layers. Lightning leftovers (charge motes, ring/light impact, bolt fade, AV sync, whole-cycle ARC compare, listen to L01 WAV) are done via generic features, not special cases. Engine exporters remain deferred.

## Known limits
- [SAW] L01 charge core/halo grows during ticks0-24, bolt appears over ticks24-26 and impact follows at ticks26-38. The bolt holds broadly static through tick62; charge motes, moving sparks, ring/light, synchronized sound and original ARC quality are still missing.
- [SAW] Large blue shards and black corner gaps improved after round join rewrite; tight bends retain small bright overlaps. No whole-cycle visual acceptance yet.
- [UNVERIFIED] Graph-node drag remains inconclusive under single-step browser drag. No full browser lifecycle automation.
- [PROXY] Mixed billboard+ribbon preview works in current browser, but camera framing ignores particle extents; width shaping, textured UVs and parallel transport unsupported. EffectTimeCurve drives only RevealPath.fraction. Billboard life curves are renderer parameters, not graph-driven signals. AudioMix supports one level and one final limiter, not nested mixes. Invalid root audio blocks the whole preview. Playback uses Web Audio but actual listening/download remains unchecked. Persistence, ten complete presets and exporters remain pending.

## Environment
- Root `F:/Dev2/VFX-Tool`; v2 `http://127.0.0.1:5174/?workspace=v2`, v1 `/`. Vite PID in `work/dev-server.pid`; doctor/shot `C:/Users/itonk/.claude/tools/`.
- F writes/Git/squad usually require escalation. A one-turn direct F write grant was supplied after auto-review hit its usage limit; it may not persist. Git metadata rejects sandbox-user writes to `.git/index.lock`; unsandboxed escalation worked once the approval service recovered. Approved deps ReactFlow12.12.0+19 vetted transitives; any NEW package needs inspector vet before install/run.
- Checks: `node --experimental-strip-types --test tests/*.test.ts`; `node node_modules/typescript/bin/tsc --noEmit`; `node node_modules/vite/bin/vite.js build` (build needs escalation for dist write).
- Squad manager `vfx-manager`, `F:/Dev2/squad/squad.exe receive vfx-manager --wait --timeout 45 --json`; `SQUAD.md` has recovery. No broad process cleanup.

## Key files
- Full plan `docs/v2-plan/00-START-HERE.md`; lightning benchmark `docs/v2-plan/effects/01-LIGHTNING.md`.
- `src/graph/registry.ts`, `toPaths.ts`, `toParticles.ts`, `fixtures.ts` — node definitions, preview compilers and F01/L01.
- `src/runtime/paths.ts`, `branches.ts`, `curves.ts`; `src/render/PreviewViewport.ts`, `RibbonGeometry.ts`, `pathView.ts`, `previewMode.ts`, `billboardLife.ts`, `layerOrder.ts`; `src/PreviewV2.tsx`. Mixed preview/life handoff: `docs/implementation/WP03-MIXED-BILLBOARD-LIFE.md`.
- `src/audio/synthesis.ts`, `mix.ts`, `wav.ts`, `transport.ts`, `src/graph/toAudio.ts`, `audioFixtures.ts`, `docs/v2-plan/24-ALGORITHMS.md` Amendments A1/A2/A3 and `docs/implementation/WP04-AUDIO-CORE.md`.
