# STATE — VFX Tool

**Goal:** A simple composable web VFX/SFX node tool with ten editable elemental defaults, original-lightning quality floor, and engine-neutral future exporters.

## Now
- Claude Opus 5.5 LOW in visible squad terminals does heavy implementation; Codex coordinates, runs gates, inspects browser. No built-in agents. Wait for squad reports; 10-minute fallback check only.
- Current branch `squad/vfx-v2`; radial impact, sound graph and browser audition are checkpointed at `75a1d0a`. The latest uncommitted slice adds bolt timing, mixed point/ribbon preview, and billboard life curves. Visual/audio acceptance remains open.
- [RAN] Full 417 tests pass with zero failures/skips; TypeScript and production build pass. Build warns about the large Three chunk and a third-party `use client` directive.
- [SAW] Desktop-sized in-app browser: charge grows and brightens from tick12 to23, persists at tick24, partial bolt at25, full bolt reaching target and impact at26, empty map at63. Full-width inspected captures are `evidence/lightning-charge-tick23-2026-09-26.png` and `evidence/lightning-strike-tick26-2026-09-26.png`. The preview is still below original ARC quality.
- [RAN] Generic RadialPath, sparse ribbon fade splitting, per-ribbon endFade, AudioMix, WAV encoding, audio transport, EffectTimeCurve RevealPath, mixed preview and billboard life curves have automated tests. Offline L01 WAV was written to `evidence/lightning-audio-prototype.wav` (0.50s, 48 kHz stereo PCM16). Browser controls render; real speaker output and a completed browser download remain unobserved.
- Anthropic spend limit reset at the 2026-09-26 00:11 heartbeat. Claude Opus 5.5 LOW workers resumed in visible squad terminals. Mix/WAV, audio registry, ribbon and audio compiler received independent static reviews; no new packages installed.

## Next
1. Listen to the L01 chirp/noise and verify an actual browser WAV download in a normal browser; compare the entire 0-120-tick visual cycle with original ARC.
2. Add moving charge motes and sparks, a ring/light impact, bolt fade envelope, and synchronized audiovisual playback through generic nodes.
3. Finish ten editable families and persistence. Engine exporters remain deferred per proof-of-concept scope.

## Known limits
- [SAW] L01 charge core/halo grows during ticks0-24, bolt appears over ticks24-26 and impact follows at ticks26-38. The bolt holds broadly static through tick62; charge motes, moving sparks, ring/light, synchronized sound and original ARC quality are still missing.
- [SAW] Large blue shards and black corner gaps improved after round join rewrite; tight bends retain small bright overlaps. No whole-cycle visual acceptance yet.
- [UNVERIFIED] Graph-node drag remains inconclusive under single-step browser drag. No full browser lifecycle automation.
- [PROXY] Mixed billboard+ribbon preview works in current browser, but camera framing ignores particle extents; width shaping, textured UVs and parallel transport unsupported. EffectTimeCurve drives only RevealPath.fraction. Billboard life curves are renderer parameters, not graph-driven signals. AudioMix supports one level and one final limiter, not nested mixes. Invalid root audio blocks the whole preview. Playback uses Web Audio but actual listening/download remains unchecked. Persistence, ten complete presets and exporters remain pending.

## Environment
- Root `F:/Dev2/VFX-Tool`; v2 `http://127.0.0.1:5174/?workspace=v2`, v1 `/`. Vite PID in `work/dev-server.pid`; doctor/shot `C:/Users/itonk/.claude/tools/`.
- F writes/Git/squad usually require escalation. A one-turn direct F write grant was supplied after auto-review hit its usage limit; it may not persist. Git metadata still rejects sandbox-user writes to `.git/index.lock`, even after a direct `.git` grant, so the latest timing slice remains uncommitted. Approved deps ReactFlow12.12.0+19 vetted transitives; any NEW package needs inspector vet before install/run.
- Checks: `node --experimental-strip-types --test tests/*.test.ts`; `node node_modules/typescript/bin/tsc --noEmit`; `node node_modules/vite/bin/vite.js build` (build needs escalation for dist write).
- Squad manager `vfx-manager`, `F:/Dev2/squad/squad.exe receive vfx-manager --wait --timeout 45 --json`; `SQUAD.md` has recovery. No broad process cleanup.

## Key files
- Full plan `docs/v2-plan/00-START-HERE.md`; lightning benchmark `docs/v2-plan/effects/01-LIGHTNING.md`.
- `src/graph/registry.ts`, `toPaths.ts`, `toParticles.ts`, `fixtures.ts` — node definitions, preview compilers and F01/L01.
- `src/runtime/paths.ts`, `branches.ts`, `curves.ts`; `src/render/PreviewViewport.ts`, `RibbonGeometry.ts`, `pathView.ts`, `previewMode.ts`, `billboardLife.ts`, `layerOrder.ts`; `src/PreviewV2.tsx`. Mixed preview/life handoff: `docs/implementation/WP03-MIXED-BILLBOARD-LIFE.md`.
- `src/audio/synthesis.ts`, `mix.ts`, `wav.ts`, `transport.ts`, `src/graph/toAudio.ts`, `audioFixtures.ts`, `docs/v2-plan/24-ALGORITHMS.md` Amendments A1/A2/A3 and `docs/implementation/WP04-AUDIO-CORE.md`.
