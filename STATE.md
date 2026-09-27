# STATE — VFX Tool

**Goal:** A simple composable web VFX/SFX node tool with ten editable elemental defaults, original-lightning quality floor, and engine-neutral future exporters.

## Direction (user decision 2026-09-26) — tool first, presets second
- Stop polishing individual effects feature-by-feature. Build **generic, reusable building blocks** first; presets are assembled from them afterwards, never hand-special-cased.
- Ease of use is the product. This is the plan's own Simple view + component templates + published knobs (01, 12) — not a new concept; the failure was execution order (see 27-GAP-AUDIT). Reusable **layer types** (e.g. Flame jet, Smoke, Sparks, Glow, Bolt, Ring) that expose their own big knobs (reach, spread, turbulence, lift, size, heat colour, density), sitting on top of the node graph (graph stays as "advanced"). Per-preset published controls alone are not enough.
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

## MCP (agent tooling)
- `.mcp.json` registers server `vfx` → `node --experimental-strip-types --no-warnings mcp/vfx-mcp.ts` (loads in a NEW Claude Code session). Tools: vfx_list_node_types, vfx_describe_node_type, vfx_new_document (blank/f01/forces/lightning/lightning-audio), vfx_open/save/get/set_document, vfx_set_anchor, vfx_add/remove_node, vfx_set_params, vfx_connect/disconnect, vfx_compile, vfx_sample_particles, vfx_render_audio, vfx_preview_url, vfx_render_frames (PNG frames via headless Chrome → /capture.html?doc=…&tick=…; needs the vite dev server; images saved to work/mcp/frames/). Docs mirror to work/mcp/<id>.json; editor opens `?workspace=v2&doc=/work/mcp/<id>.json`. [RAN] tests/v2-mcp.test.ts + stdio smoke (work/mcp-smoke.mjs); [SAW] MCP-built fountain in editor. Deps: @modelcontextprotocol/sdk 1.30.1, zod 4.6.5 (user-approved 2026-09-26). WP-MCP2 done 2026-09-26. Recipes: mcp/examples/*.steps.json, run with `node mcp/run-steps.mjs <file>`.

## Next — gap order from docs/v2-plan/27-GAP-AUDIT.md (capability floor, 19-WORK-PACKAGES)
1. DONE I1 emitter shapes/speed/aim; DONE I4 appearance (colour over life, spin, velocity stretch, pivot). Recipes: `node mcp/run-steps.mjs mcp/examples/sparks.steps.json`.
2. DONE GroundCollision, NoiseForce, textured flipbooks (library rebaked to 10-ASSETS). DONE camera framing over particle extents (5 timeline samples, 0.75 m min half-extent). DONE ParticleEvents child emission (rain-splash recipe). DONE ParticleTrail, SpriteRenderer. Next: I7 PointLight, RingRenderer; then I8/I9 Curve, RandomRange, PathFollower.
3. — 4. I5 Textured flipbook material; rebake library to 10-ASSETS format (4×4, 256 px cells); spec docs/implementation/WP04-TEXTURED-MATERIALS-FLIPBOOK.md.
5. I6 GroundCollision + ParticleEvents; I7 ParticleTrail/SpriteRenderer/PointLight; I8/I9 Curve, RandomRange, PathFollower.
6. Then editor Simple view + components (I10), persistence (I11), worker (I12); then resume WP10 lightning and the A-05 model build test.
Sprite library: `node tools/bake-sprites.mjs` → assets/sprites/ (flame-tongue-a/b, smoke-puff, foam flipbooks 4×4/256; soft-glow, spark-streak, electric-arc, droplet, ripple-ring 2×2; dissolve-noise) + src/assets/builtinSprites.generated.ts; preview /assets/sprites/preview.html.

## Known limits
- [SAW] L01 charge core/halo grows during ticks0-24, bolt appears over ticks24-26 and impact follows at ticks26-38. The bolt holds broadly static through tick62; charge motes, moving sparks, ring/light, synchronized sound and original ARC quality are still missing.
- [SAW] Large blue shards and black corner gaps improved after round join rewrite; tight bends retain small bright overlaps. No whole-cycle visual acceptance yet.
- [UNVERIFIED] Graph-node drag remains inconclusive under single-step browser drag. No full browser lifecycle automation.
- [PROXY] Mixed billboard+ribbon preview works in current browser, but width shaping, textured UVs and parallel transport unsupported. EffectTimeCurve drives only RevealPath.fraction. Billboard life curves are renderer parameters, not graph-driven signals. AudioMix supports one level and one final limiter, not nested mixes. Invalid root audio blocks the whole preview. Playback uses Web Audio but actual listening/download remains unchecked. Persistence, ten complete presets and exporters remain pending.

## Backlog (not scheduled)
- **Realistic water material (Three.js):** move the water look into the tool's renderer — refraction of the scene behind, fresnel/environment reflection, animated normal-map surface, lit textured floor + environment map for something to reflect/refract, caustics. Canvas2D reference `docs/v2-plan/references/standalone-water/water.html` (TIDE) is at its ceiling; user verdict 2026-09-26: "looks computer generated". Matches 03-WATER.md SurfaceTranslucent.
- **Sim-rendered sprites via Blender:** render splash crown, droplets, foam, spray from real fluid sims into flipbooks for the sprite library (blender MCP exists; needs Blender running).
- TIDE physics notes already applied: specular = single half-vector line on the tube; instability grows with distance from source (Plateau–Rayleigh), width ∝ 1/sqrt(speed); ripples only on standing water.

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

## Session checkpoint — 2026-09-27
- [RAN] Full suite: 459 passed, 0 failed; TypeScript `--noEmit` exited 0; production build completed. Existing warnings: React Flow `use client` directive and OrbitControls chunk >500 kB.
- [SAW] Timeline-wide camera framing captures the effect in bounds at tick 26; at tick 119 the browser UI reports `1 particles + paths` but the ring is no longer visible. At tick 60 the bolt is visible, while the ripple is too small/faint to judge confidently in the narrow in-app viewport. Ring seam/quality is still open; the prior desktop capture at tick 60 showed the full ring inside the frame but small.
- [RAN] Doctor preflight clean; Vite 5174 listening; no packages installed.
- Claude Opus 5.5 LOW tasks assigned to visible workers: `d748e2b1-20f4-4ea4-9dea-cf6bc1164de5` (generic ribbon joins/length fade) and `39de94e1-c95d-4bcd-8354-b69e3c1c05ae` (read-only audio mix/WAV review). Await reports; do not poll. New terminals use `claude-model-2`, `claude-review-2`; coordinator is `vfx-manager-2` because old IDs remain in squad history.
- Next: finish the wide ring lifecycle visual check; receive worker reports; run targeted/full regressions for any change; inspect the browser again; then update this state and checkpoint.
- Squad recovery note: the first launch hit identity conflicts (`ID already occupied`); the project’s exact-registration resume option restarted only `claude-model-2` and `claude-review-2` in visible terminals. [RAN] `claude-model-2` received its assigned task at 00:27 local. This confirms dispatch, not that the Anthropic spend limit has cleared; no worker result yet.
