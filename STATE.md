# STATE — VFX Tool

**Goal:** A simple composable web VFX/SFX node tool with ten editable elemental defaults, original-lightning quality floor, and engine-neutral future exporters.

## Now
- Claude Opus 5.5 LOW in visible squad terminals does heavy implementation; Codex coordinates, runs gates, inspects browser. No built-in agents. Wait for squad reports; 10-minute fallback check only.
- Current branch `squad/vfx-v2`; graph editor, path preview, and audio primitives are checkpointed in Git. Visual/audio acceptance remains open.
- [RAN] Full347 tests pass with zero failures/skips; TypeScript and production build pass after ribbon join rewrite and first audio graph compiler. Build still warns about the large Three chunk.
- [SAW] Full-width 1440x900 L01 capture shows large ribbon shards/corner gaps substantially reduced by segment quads and round joins; evidence/lightning-ribbon-round-2026-09-26.png. Bolt is still a static 39-path, seven-layer preview below original ARC quality.
- [RAN] Pure path compiler13, ribbon geometry10, L01 fixture8, preview mode7, audio synthesis13 (zero skipped) focused tests passed; audio synthesis tsc passed. Audio core [PROXY] independent review PASS after plan24 Amendment A2.
- Anthropic spend limit reset at the 2026-09-26 00:11 heartbeat. Claude Opus 5.5 LOW workers resumed in visible squad terminals. Mix/WAV, audio registry, ribbon and audio compiler received independent static reviews; no new packages installed.

## Next
1. Build timed lightning charge/discharge/impact, sparks, ring/light and sound with generic nodes; visually compare the full cycle against original ARC.
2. Connect the single-source audio graph compiler to an editor audition/export path, then listen and test audiovisual timing; extend to composable audio mix after per-input gain/pan schema is designed.
3. Full ten families, persistence and engine exporters remain later.

## Known limits
- [SAW] L01 is a static seven-layer bolt with branches/forks. Charge, reveal timing, sparks, impact, ring/light and sound are absent; not at original quality.
- [SAW] Large blue shards and black corner gaps improved after round join rewrite; tight bends retain small bright overlaps. No whole-cycle visual acceptance yet.
- [UNVERIFIED] Graph-node drag remains inconclusive under single-step browser drag. No full browser lifecycle automation.
- [PROXY] Mixed billboard+ribbon previews give addressed error; width shaping, textured UVs, parallel transport unsupported. Single-source pure audio graph compile exists, but no UI playback/listening; persistence, ten complete presets and exporters remain pending.

## Environment
- Root `F:/Dev2/VFX-Tool`; v2 `http://127.0.0.1:5174/?workspace=v2`, v1 `/`. Vite PID in `work/dev-server.pid`; doctor/shot `C:/Users/itonk/.claude/tools/`.
- F writes/Git/squad require escalation. Approved deps ReactFlow12.12.0+19 vetted transitives; any NEW package needs inspector vet before install/run.
- Checks: `node --experimental-strip-types --test tests/*.test.ts`; `node node_modules/typescript/bin/tsc --noEmit`; `node node_modules/vite/bin/vite.js build` (build needs escalation for dist write).
- Squad manager `vfx-manager`, `F:/Dev2/squad/squad.exe receive vfx-manager --wait --timeout 45 --json`; `SQUAD.md` has recovery. No broad process cleanup.

## Key files
- Full plan `docs/v2-plan/00-START-HERE.md`; lightning benchmark `docs/v2-plan/effects/01-LIGHTNING.md`.
- `src/graph/registry.ts`, `toPaths.ts`, `toParticles.ts`, `fixtures.ts` — node definitions, preview compilers and F01/L01.
- `src/runtime/paths.ts`, `branches.ts`; `src/render/PreviewViewport.ts`, `RibbonGeometry.ts`, `pathView.ts`, `previewMode.ts`; `src/PreviewV2.tsx`.
- `src/audio/synthesis.ts`, `mix.ts`, `wav.ts`, `src/graph/toAudio.ts`, `docs/v2-plan/24-ALGORITHMS.md` Amendments A1/A2/A3 and `docs/implementation/WP04-AUDIO-CORE.md`.
