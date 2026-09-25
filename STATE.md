# STATE — VFX Tool

**Goal:** A simple composable web VFX/SFX node tool with ten editable elemental defaults, original-lightning quality floor, and engine-neutral future exporters.

## Now
- Claude Opus 5.5 LOW in visible squad terminals does heavy implementation; Codex coordinates, runs gates, inspects browser. No built-in agents. Wait for squad reports; 10-minute fallback check only.
- Current branch `squad/vfx-v2`; graph editor, path preview, and audio primitives are checkpointed in Git. Visual/audio acceptance remains open.
- [RAN] Full337 tests pass with zero failures/skips; TypeScript and production build pass after expanded preview and audio core. Build still warns about the large Three chunk.
- [SAW] Browser L01 renders seven ribbon layers and39 paths; Expand preview grows canvas to ~540px and shows bolt across most of viewport. Reset to F01 shows its white point after path mode. Captured and inspected via CUA. Spike-like joins and missing charge/impact still below original ARC quality.
- [RAN] Pure path compiler13, ribbon geometry10, L01 fixture8, preview mode7, audio synthesis13 (zero skipped) focused tests passed; audio synthesis tsc passed. Audio core [PROXY] independent review PASS after plan24 Amendment A2.
- Claude workers hit Anthropic monthly spend limit at task d65dec99 after saving partial expanded-preview edits; no further Claude tasks until reset. Earlier static reviews: path compiler/fixture PASS, audio synthesis/A2 PASS, renderer math PASS with join caveat. Mix/WAV not independently reviewed.

## Next
1. Fix remaining ribbon joins/length fade and implement timed lightning charge/discharge/impact with generic nodes; visually compare whole cycle to original ARC.
2. Review mix/WAV against plan24 Amendment A3 independently once Claude resumes; wire audio graph/player, then listen.
3. Full ten families, persistence and engine exporters remain later.

## Known limits
- [SAW] L01 is a static seven-layer bolt with branches/forks. Charge, reveal timing, sparks, impact, ring/light and sound are absent; not at original quality.
- [PROXY] Ribbon join geometry lacks miter/length fade; reviewer says it likely causes spike-like shards. Path→point switch camera restoration now browser-seen.
- [UNVERIFIED] Graph-node drag remains inconclusive under single-step browser drag. No full browser lifecycle automation.
- [PROXY] Mixed billboard+ribbon previews give addressed error; width shaping, textured UVs, parallel transport unsupported. No audio graph/player, persistence, ten complete presets or exporters.

## Environment
- Root `F:/Dev2/VFX-Tool`; v2 `http://127.0.0.1:5174/?workspace=v2`, v1 `/`. Vite PID in `work/dev-server.pid`; doctor/shot `C:/Users/itonk/.claude/tools/`.
- F writes/Git/squad require escalation. Approved deps ReactFlow12.12.0+19 vetted transitives; any NEW package needs inspector vet before install/run.
- Checks: `node --experimental-strip-types --test tests/*.test.ts`; `node node_modules/typescript/bin/tsc --noEmit`; `node node_modules/vite/bin/vite.js build` (build needs escalation for dist write).
- Squad manager `vfx-manager`, `F:/Dev2/squad/squad.exe receive vfx-manager --wait --timeout 45 --json`; `SQUAD.md` has recovery. No broad process cleanup.

## Key files
- Full plan `docs/v2-plan/00-START-HERE.md`; lightning benchmark `docs/v2-plan/effects/01-LIGHTNING.md`.
- `src/graph/registry.ts`, `toPaths.ts`, `toParticles.ts`, `fixtures.ts` — node definitions, preview compilers and F01/L01.
- `src/runtime/paths.ts`, `branches.ts`; `src/render/PreviewViewport.ts`, `RibbonGeometry.ts`, `pathView.ts`, `previewMode.ts`; `src/PreviewV2.tsx`.
- `src/audio/synthesis.ts`, `mix.ts`, `wav.ts`, `docs/v2-plan/24-ALGORITHMS.md` Amendments A1/A2/A3.
