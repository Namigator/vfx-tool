# STATE — VFX Tool

**Goal:** A simple composable web VFX/SFX node tool with ten editable elemental defaults, original-lightning quality floor, and engine-neutral future exporters.

## Now
- Claude Opus 5.5 LOW in visible squad terminals does heavy implementation; Codex coordinates, runs gates, inspects browser. No built-in agents. Wait for squad reports; 10-minute fallback check only.
- Current branch `squad/vfx-v2`; ribbon rewrite is checkpointed at `8ffc114`; radial impact, sound graph and browser audition are the next uncommitted slice. Visual/audio acceptance remains open.
- [RAN] Full 391 tests pass with zero failures/skips; TypeScript and production build pass. Build warns about the large Three chunk and a third-party `use client` directive.
- [SAW] Full-width L01 tick30 shows a continuous trunk reaching a radial impact star, with visible Play sound/Stop sound/Download WAV controls. Latest screenshot `evidence/lightning-audio-ui-2026-09-26.png`. The preview is 59 paths and is still below original ARC quality.
- [RAN] Generic RadialPath, sparse ribbon fade splitting, per-ribbon endFade, multi-source AudioMix, held WAV encoding, audio transport, and visual/audio compile gating have automated tests. Browser controls render; real speaker output and a completed browser download remain unobserved.
- Anthropic spend limit reset at the 2026-09-26 00:11 heartbeat. Claude Opus 5.5 LOW workers resumed in visible squad terminals. Mix/WAV, audio registry, ribbon and audio compiler received independent static reviews; no new packages installed.

## Next
1. Listen to the L01 chirp/noise and verify an actual browser WAV download; inspect visuals through the full 0-120-tick cycle against original ARC.
2. Build fuller generic charge/discharge timing, sparks, ring/light and synchronized audiovisual playback; fix any visible defects.
3. Finish ten editable families and persistence. Engine exporters remain deferred per proof-of-concept scope.

## Known limits
- [SAW] L01 has a generic radial impact at ticks24-36 and an independently auditioned audio graph, but the bolt remains broadly static. Charge/reveal timing, ring/light, synchronized sound and original ARC quality are still missing.
- [SAW] Large blue shards and black corner gaps improved after round join rewrite; tight bends retain small bright overlaps. No whole-cycle visual acceptance yet.
- [UNVERIFIED] Graph-node drag remains inconclusive under single-step browser drag. No full browser lifecycle automation.
- [PROXY] Mixed billboard+ribbon previews give addressed error; width shaping, textured UVs and parallel transport unsupported. AudioMix supports one level and one final limiter, not nested mixes. Invalid root audio blocks the whole preview. Playback uses Web Audio but actual listening/download remains unchecked. Persistence, ten complete presets and exporters remain pending.

## Environment
- Root `F:/Dev2/VFX-Tool`; v2 `http://127.0.0.1:5174/?workspace=v2`, v1 `/`. Vite PID in `work/dev-server.pid`; doctor/shot `C:/Users/itonk/.claude/tools/`.
- F writes/Git/squad require escalation. Approved deps ReactFlow12.12.0+19 vetted transitives; any NEW package needs inspector vet before install/run.
- Checks: `node --experimental-strip-types --test tests/*.test.ts`; `node node_modules/typescript/bin/tsc --noEmit`; `node node_modules/vite/bin/vite.js build` (build needs escalation for dist write).
- Squad manager `vfx-manager`, `F:/Dev2/squad/squad.exe receive vfx-manager --wait --timeout 45 --json`; `SQUAD.md` has recovery. No broad process cleanup.

## Key files
- Full plan `docs/v2-plan/00-START-HERE.md`; lightning benchmark `docs/v2-plan/effects/01-LIGHTNING.md`.
- `src/graph/registry.ts`, `toPaths.ts`, `toParticles.ts`, `fixtures.ts` — node definitions, preview compilers and F01/L01.
- `src/runtime/paths.ts`, `branches.ts`; `src/render/PreviewViewport.ts`, `RibbonGeometry.ts`, `pathView.ts`, `previewMode.ts`; `src/PreviewV2.tsx`.
- `src/audio/synthesis.ts`, `mix.ts`, `wav.ts`, `transport.ts`, `src/graph/toAudio.ts`, `audioFixtures.ts`, `docs/v2-plan/24-ALGORITHMS.md` Amendments A1/A2/A3 and `docs/implementation/WP04-AUDIO-CORE.md`.
